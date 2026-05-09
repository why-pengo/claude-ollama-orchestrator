// ollama-router.js
// Requires Node.js 18+ (native fetch — no npm install needed)
// Routes simple tasks to local Ollama; complex tasks are flagged for Claude Code.

const fs   = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'orchestrator-stats.json');
const LOG_FILE   = path.join(__dirname, 'orchestrator.log');

function log(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return { ollamaCalls: 0, claudeCodeReferrals: 0, routes: [] };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

class TaskRouter {
  constructor(ollamaUrl = 'http://localhost:11434') {
    this.ollamaUrl   = ollamaUrl;
    this.ollamaModel = process.env.OLLAMA_MODEL || 'mistral';
    this.stats       = loadStats();
  }

  // ── Local Ollama ─────────────────────────────────────────────────────────────
  async callOllama(prompt) {
    const t0  = Date.now();
    log('OLLAMA', `Sending ${prompt.length} chars to ${this.ollamaModel}`);

    const res = await fetch(`${this.ollamaUrl}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this.ollamaModel, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);

    const data    = await res.json();
    const elapsed = Date.now() - t0;

    log('OLLAMA', `Done in ${elapsed}ms — response ${data.response?.length ?? 0} chars`);

    this.stats.ollamaCalls++;
    this.stats.routes.push({ ts: new Date().toISOString(), route: 'ollama', model: this.ollamaModel, ms: elapsed });
    saveStats(this.stats);

    return { source: 'ollama', model: this.ollamaModel, text: data.response };
  }

  // ── Claude Code referral ─────────────────────────────────────────────────────
  referToClaudeCode(prompt) {
    log('ROUTER', 'Complex task — referring to Claude Code');
    this.stats.claudeCodeReferrals++;
    this.stats.routes.push({ ts: new Date().toISOString(), route: 'claude-code', ms: 0 });
    saveStats(this.stats);
    return {
      source: 'claude-code',
      model:  'n/a',
      text:   `This task needs Claude Code.\n\nCopy this prompt into your Claude Code session:\n\n---\n${prompt}\n---`,
    };
  }

  // ── Complexity assessment ────────────────────────────────────────────────────
  // Tune these keyword lists as you go — use --simple to override when auto-routing misses.
  assessComplexity(prompt) {
    const simple  = ['format','clean','extract','convert','parse','organise',
                     'organize','list','template','rename','sort'];
    const complex = ['design','architect','optimise','optimize','debug','reason',
                     'plan','refactor','security','tradeoff','implement','explain'];
    const lower   = prompt.toLowerCase();

    if (complex.some(kw => lower.includes(kw))) return 'complex';
    if (simple.some(kw =>  lower.includes(kw))) return 'simple';
    return prompt.length > 500 ? 'complex' : 'simple';
  }

  // ── Main router ──────────────────────────────────────────────────────────────
  async route(prompt, forceComplexity = null) {
    const complexity = forceComplexity ?? this.assessComplexity(prompt);
    log('ROUTER', `complexity=${complexity}${forceComplexity ? ' (forced)' : ' (auto)'}`);

    if (complexity === 'simple')  return this.callOllama(prompt);
    if (complexity === 'complex') return this.referToClaudeCode(prompt);
    throw new Error(`Unknown complexity: ${complexity}`);
  }

  getStats()   { return { ...this.stats }; }
  resetStats() {
    this.stats = { ollamaCalls: 0, claudeCodeReferrals: 0, routes: [] };
    saveStats(this.stats);
  }
}

module.exports = TaskRouter;
