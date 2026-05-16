#!/usr/bin/env node
// index.js

import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// classifier + logger have no stats-db dependency, so the --classify hook can use
// them without paying the better-sqlite3 init cost on every prompt submission.
import { classifyPrompt } from './classifier.js';
import { logEntry, logToFile } from './logger.js';

// Resolve symlinks once at module load so the cwd filter still matches when Claude
// Code runs from a symlinked copy of this repo.
function resolveRealPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return resolve(p);
  }
}
const ORCH_DIR = resolveRealPath(dirname(fileURLToPath(import.meta.url)));

// JSON.parse rejects literal control chars in string values (e.g. unescaped \t or \n in the
// prompt field of Claude Code hook payloads). This retries with those chars properly escaped.
function parseHookPayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    let inString = false;
    let prevBackslash = false;
    let out = '';
    for (const ch of raw) {
      const code = ch.charCodeAt(0);
      if (prevBackslash) {
        prevBackslash = false;
        out += ch;
        continue;
      }
      if (ch === '\\' && inString) {
        prevBackslash = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        out += ch;
        continue;
      }
      if (inString && code < 0x20) {
        out +=
          { 9: '\\t', 10: '\\n', 13: '\\r' }[code] ?? `\\u${code.toString(16).padStart(4, '0')}`;
      } else {
        out += ch;
      }
    }
    return JSON.parse(out);
  }
}

const mySkills = {
  'code-review': `You are an expert code reviewer.
Focus on: code quality, security vulnerabilities, performance, maintainability.
Provide specific, actionable feedback.`,

  'data-analysis': `You are a data analyst.
Look for patterns, trends, and outliers.
Suggest appropriate visualisations and statistical approaches.`,

  documentation: `You are a technical writer.
Write clear, concise documentation with examples and code snippets.
Use active voice and plain language.`,
};

const myRules = {
  format: 'Use markdown formatting in all responses.',
  tone: 'Be professional but conversational.',
  accuracy: 'Double-check facts before presenting them.',
};

// Lazy-load to keep --classify / --help paths free of stats-db / claude-orchestrator imports.
async function createOrchestrator() {
  const { default: ClaudeOrchestrator } = await import('./claude-orchestrator.js');
  return new ClaudeOrchestrator(mySkills, myRules);
}

export function parseArgs(rawArgs) {
  const remaining = [...rawArgs];
  let force = null;
  let filePath = null;
  let dryRun = false;

  // Extract --simple / --complex (can appear anywhere)
  const simpleIdx = remaining.indexOf('--simple');
  if (simpleIdx !== -1) {
    force = 'simple';
    remaining.splice(simpleIdx, 1);
  }
  const complexIdx = remaining.indexOf('--complex');
  if (complexIdx !== -1) {
    force = 'complex';
    remaining.splice(complexIdx, 1);
  }

  // Extract --dry-run (can appear anywhere in remaining args)
  const dryRunIdx = remaining.indexOf('--dry-run');
  if (dryRunIdx !== -1) {
    dryRun = true;
    remaining.splice(dryRunIdx, 1);
  }

  // Extract --file <path> (can appear anywhere in remaining args)
  const fileIdx = remaining.indexOf('--file');
  if (fileIdx !== -1) {
    if (!remaining[fileIdx + 1]) {
      console.error('[ERROR] --file requires a path argument.');
      process.exit(1);
    }
    filePath = remaining[fileIdx + 1];
    remaining.splice(fileIdx, 2);
  }

  const promptText = remaining.join(' ').trim();
  return { force, filePath, promptText, dryRun };
}

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === '--help') {
    console.log(`
Ollama Orchestrator (Claude Code edition)
-----------------------------------------
Routing tiers:
  Simple  → local Ollama (OLLAMA_MODEL, default: mistral)
  Medium  → remote Ollama (OLLAMA_REMOTE_HOST + OLLAMA_REMOTE_MODEL)
  Complex → Claude Code session

Usage:
  node index.js "Your request"
  node index.js --file <path> "Your instruction"
  node index.js --stats
  node index.js --reset
  node index.js --dashboard
  node index.js --track      (called by Claude Code Stop hook via stdin JSON)
  node index.js --classify   (called by Claude Code UserPromptSubmit hook via stdin JSON)

Force routing:
  node index.js --simple  "Format this JSON ..."
  node index.js --complex "Design a microservice ..."

Preview routing without executing:
  node index.js --dry-run "debug this function"
  node index.js --dry-run --file src/models.py "Extract all class names"

Pass a file without shell substitution (avoids newline collapsing and ARG_MAX limits):
  node index.js --simple --file backend/app/routers/bp.py "Extract all route paths"
  node index.js --file src/models.py "Summarise what this module does"

Env vars:
  OLLAMA_MODEL             default: mistral        (local simple-task model)
  OLLAMA_REMOTE_HOST       e.g. http://192.168.x.x:11434  (enables medium tier)
  OLLAMA_REMOTE_MODEL      default: llama3.1:latest (remote medium-task model)
  OLLAMA_PORT              default: 11434
  OLLAMA_SIMPLE_SIZE_LIMIT default: 20000          (chars; simple-keyword prompts above this escalate to tier 2)
  OLLAMA_ORCH_PATH         set in your shell profile for portable CLAUDE.md instructions

Examples:
  node index.js "Format this JSON: {name:'alice'}"
  node index.js --simple --file data.csv "Convert this to JSON"
  node index.js --file routers/bp.py "Extract all API route paths and HTTP methods"
    `);
    return;
  }

  if (args[0] === '--classify') {
    let prompt = '';
    let cwd = '';
    try {
      if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const payload = parseHookPayload(Buffer.concat(chunks).toString());
        prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
      }
    } catch (err) {
      logEntry(
        'WARN',
        `--classify: failed to parse UserPromptSubmit payload — ${err.message.replace(/\n/g, ' ')}`,
      );
      return;
    }
    if (!prompt.trim()) return;
    if (cwd && resolveRealPath(cwd) === ORCH_DIR) return;
    const { complexity, reason } = classifyPrompt(prompt);
    const kwMatch = reason.match(/"(\w+)"/);
    const hint = kwMatch ? `kw="${kwMatch[1]}"` : 'length-fallback';
    const preview = prompt.length > 60 ? prompt.slice(0, 60).trimEnd() + '...' : prompt;
    // eslint-disable-next-line no-control-regex
    const safePreview = preview.replace(/[\u0000-\u001f\u007f]/g, ' ');
    // File-only — Claude Code injects hook stdout as additionalContext, so we
    // keep the raw audit line out of the model's prompt view.
    logToFile('CLASSIFY', `${complexity}  ${hint}  "${safePreview}"`);
    // Nudge Claude via additionalContext only when the classifier is confident
    // (keyword match) AND the work is plausibly offloadable (simple or medium).
    // Length-fallback and complex stay silent.
    if (kwMatch && (complexity === 'simple' || complexity === 'medium')) {
      const flag = complexity === 'simple' ? '--simple ' : '';
      console.log(
        `[orchestrator] This prompt looks offloadable to Ollama ` +
          `(${complexity}, kw="${kwMatch[1]}"). Before doing it yourself, consider:\n` +
          `  node $OLLAMA_ORCH_PATH ${flag}--file <path> "<instruction>"\n` +
          `Review the model's output before using it.`,
      );
    }
    return;
  }

  if (args[0] === '--track') {
    let sessionId = 'unknown';
    let cwd = '';
    try {
      if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const payload = parseHookPayload(Buffer.concat(chunks).toString());
        sessionId = typeof payload.session_id === 'string' ? payload.session_id : 'unknown';
        cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
      }
    } catch (err) {
      logEntry(
        'WARN',
        `--track: failed to parse Stop hook payload — ${err.message.replace(/\n/g, ' ')}`,
      );
      return;
    }
    if (cwd && resolveRealPath(cwd) === ORCH_DIR) return;
    const { trackClaudeActivity } = await import('./ollama-router.js');
    trackClaudeActivity(sessionId);
    return;
  }

  if (args[0] === '--dashboard') {
    try {
      const { default: launchDashboard } = await import('./dashboard.js');
      await launchDashboard();
    } catch (err) {
      console.error('[ERROR] Could not launch dashboard:', err.message);
      console.error('Make sure dependencies are installed (npm install) and Node >= 22 is in use.');
      process.exit(1);
    }
    return;
  }

  if (args[0] === '--stats') {
    const { estimateSavings, SAVINGS_RATE_PER_M_TOKENS } = await import('./ollama-router.js');
    const orchestrator = await createOrchestrator();
    const stats = orchestrator.getStats();
    const simple = stats.simpleCalls || 0;
    const medium = stats.mediumCalls || 0;
    const refs = stats.claudeCodeReferrals || 0;
    const fallbacks = stats.ollamaFallbacks || 0;
    const total = stats.totalRequests || 0;
    const simplePct = total ? Math.round((simple / total) * 100) : 0;
    const mediumPct = total ? Math.round((medium / total) * 100) : 0;
    const refsPct = total ? Math.round((refs / total) * 100) : 0;
    const { tokens: estimatedTokens, savings: estimatedSavings } = estimateSavings(
      stats.totalOffloadedChars || 0,
    );

    let fbLocal = 'down=0/timeout=0/err=0';
    let fbRemote = 'down=0/timeout=0/err=0';
    let tallies = null;
    let recent = [];

    try {
      const { getFallbackCounts, getTallies, getRecentRoutes } = await import('./stats-db.js');
      const fb = getFallbackCounts();
      fbLocal = `down=${fb['OLLAMA-DOWN'] || 0}/timeout=${fb['OLLAMA-TIMEOUT'] || 0}/err=${fb['OLLAMA-ERROR'] || 0}`;
      fbRemote = `down=${fb['OLLAMA-REMOTE-DOWN'] || 0}/timeout=${fb['OLLAMA-REMOTE-TIMEOUT'] || 0}/err=${fb['OLLAMA-REMOTE-ERROR'] || 0}`;
      tallies = getTallies();
      recent = getRecentRoutes(5);
    } catch {
      // DB not yet initialised (no requests recorded)
    }

    console.log('\nOrchestrator Stats');
    console.log('------------------');
    console.log(`Simple calls       : ${simple}  (${simplePct}% of total — local, free)`);
    console.log(`Medium calls       : ${medium}  (${mediumPct}% of total — remote, free)`);
    console.log(`Claude Code refers : ${refs}  (${refsPct}% of total)`);
    console.log(`Ollama fallbacks   : ${fallbacks}  (local: ${fbLocal} | remote: ${fbRemote})`);
    console.log(`Total requests     : ${total}`);
    console.log(`Offloaded tokens   : ${estimatedTokens.toLocaleString()}`);
    console.log(
      `Estimated savings  : ~$${estimatedSavings}  (vs Claude Sonnet @ $${SAVINGS_RATE_PER_M_TOKENS}/M input tokens)`,
    );

    if (tallies) {
      const fmt = (m) =>
        `local=${m['ollama'] ?? 0}  remote=${m['ollama-remote'] ?? 0}  claude=${m['claude-code'] ?? 0}`;
      console.log('\nUsage breakdown:');
      console.log(`  Today      : ${fmt(tallies.today)}`);
      console.log(`  This week  : ${fmt(tallies.week)}`);
      console.log(`  This month : ${fmt(tallies.month)}`);
    }

    if (recent.length) {
      console.log('\nLast 5 routes:');
      recent.forEach((r) => {
        const ts = new Date(r.ts).toISOString();
        console.log(`  ${ts}  ${r.route.padEnd(14)}  ${r.ms != null ? r.ms + 'ms' : ''}`);
      });
    }
    return;
  }

  if (args[0] === '--reset') {
    const orchestrator = await createOrchestrator();
    orchestrator.reset();
    console.log('Stats reset.');
    return;
  }

  const { force, filePath, promptText, dryRun } = parseArgs(args);

  let prompt = promptText;
  let fileContentLength = 0;

  if (filePath) {
    const resolved = resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`[ERROR] File not found: ${resolved}`);
      process.exit(1);
    }
    const content = fs.readFileSync(resolved, 'utf8');
    fileContentLength = content.length;
    prompt = prompt ? `${prompt}\n\n${content}` : content;
    if (!dryRun) console.log(`[FILE] Read ${content.length} chars from ${filePath}`);
  }

  if (!prompt.trim()) {
    console.error('[ERROR] No prompt provided.');
    process.exit(1);
  }

  if (dryRun) {
    const orchestrator = await createOrchestrator();
    let complexity, reason;
    if (force) {
      complexity = force;
      reason = `forced via --${force} flag`;
    } else {
      const routingPrompt = orchestrator.computeRoutingPrompt(prompt);
      ({ complexity, reason } = orchestrator.router.assessComplexityWithReason(routingPrompt));
    }
    const { ollamaUrl, ollamaModel, remoteUrl, remoteModel } = orchestrator.router;
    let destination;
    if (complexity === 'simple') {
      destination = `local Ollama  (${ollamaUrl} · ${ollamaModel})`;
    } else if (complexity === 'medium') {
      destination = remoteUrl
        ? `remote Ollama  (${remoteUrl} · ${remoteModel})`
        : `Claude Code  (no OLLAMA_REMOTE_HOST configured)`;
    } else {
      destination = 'Claude Code';
    }
    console.log(`\n[DRY-RUN] Route: ${complexity}  →  ${destination}`);
    console.log(`          Reason: ${reason}`);
    if (filePath) console.log(`File    : ${filePath} (${fileContentLength} chars)`);
    const instructionText = promptText || '(file content only)';
    const preview =
      instructionText.length > 120 ? instructionText.slice(0, 120) + '...' : instructionText;
    console.log(`Prompt  : (${prompt.length} chars total) ${preview}\n`);
    return;
  }

  try {
    const orchestrator = await createOrchestrator();
    await orchestrator.process(prompt, force);
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

// realpathSync resolves symlinks so the comparison holds when OLLAMA_ORCH_PATH
// points to a symlinked path (e.g. ~/workspace -> /Volumes/...) — Node resolves
// symlinks in import.meta.url but not in process.argv[1].
if (fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
