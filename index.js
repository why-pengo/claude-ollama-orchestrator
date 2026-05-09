#!/usr/bin/env node
// index.js

const ClaudeOrchestrator = require('./claude-orchestrator');

const mySkills = {
  'code-review': `You are an expert code reviewer.
Focus on: code quality, security vulnerabilities, performance, maintainability.
Provide specific, actionable feedback.`,

  'data-analysis': `You are a data analyst.
Look for patterns, trends, and outliers.
Suggest appropriate visualisations and statistical approaches.`,

  'documentation': `You are a technical writer.
Write clear, concise documentation with examples and code snippets.
Use active voice and plain language.`,
};

const myRules = {
  format:   'Use markdown formatting in all responses.',
  tone:     'Be professional but conversational.',
  accuracy: 'Double-check facts before presenting them.',
};

const orchestrator = new ClaudeOrchestrator(mySkills, myRules);

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
  node index.js --stats
  node index.js --reset

Force routing:
  node index.js --simple  "Format this JSON ..."
  node index.js --complex "Design a microservice ..."

Env vars:
  OLLAMA_MODEL   default: mistral

Examples:
  node index.js "Format this JSON: {name:'alice'}"
  node index.js "Extract all email addresses from this text: ..."
  node index.js --simple "Summarise this in one sentence: ..."
    `);
    return;
  }

  if (args[0] === '--stats') {
    const stats  = orchestrator.getStats();
    const ollama = stats.ollamaCalls;
    const refs   = stats.claudeCodeReferrals;
    const total  = ollama + refs;
    const pct    = total ? Math.round((ollama / total) * 100) : 0;
    console.log('\nOrchestrator Stats');
    console.log('------------------');
    console.log(`Ollama calls       : ${ollama}  (${pct}% of total — free)`);
    console.log(`Claude Code refers : ${refs}  (${100 - pct}% of total)`);
    console.log(`Total requests     : ${total}`);
    if (stats.routes?.length) {
      const last5 = stats.routes.slice(-5).reverse();
      console.log('\nLast 5 routes:');
      last5.forEach(r => console.log(`  ${r.ts}  ${r.route.padEnd(12)}  ${r.ms ? r.ms + 'ms' : ''}`));
    }
    return;
  }

  if (args[0] === '--reset') {
    orchestrator.reset();
    console.log('Stats reset.');
    return;
  }

  let force  = null;
  let prompt = args.join(' ');

  if (args[0] === '--simple')  { force = 'simple';  prompt = args.slice(1).join(' '); }
  if (args[0] === '--complex') { force = 'complex'; prompt = args.slice(1).join(' '); }

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

main();
