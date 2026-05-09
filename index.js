#!/usr/bin/env node
// index.js

const fs = require('fs');
const path = require('path');
const ClaudeOrchestrator = require('./claude-orchestrator');

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

function parseArgs(rawArgs) {
  const remaining = [...rawArgs];
  let force = null;
  let filePath = null;

  // Extract --simple / --complex (positional — must be first)
  if (remaining[0] === '--simple') {
    force = 'simple';
    remaining.shift();
  }
  if (remaining[0] === '--complex') {
    force = 'complex';
    remaining.shift();
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
  return { force, filePath, promptText };
}

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === '--help') {
    console.log(`
Ollama Orchestrator (Claude Code edition)
-----------------------------------------
Simple tasks  → handled by local Ollama (free)
Complex tasks → flagged for your Claude Code session

Usage:
  node index.js "Your request"
  node index.js --file <path> "Your instruction"
  node index.js --stats
  node index.js --reset

Force routing:
  node index.js --simple  "Format this JSON ..."
  node index.js --complex "Design a microservice ..."

Pass a file without shell substitution (avoids newline collapsing and ARG_MAX limits):
  node index.js --simple --file backend/app/routers/bp.py "Extract all route paths"
  node index.js --file src/models.py "Summarise what this module does"

Env vars:
  OLLAMA_MODEL      default: mistral
  OLLAMA_ORCH_PATH  set this in your shell profile so CLAUDE.md instructions are portable

Examples:
  node index.js "Format this JSON: {name:'alice'}"
  node index.js --simple --file data.csv "Convert this to JSON"
  node index.js --file routers/bp.py "Extract all API route paths and HTTP methods"
    `);
    return;
  }

  if (args[0] === '--stats') {
    const stats = orchestrator.getStats();
    const ollama = stats.ollamaCalls;
    const refs = stats.claudeCodeReferrals;
    const total = ollama + refs;
    const pct = total ? Math.round((ollama / total) * 100) : 0;
    console.log('\nOrchestrator Stats');
    console.log('------------------');
    console.log(`Ollama calls       : ${ollama}  (${pct}% of total — free)`);
    console.log(`Claude Code refers : ${refs}  (${100 - pct}% of total)`);
    console.log(`Total requests     : ${total}`);
    if (stats.routes?.length) {
      const last5 = stats.routes.slice(-5).reverse();
      console.log('\nLast 5 routes:');
      last5.forEach((r) =>
        console.log(`  ${r.ts}  ${r.route.padEnd(12)}  ${r.ms ? r.ms + 'ms' : ''}`),
      );
    }
    return;
  }

  if (args[0] === '--reset') {
    orchestrator.reset();
    console.log('Stats reset.');
    return;
  }

  const { force, filePath, promptText } = parseArgs(args);

  let prompt = promptText;

  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`[ERROR] File not found: ${resolved}`);
      process.exit(1);
    }
    const content = fs.readFileSync(resolved, 'utf8');
    prompt = prompt ? `${prompt}\n\n${content}` : content;
    console.log(`[FILE] Read ${content.length} chars from ${filePath}`);
  }

  if (!prompt.trim()) {
    console.error('[ERROR] No prompt provided.');
    process.exit(1);
  }

  try {
    await orchestrator.process(prompt, force);
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs };
