#!/usr/bin/env node
// index.js

import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ClaudeOrchestrator from './claude-orchestrator.js';
import { estimateSavings, SAVINGS_RATE_PER_M_TOKENS } from './ollama-router.js';

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

const orchestrator = new ClaudeOrchestrator(mySkills, myRules);

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
  OLLAMA_MODEL         default: mistral        (local simple-task model)
  OLLAMA_REMOTE_HOST   e.g. http://192.168.x.x:11434  (enables medium tier)
  OLLAMA_REMOTE_MODEL  default: qwen2.5:32b    (remote medium-task model)
  OLLAMA_PORT          default: 11434
  OLLAMA_ORCH_PATH     set in your shell profile for portable CLAUDE.md instructions

Examples:
  node index.js "Format this JSON: {name:'alice'}"
  node index.js --simple --file data.csv "Convert this to JSON"
  node index.js --file routers/bp.py "Extract all API route paths and HTTP methods"
    `);
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
    const stats = orchestrator.getStats();
    const simple = stats.simpleCalls || 0;
    const medium = stats.mediumCalls || 0;
    const refs = stats.claudeCodeReferrals || 0;
    const fallbacks = stats.ollamaFallbacks || 0;
    const total = simple + medium + refs + fallbacks;
    const simplePct = total ? Math.round((simple / total) * 100) : 0;
    const mediumPct = total ? Math.round((medium / total) * 100) : 0;
    const refsPct = total ? Math.round((refs / total) * 100) : 0;
    const fallbackRoutes = (stats.routes || []).filter((r) => r.route === 'ollama-fallback');
    const byLabel = fallbackRoutes.reduce((acc, r) => {
      acc[r.label] = (acc[r.label] || 0) + 1;
      return acc;
    }, {});
    const fbLocal = `down=${byLabel['OLLAMA-DOWN'] || 0}/timeout=${byLabel['OLLAMA-TIMEOUT'] || 0}/err=${byLabel['OLLAMA-ERROR'] || 0}`;
    const fbRemote = `down=${byLabel['OLLAMA-REMOTE-DOWN'] || 0}/timeout=${byLabel['OLLAMA-REMOTE-TIMEOUT'] || 0}/err=${byLabel['OLLAMA-REMOTE-ERROR'] || 0}`;
    const { tokens: estimatedTokens, savings: estimatedSavings } = estimateSavings(
      stats.totalOffloadedChars || 0,
    );

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
    if (stats.routes?.length) {
      const last5 = stats.routes.slice(-5).reverse();
      console.log('\nLast 5 routes:');
      last5.forEach((r) =>
        console.log(`  ${r.ts}  ${r.route.padEnd(14)}  ${r.ms != null ? r.ms + 'ms' : ''}`),
      );
    }
    return;
  }

  if (args[0] === '--reset') {
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
    await orchestrator.process(prompt, force);
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
