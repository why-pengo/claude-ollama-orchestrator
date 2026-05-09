// ollama-router.js
// Requires Node.js 18+ (native fetch — no npm install needed)

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
    return { ollamaCalls: 0, claudeCalls: 0, totalCost: 0, routes: [] };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

class TaskRouter {
  constructor(ollamaUrl = 'http://localhost:11434') {
    this.ollamaUrl   = ollamaUrl;
    this.claudeKey   = process.env.ANTHROPIC_API_KEY;
    this.ollamaModel = process.env.OLLAMA_MODEL || 'mistral';
    this.claudeModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
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

  // ── Claude API ───────────────────────────────────────────────────────────────
  async callClaude(prompt) {
    const t0  = Date.now();
    log('CLAUDE', `Sending ${prompt.length} chars to ${this.claudeModel}`);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         this.claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      this.claudeModel,
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Claude API error: ${err.error?.message}`);
    }

    const data    = await res.json();
    const elapsed = Date.now() - t0;

    // Fix: cost includes both input AND output tokens
    const inputCost  = (data.usage?.input_tokens  ?? 0) * 0.000003;   // $3/MTok
    const outputCost = (data.usage?.output_tokens ?? 0) * 0.000015;   // $15/MTok
    const cost       = inputCost + outputCost;

    log('CLAUDE', `Done in ${elapsed}ms — in:${data.usage?.input_tokens} out:${data.usage?.output_tokens} tokens — est. cost $${cost.toFixed(4)}`);

    this.stats.claudeCalls++;
    this.stats.totalCost += cost;
    this.stats.routes.push({
      ts:    new Date().toISOString(),
      route: 'claude',
      model: this.claudeModel,
      ms:    elapsed,
      inputTokens:  data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      cost,
    });
    saveStats(this.stats);

    return { source: 'claude', model: this.claudeModel, text: data.content[0].text, cost };
  }

  // ── Complexity assessment ────────────────────────────────────────────────────
  assessComplexity(prompt) {
    const simple  = ['format','clean','extract','convert','parse','organise',
                     'organize','list','template','rename','sort'];
    const complex = ['design','architect','optimise','optimize','debug','reason',
                     'plan','refactor','security','tradeoff','implement','explain'];
    const lower   = prompt.toLowerCase();

    const isMixed = lower.includes('first') &&
                    (lower.includes('then') || lower.includes('next'));
    if (isMixed)                                 return 'mixed';
    if (complex.some(kw => lower.includes(kw))) return 'complex';
    if (simple.some(kw =>  lower.includes(kw))) return 'simple';
    return prompt.length > 500 ? 'complex' : 'simple';
  }

  // ── Main router ──────────────────────────────────────────────────────────────
  async route(prompt, forceComplexity = null) {
    const complexity = forceComplexity ?? this.assessComplexity(prompt);
    log('ROUTER', `complexity=${complexity}${forceComplexity ? ' (forced)' : ' (auto)'}`);

    if (complexity === 'simple')  return this.callOllama(prompt);
    if (complexity === 'complex') return this.callClaude(prompt);
    if (complexity === 'mixed')   return this.routeMixed(prompt);
    throw new Error(`Unknown complexity: ${complexity}`);
  }

  // ── Mixed: plan → subtasks → synthesise ─────────────────────────────────────
  async routeMixed(prompt) {
    log('ROUTER', 'Mixed — breaking into subtasks via Claude');

    const plan = await this.callClaude(
      `Break this task into subtasks. Reply ONLY with a JSON array, no other text:
[{"subtask":"...", "type":"simple|complex"}]

Task: ${prompt}`
    );

    let subtasks;
    try {
      const match = plan.text.match(/\[[\s\S]*]/);
      subtasks = JSON.parse(match ? match[0] : plan.text);
    } catch {
      log('ROUTER', 'Could not parse subtask JSON — routing whole task as complex');
      return this.callClaude(prompt);
    }

    const results = await Promise.all(
      subtasks.map(async st => ({
        subtask: st.subtask,
        result:  (await this.route(st.subtask, st.type)).text,
      }))
    );

    return this.callClaude(
      `Combine these results into a single coherent response.

${results.map((r, i) => `## Subtask ${i + 1}: ${r.subtask}\n${r.result}`).join('\n\n')}

Original request: ${prompt}`
    );
  }

  getStats()   { return { ...this.stats }; }
  resetStats() {
    this.stats = { ollamaCalls: 0, claudeCalls: 0, totalCost: 0, routes: [] };
    saveStats(this.stats);
  }
}

module.exports = TaskRouter;
