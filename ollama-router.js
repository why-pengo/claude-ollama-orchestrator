// ollama-router.js
// Requires Node.js 22+ (native fetch, AbortSignal.any)
// Routes tasks across three tiers: local Ollama → remote Ollama → Claude Code.

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertRequest, migrateFromRoutes } from './stats-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, 'orchestrator-stats.json');
const LOG_FILE = join(__dirname, 'orchestrator.log');

// Simple-keyword tasks larger than this are escalated to tier 2 (remote Ollama)
// to avoid OOM / timeout on the local model. Override with OLLAMA_SIMPLE_SIZE_LIMIT.
const _rawLimit = Number(process.env.OLLAMA_SIMPLE_SIZE_LIMIT);
const SIMPLE_SIZE_LIMIT = Number.isFinite(_rawLimit) && _rawLimit > 0 ? _rawLimit : 20_000;

function log(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function makeDefaultStats() {
  return {
    totalRequests: 0,
    simpleCalls: 0,
    mediumCalls: 0,
    claudeCodeReferrals: 0,
    ollamaFallbacks: 0,
    totalOffloadedChars: 0,
  };
}

function loadStats() {
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    // migrate ollamaCalls → simpleCalls
    if ('ollamaCalls' in data && !('simpleCalls' in data)) {
      data.simpleCalls = data.ollamaCalls;
      delete data.ollamaCalls;
    }
    data.totalRequests =
      (data.simpleCalls || 0) + (data.mediumCalls || 0) + (data.claudeCodeReferrals || 0);
    if (data.routes?.length) {
      migrateFromRoutes(data.routes);
    }
    delete data.routes;
    return { ...makeDefaultStats(), ...data };
  } catch {
    return makeDefaultStats();
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

class TaskRouter {
  constructor(ollamaUrl = `http://localhost:${process.env.OLLAMA_PORT || 11434}`) {
    this.ollamaUrl = ollamaUrl;
    this.ollamaModel = process.env.OLLAMA_MODEL || 'mistral';
    this.remoteUrl = process.env.OLLAMA_REMOTE_HOST || null;
    this.remoteModel = process.env.OLLAMA_REMOTE_MODEL || 'qwen2.5:32b';
    this.stats = loadStats();
  }

  // ── Ollama failure handler ────────────────────────────────────────────────────
  _ollamaFallback(prompt, label, reason, retryHint, elapsed = 0) {
    log(label, reason);
    this.stats.ollamaFallbacks = (this.stats.ollamaFallbacks || 0) + 1;
    insertRequest({ ts: Date.now(), route: 'ollama-fallback', ms: elapsed, label });
    saveStats(this.stats);

    const text =
      `[${label}] ${reason}\n\n` +
      `Options:\n` +
      `  1. ${retryHint}\n` +
      `  2. Use Claude Code instead — copy this prompt:\n\n` +
      `---\n${prompt}\n---`;

    return { source: 'ollama-fallback', label, reason, model: 'n/a', text };
  }

  // ── Generic Ollama streaming call ─────────────────────────────────────────────
  async _callOllamaEndpoint(prompt, url, model, tier) {
    const logTag = tier === 'medium' ? 'OLLAMA-REMOTE' : 'OLLAMA';
    const statField = tier === 'medium' ? 'mediumCalls' : 'simpleCalls';
    const routeLabel = tier === 'medium' ? 'ollama-remote' : 'ollama';
    const downLabel = `${logTag}-DOWN`;
    const timeoutLabel = `${logTag}-TIMEOUT`;
    const errorLabel = `${logTag}-ERROR`;
    const nodeDesc = tier === 'medium' ? `remote (${url})` : `local (${url})`;

    const t0 = Date.now();
    log(logTag, `Sending ${prompt.length} chars to ${model} at ${url} (streaming)`);

    let res;
    try {
      res = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: true }),
      });
    } catch (err) {
      const elapsed = Date.now() - t0;
      const code = err.cause?.code;
      if (code === 'ECONNREFUSED') {
        return this._ollamaFallback(
          prompt,
          downLabel,
          `Ollama ${nodeDesc} is not running (connection refused).`,
          `Start Ollama on ${url} and re-run your command`,
          elapsed,
        );
      }
      if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
        return this._ollamaFallback(
          prompt,
          timeoutLabel,
          `Ollama ${nodeDesc} timed out (no response).`,
          `Check Ollama is responding on ${url} and re-run your command`,
          elapsed,
        );
      }
      return this._ollamaFallback(
        prompt,
        errorLabel,
        `Ollama ${nodeDesc} fetch failed: ${err.message}`,
        `Check Ollama is running on ${url} and re-run your command`,
        elapsed,
      );
    }

    if (!res.ok) {
      return this._ollamaFallback(
        prompt,
        errorLabel,
        `Ollama ${nodeDesc} returned ${res.status}: ${res.statusText}`,
        `Check OLLAMA_MODEL / OLLAMA_REMOTE_MODEL env var and re-run your command`,
        Date.now() - t0,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    process.stdout.write('\n');

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.response) {
          process.stdout.write(chunk.response);
          fullResponse += chunk.response;
        }
        if (chunk.done) break outer;
      }
    }

    process.stdout.write('\n');

    const elapsed = Date.now() - t0;
    log(logTag, `Done in ${elapsed}ms — ${fullResponse.length} chars`);

    this.stats[statField] = (this.stats[statField] || 0) + 1;
    this.stats.totalOffloadedChars = (this.stats.totalOffloadedChars || 0) + prompt.length;
    insertRequest({ ts: Date.now(), route: routeLabel, ms: elapsed, chars: prompt.length, model });
    saveStats(this.stats);

    return { source: routeLabel, model, text: fullResponse, streamed: true };
  }

  // ── Public Ollama callers ─────────────────────────────────────────────────────
  callOllama(prompt) {
    return this._callOllamaEndpoint(prompt, this.ollamaUrl, this.ollamaModel, 'simple');
  }

  callRemoteOllama(prompt) {
    return this._callOllamaEndpoint(prompt, this.remoteUrl, this.remoteModel, 'medium');
  }

  // ── Claude Code referral ─────────────────────────────────────────────────────
  referToClaudeCode(prompt) {
    const preview = prompt.length > 120 ? prompt.slice(0, 120).trimEnd() + '...' : prompt;
    log('ROUTER', `Referring to Claude Code — "${preview}" (${prompt.length} chars)`);
    this.stats.claudeCodeReferrals++;
    insertRequest({ ts: Date.now(), route: 'claude-code', ms: 0 });
    saveStats(this.stats);
    return {
      source: 'claude-code',
      model: 'n/a',
      text: `This task needs Claude Code.\n\nCopy this prompt into your Claude Code session:\n\n---\n${prompt}\n---`,
    };
  }

  // ── Complexity assessment ─────────────────────────────────────────────────────
  assessComplexityWithReason(prompt) {
    const simple = [
      'format',
      'extract',
      'convert',
      'parse',
      'organise',
      'organize',
      'list',
      'template',
      'rename',
      'sort',
    ];
    const medium = ['explain', 'reason'];
    const complex = [
      'architect',
      'security',
      'tradeoff',
      'plan',
      'clean',
      'debug',
      'refactor',
      'design',
      'implement',
      'optimise',
      'optimize',
    ];

    const lower = prompt.toLowerCase();

    const complexMatch = complex.find((kw) => lower.includes(kw));
    if (complexMatch) {
      return { complexity: 'complex', reason: `matched keyword "${complexMatch}" (complex list)` };
    }

    const mediumMatch = medium.find((kw) => lower.includes(kw));
    if (mediumMatch) {
      return { complexity: 'medium', reason: `matched keyword "${mediumMatch}" (medium list)` };
    }

    const simpleMatch = simple.find((kw) => lower.includes(kw));
    if (simpleMatch) {
      if (prompt.length > SIMPLE_SIZE_LIMIT) {
        return {
          complexity: 'medium',
          reason: `matched keyword "${simpleMatch}" (simple list) but prompt length ${prompt.length} > ${SIMPLE_SIZE_LIMIT} chars — escalated to tier 2`,
        };
      }
      return { complexity: 'simple', reason: `matched keyword "${simpleMatch}" (simple list)` };
    }

    if (prompt.length > 500) {
      return {
        complexity: 'complex',
        reason: `prompt length ${prompt.length} > 500 chars (length fallback)`,
      };
    }
    return { complexity: 'simple', reason: `no keywords matched, length ≤ 500 (length fallback)` };
  }

  assessComplexity(prompt) {
    return this.assessComplexityWithReason(prompt).complexity;
  }

  // ── Three-tier router with cascade fallback ──────────────────────────────────
  async route(prompt, forceComplexity = null) {
    const complexity = forceComplexity ?? this.assessComplexity(prompt);
    log('ROUTER', `complexity=${complexity}${forceComplexity ? ' (forced)' : ' (auto)'}`);

    this.stats.totalRequests = (this.stats.totalRequests || 0) + 1;
    saveStats(this.stats);

    if (complexity === 'simple') {
      const result = await this.callOllama(prompt);
      if (result.source !== 'ollama-fallback') return result;
      if (this.remoteUrl) {
        log('ROUTER', 'Local node offline — cascading to remote');
        const remoteResult = await this.callRemoteOllama(prompt);
        if (remoteResult.source !== 'ollama-fallback') return remoteResult;
        log('ROUTER', 'Remote node also offline — cascading to Claude Code');
      } else {
        log('ROUTER', 'Local node offline, no remote configured — cascading to Claude Code');
      }
      return this.referToClaudeCode(prompt);
    }

    if (complexity === 'medium') {
      if (!this.remoteUrl) return this.referToClaudeCode(prompt);
      const result = await this.callRemoteOllama(prompt);
      if (result.source !== 'ollama-fallback') return result;
      log('ROUTER', 'Remote node offline — cascading to Claude Code');
      return this.referToClaudeCode(prompt);
    }

    if (complexity === 'complex') return this.referToClaudeCode(prompt);
    throw new Error(`Unknown complexity: ${complexity}`);
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = makeDefaultStats();
    saveStats(this.stats);
  }
}

export function logEntry(tag, message) {
  log(tag, message);
}

export function trackClaudeActivity(sessionId = 'unknown') {
  const stats = loadStats();
  const detail = sessionId !== 'unknown' ? ` session=${sessionId}` : '';
  log('CLAUDE', `response completed${detail}`);
  stats.claudeCodeReferrals = (stats.claudeCodeReferrals || 0) + 1;
  insertRequest({ ts: Date.now(), route: 'claude-code', ms: 0, label: 'stop-hook' });
  saveStats(stats);
}

export { SIMPLE_SIZE_LIMIT };
export const SAVINGS_RATE_PER_M_TOKENS = 3.0;

export function estimateSavings(chars) {
  const tokens = Math.ceil(chars / 4);
  const savings = ((tokens / 1_000_000) * SAVINGS_RATE_PER_M_TOKENS).toFixed(2);
  return { tokens, savings };
}

export default TaskRouter;
