// ollama-router.js
// Requires Node.js 18+ (native fetch — no npm install needed)
// Routes simple tasks to local Ollama; complex tasks are flagged for Claude Code.

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, 'orchestrator-stats.json');
const LOG_FILE = join(__dirname, 'orchestrator.log');

function log(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return {
      ollamaCalls: 0,
      claudeCodeReferrals: 0,
      ollamaFallbacks: 0,
      totalOffloadedChars: 0,
      routes: [],
    };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

class TaskRouter {
  constructor(ollamaUrl = 'http://localhost:11434') {
    this.ollamaUrl = ollamaUrl;
    this.ollamaModel = process.env.OLLAMA_MODEL || 'mistral';
    this.stats = loadStats();
  }

  // ── Ollama failure handler ────────────────────────────────────────────────────
  _ollamaFallback(prompt, label, reason, retryHint, elapsed = 0) {
    log(label, reason);
    this.stats.ollamaFallbacks = (this.stats.ollamaFallbacks || 0) + 1;
    this.stats.routes.push({
      ts: new Date().toISOString(),
      route: 'ollama-fallback',
      label,
      ms: elapsed,
    });
    saveStats(this.stats);

    const text =
      `[${label}] ${reason}\n\n` +
      `Options:\n` +
      `  1. ${retryHint}\n` +
      `  2. Use Claude Code instead — copy this prompt:\n\n` +
      `---\n${prompt}\n---`;

    return { source: 'ollama-fallback', label, reason, model: 'n/a', text };
  }

  // ── Local Ollama ─────────────────────────────────────────────────────────────
  async callOllama(prompt) {
    const t0 = Date.now();
    log('OLLAMA', `Sending ${prompt.length} chars to ${this.ollamaModel} (streaming)`);

    let res;
    try {
      res = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.ollamaModel, prompt, stream: true }),
      });
    } catch (err) {
      const elapsed = Date.now() - t0;
      const code = err.cause?.code;
      if (code === 'ECONNREFUSED') {
        return this._ollamaFallback(
          prompt,
          'OLLAMA-DOWN',
          'Ollama is not running (connection refused).',
          'Start Ollama (`ollama serve`) and re-run your command',
          elapsed,
        );
      }
      if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
        return this._ollamaFallback(
          prompt,
          'OLLAMA-TIMEOUT',
          'Ollama timed out (no response).',
          'Check Ollama is responding (`ollama list`) and re-run your command',
          elapsed,
        );
      }
      return this._ollamaFallback(
        prompt,
        'OLLAMA-ERROR',
        `Ollama fetch failed: ${err.message}`,
        `Check Ollama is running and re-run your command`,
        elapsed,
      );
    }

    if (!res.ok) {
      return this._ollamaFallback(
        prompt,
        'OLLAMA-ERROR',
        `Ollama returned ${res.status}: ${res.statusText}`,
        `Check OLLAMA_MODEL env var (currently: ${this.ollamaModel}) and re-run your command`,
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
      buffer = lines.pop(); // hold incomplete trailing line

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
    log('OLLAMA', `Done in ${elapsed}ms — ${fullResponse.length} chars`);

    this.stats.ollamaCalls++;
    this.stats.totalOffloadedChars = (this.stats.totalOffloadedChars || 0) + prompt.length;
    this.stats.routes.push({
      ts: new Date().toISOString(),
      route: 'ollama',
      model: this.ollamaModel,
      ms: elapsed,
    });
    saveStats(this.stats);

    return { source: 'ollama', model: this.ollamaModel, text: fullResponse, streamed: true };
  }

  // ── Claude Code referral ─────────────────────────────────────────────────────
  referToClaudeCode(prompt) {
    log('ROUTER', 'Complex task — referring to Claude Code');
    this.stats.claudeCodeReferrals++;
    this.stats.routes.push({ ts: new Date().toISOString(), route: 'claude-code', ms: 0 });
    saveStats(this.stats);
    return {
      source: 'claude-code',
      model: 'n/a',
      text: `This task needs Claude Code.\n\nCopy this prompt into your Claude Code session:\n\n---\n${prompt}\n---`,
    };
  }

  // ── Complexity assessment ────────────────────────────────────────────────────
  // Tune these keyword lists as you go — use --simple to override when auto-routing misses.
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
    const complex = [
      'design',
      'architect',
      'optimise',
      'optimize',
      'debug',
      'reason',
      'plan',
      'refactor',
      'security',
      'tradeoff',
      'implement',
      'explain',
      'clean',
    ];
    const lower = prompt.toLowerCase();

    const complexMatch = complex.find((kw) => lower.includes(kw));
    if (complexMatch)
      return { complexity: 'complex', reason: `matched keyword "${complexMatch}" (complex list)` };

    const simpleMatch = simple.find((kw) => lower.includes(kw));
    if (simpleMatch)
      return { complexity: 'simple', reason: `matched keyword "${simpleMatch}" (simple list)` };

    if (prompt.length > 500)
      return {
        complexity: 'complex',
        reason: `prompt length ${prompt.length} > 500 chars (length fallback)`,
      };
    return { complexity: 'simple', reason: `no keywords matched, length ≤ 500 (length fallback)` };
  }

  assessComplexity(prompt) {
    return this.assessComplexityWithReason(prompt).complexity;
  }

  // ── Main router ──────────────────────────────────────────────────────────────
  async route(prompt, forceComplexity = null) {
    const complexity = forceComplexity ?? this.assessComplexity(prompt);
    log('ROUTER', `complexity=${complexity}${forceComplexity ? ' (forced)' : ' (auto)'}`);

    if (complexity === 'simple') return this.callOllama(prompt);
    if (complexity === 'complex') return this.referToClaudeCode(prompt);
    throw new Error(`Unknown complexity: ${complexity}`);
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = {
      ollamaCalls: 0,
      claudeCodeReferrals: 0,
      ollamaFallbacks: 0,
      totalOffloadedChars: 0,
      routes: [],
    };
    saveStats(this.stats);
  }
}

export const SAVINGS_RATE_PER_M_TOKENS = 3.0;

export function estimateSavings(chars) {
  const tokens = Math.ceil(chars / 4);
  const savings = ((tokens / 1_000_000) * SAVINGS_RATE_PER_M_TOKENS).toFixed(2);
  return { tokens, savings };
}

export default TaskRouter;
