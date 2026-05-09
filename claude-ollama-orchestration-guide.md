# Claude Code + Local Ollama Orchestration Guide

Use Claude Code as an intelligent planner/manager that routes tasks between
local Ollama (free) and the Claude API (high quality) to cut costs 50-70%
while keeping your conversation-style workflow intact.

> **Last reviewed:** May 2026 — uses Node 18+, Ollama 0.x, `claude-sonnet-4-6`
> **Updated:** May 2026 — fixed input-token cost tracking, persistent stats, per-call logging, env-var model config

---

## Architecture

```
Your Request
    ↓
Claude Code (Planner / Orchestrator)
    ├── Simple task?  → Ollama  (local, free, fast)
    ├── Complex task? → Claude API (paid, high quality)
    └── Mixed task?   → Break into subtasks, route each part
    ↓
Final Output
```

### Routing Reference

| Task Type                    | Backend    | Example                           |
|------------------------------|------------|-----------------------------------|
| Data formatting / cleanup    | Ollama     | Format JSON, clean CSV            |
| Simple text transformations  | Ollama     | Convert markdown to HTML          |
| Extract / parse / organise   | Ollama     | Pull emails from text             |
| Write documentation drafts   | Ollama     | Basic README, comments            |
| Complex code generation      | Claude API | Design a service, write algorithm |
| Architecture / planning      | Claude API | System design, tradeoff analysis  |
| Debugging / security review  | Claude API | Find bugs, audit for vulns        |
| Synthesis / final output     | Claude API | Combine subtask results           |

---

## Prerequisites

- **Claude Code** installed (`claude --version`)
- **Ollama** installed and at least one model pulled
- **Node.js 18+** — has native `fetch` built in, no extra packages needed
- **Anthropic API key** exported as `ANTHROPIC_API_KEY`

---

## Step 1 — Test Ollama Connectivity

```bash
# 1a. Start Ollama (keep this terminal open)
ollama serve

# 1b. Pull a model if you haven't already
ollama pull mistral          # recommended: fast + good quality
# ollama pull llama3         # more capable, slower
# ollama pull tinyllama      # fastest, lower quality

# 1c. List available models
ollama list

# 1d. Test a request
curl http://localhost:11434/api/generate \
  -d '{"model":"mistral","prompt":"Say hello","stream":false}'
# Expected: JSON with a "response" field
```

---

## Step 2 — Create `ollama-router.js`

This module decides where each prompt goes and calls the right backend.

```javascript
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
    // Override either model via env var without editing source
    this.ollamaModel = process.env.OLLAMA_MODEL || 'mistral';
    this.claudeModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    this.stats       = loadStats();  // persisted across runs
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

    // FIX: original guide only counted output tokens — input tokens also cost money
    // Sonnet 4.6: $3/MTok input, $15/MTok output
    const inputCost  = (data.usage?.input_tokens  ?? 0) * 0.000003;
    const outputCost = (data.usage?.output_tokens ?? 0) * 0.000015;
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
  // NOTE: keyword matching is intentionally simple — tune these lists as you go.
  // Use --simple / --complex flags to override until you trust auto-routing.
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
  // WARNING: this makes 2+ Claude calls. For borderline tasks, --complex is cheaper.
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
```

---

## Step 3 — Create `claude-orchestrator.js`

Wraps the router and applies your personal skills + rules to every prompt.

```javascript
// claude-orchestrator.js

const fs   = require('fs');
const path = require('path');
const TaskRouter = require('./ollama-router');

const LOG_FILE = path.join(__dirname, 'orchestrator.log');

function log(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

class ClaudeOrchestrator {
  constructor(skills = {}, rules = {}) {
    this.router  = new TaskRouter();
    this.skills  = skills;  // trigger keyword → system-prompt string
    this.rules   = rules;   // label → constraint string
    this.history = [];
  }

  applySkills(prompt) {
    let out     = prompt;
    let applied = [];
    for (const [keyword, skillPrompt] of Object.entries(this.skills)) {
      if (prompt.toLowerCase().includes(keyword)) {
        out = `${skillPrompt}\n\nRequest: ${out}`;
        applied.push(keyword);
      }
    }
    if (applied.length) log('SKILLS', `Applied: ${applied.join(', ')}`);
    return out;
  }

  enforceRules(prompt) {
    const constraints = Object.values(this.rules).join('\n');
    return constraints ? `${prompt}\n\n--- Rules ---\n${constraints}` : prompt;
  }

  async process(userRequest, forceComplexity = null) {
    log('REQUEST', userRequest.slice(0, 120) + (userRequest.length > 120 ? '…' : ''));

    let prompt = this.applySkills(userRequest);
    prompt     = this.enforceRules(prompt);

    const result = await this.router.route(prompt, forceComplexity);

    this.history.push({ request: userRequest, result, ts: new Date() });

    console.log('\n' + '-'.repeat(60));
    console.log(`SOURCE : ${result.source.toUpperCase()}  (${result.model})`);
    if (result.cost) console.log(`COST   : $${result.cost.toFixed(4)}`);
    console.log('-'.repeat(60));
    console.log(result.text);
    console.log('='.repeat(60) + '\n');

    return result;
  }

  getStats() {
    return { ...this.router.getStats(), totalRequests: this.history.length };
  }

  reset() {
    this.router.resetStats();
    this.history = [];
  }
}

module.exports = ClaudeOrchestrator;
```

---

## Step 4 — Create `index.js`

Your entry point. **Edit `mySkills` and `myRules` to match your own setup.**

```javascript
#!/usr/bin/env node
// index.js

const ClaudeOrchestrator = require('./claude-orchestrator');

// Your custom skills
// The key is a trigger word; when it appears in your request the skill prompt
// is prepended automatically.
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

// Your custom rules — applied to every request automatically
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
Claude Code + Ollama Orchestrator
----------------------------------
Usage:
  node index.js "Your request"
  node index.js --stats
  node index.js --reset

Force a backend (bypasses auto-routing):
  node index.js --simple  "Format this JSON ..."
  node index.js --complex "Design a microservice ..."

Examples:
  node index.js "Format this JSON: {name:'alice'}"
  node index.js "code-review: check this for SQL injection"
  node index.js "Design a REST API for a blog"
    `);
    return;
  }

  if (args[0] === '--stats') {
    const stats = orchestrator.getStats();
    const ollama = stats.ollamaCalls;
    const claude = stats.claudeCalls;
    const total  = ollama + claude;
    const pct    = total ? Math.round((ollama / total) * 100) : 0;
    console.log('\nOrchestrator Stats');
    console.log('------------------');
    console.log(`Ollama calls : ${ollama}  (${pct}% of total — free)`);
    console.log(`Claude calls : ${claude}  (${100 - pct}% of total — paid)`);
    console.log(`Total cost   : $${stats.totalCost.toFixed(4)}`);
    console.log(`Total calls  : ${total}`);
    if (stats.routes?.length) {
      const last5 = stats.routes.slice(-5).reverse();
      console.log('\nLast 5 routes:');
      last5.forEach(r => console.log(`  ${r.ts}  ${r.route.padEnd(6)}  ${r.ms}ms${r.cost ? `  $${r.cost.toFixed(4)}` : ''}`));
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

  try {
    await orchestrator.process(prompt, force);
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

main();
```

---

## Step 5 — Setup & First Run

```bash
# 1. Verify Node.js version (must be 18+)
node --version

# 2. Make sure Ollama is running in another terminal
ollama serve

# 3. Set your API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 4. No npm install needed — Node 18+ includes fetch natively

# 5. Test a simple task → should route to Ollama (free)
node index.js "Format this JSON: {name:'alice',age:30}"

# 6. Test a complex task → should route to Claude API
node index.js "Design a REST API for a multi-tenant blog platform"

# 7. Test a skill trigger
node index.js "code-review: function login(u){return db.query('SELECT * FROM users WHERE id='+u)}"

# 8. Force a specific backend
node index.js --simple  "Summarise this in one sentence: ..."
node index.js --complex "Explain the tradeoffs of event sourcing vs CQRS"

# 9. Check stats
node index.js --stats
```

---

## File Checklist

```
your-project/
├── ollama-router.js        ← Step 2
├── claude-orchestrator.js  ← Step 3
├── index.js                ← Step 4
├── orchestrator.log        ← auto-created on first run (tail -f to monitor)
├── orchestrator-stats.json ← auto-created on first run, persists across runs
└── .env  (optional)        ← env vars below
```

**Env vars** (all optional except `ANTHROPIC_API_KEY`):

| Var | Default | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | **Required.** Your Anthropic API key |
| `OLLAMA_MODEL` | `mistral` | Local model to use |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Claude model to use |

- [ ] `ollama-router.js` created
- [ ] `claude-orchestrator.js` created
- [ ] `index.js` created and skills/rules customised to your workflow
- [ ] `ANTHROPIC_API_KEY` set in environment
- [ ] Node.js 18+ confirmed (`node --version`)
- [ ] Ollama running with a model pulled (`ollama list`)

---

## Example Output

```
$ node index.js "Format this JSON: {name:'alice',age:30}"

[ROUTER] complexity=simple
[OLLAMA] Done in 310ms

SOURCE : OLLAMA  (mistral)
------------------------------------------------------------
{
  "name": "alice",
  "age": 30
}
```

```
$ node index.js "Design a caching strategy for a high-traffic API"

[ROUTER] complexity=complex
[CLAUDE] Done in 2740ms  est. cost $0.0028

SOURCE : CLAUDE  (claude-sonnet-4-6)
------------------------------------------------------------
## Caching Strategy for a High-Traffic API
...
```

---

## Customising the Router

### Change the local model

Set the env var — no source edit needed:
```bash
OLLAMA_MODEL=llama3 node index.js "your request"
# or export it:
export OLLAMA_MODEL=llama3
```

### Use a different Claude model

```bash
# Most capable (higher cost):
CLAUDE_MODEL=claude-opus-4-7 node index.js "your request"

# Cheapest option:
CLAUDE_MODEL=claude-haiku-4-5-20251001 node index.js "your request"
```

### Add your own routing keywords

```javascript
const simple  = [..., 'your-simple-keyword'];
const complex = [..., 'your-complex-keyword'];
```

---

## Cost Savings Estimate

*Based on Sonnet 4.6 pricing ($3/$15 per MTok input/output); Ollama is always free.*

| Monthly requests | All-Claude cost | 75% Ollama | Saving  |
|-----------------|-----------------|------------|---------|
| 100             | ~$0.50          | ~$0.13     | **74%** |
| 500             | ~$2.50          | ~$0.63     | **75%** |
| 2,000           | ~$10.00         | ~$2.50     | **75%** |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED localhost:11434` | Run `ollama serve` in another terminal |
| `model not found` | Run `ollama pull mistral` |
| `invalid x-api-key` | `export ANTHROPIC_API_KEY="sk-ant-..."` |
| Very slow Ollama responses | Try `ollama pull tinyllama` (fastest) |
| `fetch is not defined` | Upgrade to Node.js 18+: `node --version` |
| Claude returns 529 overloaded | Add retry with exponential back-off |
| High Claude costs | Move more task types to `simple` keywords |

---

## Tips

**Do**
- Start with `--complex` for everything until you trust auto-routing
- Gradually expand the `simple` keyword list as you gain confidence
- Use `--stats` regularly to track real savings
- Keep security / compliance / production tasks on `--complex`

**Don't**
- Route sensitive data to Ollama if your local machine is not secure
- Set `max_tokens` higher than needed (drives up API cost)
- Forget to keep `ollama serve` running before invoking the script

---

*Guide version: May 2026 — Node 18+, Ollama 0.x, claude-sonnet-4-6*
