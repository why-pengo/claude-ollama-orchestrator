# Claude Code + Local Ollama Orchestration Guide

Route simple/mechanical tasks to local Ollama (free, private) and flag
complex tasks for your Claude Code session — no API key or extra billing needed.

> **Last reviewed:** May 2026 — Node 18+, Ollama 0.x, tested on Apple M4 Pro

---

## Architecture

```
Your Request
    ↓
node index.js "..."
    ├── Simple task?  → Ollama  (local, free, runs on your machine)
    └── Complex task? → "Take this to Claude Code" message + prompt to paste
```

### Why not route complex tasks to the Claude API?

If you have **Claude Pro / Max**, you already have Claude via Claude Code. A
separate API account means separate billing on top of your subscription.
This setup keeps it simple: Ollama handles the mechanical work for free,
and Claude Code (which you already have open) handles the rest.

### Three categories — pick the right tool

A common mistake is sending deterministic tool operations to Ollama. There
are three distinct categories:

| Category | Examples | Right tool |
|---|---|---|
| Deterministic tool ops | Format Python, lint, run tests, migrate DB | CLI directly (`make format`, `black`, etc.) |
| Generative simple tasks | Extract values, convert formats, summarise content | Ollama orchestrator |
| Generative complex tasks | Debug, design, refactor, security review | Claude Code directly |

**Ollama is for generative output** — tasks where a language model produces
the answer. It cannot run `black` or `isort`; it can only generate text.
If a task has a deterministic CLI tool that does the job, use the tool.

### Routing Reference

| Task Type                    | Backend      | Example                        |
|------------------------------|--------------|--------------------------------|
| Data formatting              | Ollama       | Format JSON, convert CSV       |
| Simple text transformations  | Ollama       | Convert markdown to HTML       |
| Extract / parse / organise   | Ollama       | Pull emails from text          |
| Write documentation drafts   | Ollama       | Basic README, comments         |
| Code cleanup / refactoring   | Claude Code  | Clean up, simplify, reorganise |
| Complex code generation      | Claude Code  | Design a service, algorithm    |
| Architecture / planning      | Claude Code  | System design, tradeoffs       |
| Debugging / security review  | Claude Code  | Find bugs, audit for vulns     |

---

## Prerequisites

- **Claude Code** installed (`claude --version`)
- **Ollama** installed and at least one model pulled
- **Node.js 18+** — has native `fetch` built in, no extra packages needed

No API key required.

---

## Step 1 — Choose and Pull an Ollama Model

Model choice matters a lot for response time. Benchmarks on **Apple M4 Pro**:

| Model         | Size  | Cold start | Warm      | Recommended for          |
|---------------|-------|-----------|-----------|--------------------------|
| `llama3.2:3b` | 2 GB  | ~5s       | < 1s      | Fastest, high-volume     |
| `mistral`     | 4 GB  | ~20s      | ~3s       | Best balance (default)   |
| `qwen3.6`     | 23 GB | ~30s      | ~10s      | High quality, slow       |

> **Cold start** = first request after `ollama serve` (model loads into memory).
> **Warm** = subsequent requests in the same session. Always test warm — that's
> your real-world speed.

```bash
# Start Ollama (keep this terminal open)
ollama serve

# Pull the recommended model
ollama pull mistral

# List what you have
ollama list

# Quick connectivity test
curl http://localhost:11434/api/generate \
  -d '{"model":"mistral","prompt":"Say hello","stream":false}'
# Expected: JSON with a "response" field
```

---

## Step 2 — Create `ollama-router.js`

```javascript
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
    const simple  = ['format','extract','convert','parse','organise',
                     'organize','list','template','rename','sort'];
    const complex = ['design','architect','optimise','optimize','debug','reason',
                     'plan','refactor','security','tradeoff','implement','explain','clean'];
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
```

---

## Step 3 — Create `claude-orchestrator.js`

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

**Edit `mySkills` and `myRules` to match your own workflow.**

```javascript
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
```

---

## Step 5 — Setup & First Run

```bash
# 1. Verify Node.js version (must be 18+)
node --version

# 2. Start Ollama in another terminal
ollama serve

# 3. Set your model (no API key needed)
export OLLAMA_MODEL=mistral

# 4. Warm up the model — first request loads it into memory (~20s on M4 Pro)
node index.js "Say hello"

# 5. Now test for real — should be fast (~3s warm)
node index.js "Format this JSON: {name:'alice',age:30}"

# 6. Test complex routing — should be instant, no model call
node index.js "Design a REST API for a multi-tenant blog platform"

# 7. Test a skill trigger
node index.js "code-review: function login(u){return db.query('SELECT * FROM users WHERE id='+u)}"

# 8. Check stats
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
└── .env  (optional)        ← OLLAMA_MODEL=mistral
```

**Env vars:**

| Var | Default | Purpose |
|-----|---------|---------|
| `OLLAMA_MODEL` | `mistral` | Local model to use |

- [ ] `ollama-router.js` created
- [ ] `claude-orchestrator.js` created
- [ ] `index.js` created and skills/rules customised to your workflow
- [ ] Node.js 18+ confirmed (`node --version`)
- [ ] Ollama running with a model pulled (`ollama list`)

---

## Example Output

```
$ node index.js "Format this JSON: {name:'alice',age:30}"

[2026-05-09T12:30:34.566Z] [REQUEST] Format this JSON: {name:'alice',age:30}
[2026-05-09T12:30:34.566Z] [ROUTER] complexity=simple (auto)
[2026-05-09T12:30:34.566Z] [OLLAMA] Sending 173 chars to mistral
[2026-05-09T12:30:37.841Z] [OLLAMA] Done in 3275ms — response 537 chars

SOURCE : OLLAMA  (mistral)
------------------------------------------------------------
{
  "name": "alice",
  "age": 30
}
```

```
$ node index.js "Design a REST API for a blog"

[2026-05-09T12:26:36.277Z] [REQUEST] Design a REST API for a blog
[2026-05-09T12:26:36.277Z] [ROUTER] complexity=complex (auto)
[2026-05-09T12:26:36.277Z] [ROUTER] Complex task — referring to Claude Code

SOURCE : CLAUDE-CODE  (n/a)
------------------------------------------------------------
This task needs Claude Code.

Copy this prompt into your Claude Code session:

---
Design a REST API for a blog
---
```

---

## Customising the Router

### Change the local model

```bash
export OLLAMA_MODEL=llama3.2    # more capable
export OLLAMA_MODEL=llama3.2:3b # fastest on Apple Silicon
```

### Add your own routing keywords

In `ollama-router.js`, expand the keyword lists:

```javascript
const simple  = [..., 'summarise', 'translate', 'your-keyword'];
const complex = [..., 'migrate', 'your-keyword'];
```

**Fixing a misroute:** When a task routes to Ollama but shouldn't, the
instinct is to remove the matching keyword from `simple`. That's often
not enough — if the prompt also contains another simple keyword, it will
still match. Instead, add the offending word to `complex`. Complex is
checked first, so it will always win.

```javascript
// Wrong fix — 'organise' still matches simple and wins
const simple = ['format', /* removed: 'clean' */ 'organise', ...];

// Right fix — 'clean' in complex wins before 'organise' is checked
const complex = [..., 'clean'];
```

After any keyword change, re-run the exact prompt that misrouted to
confirm the fix before committing.

---

## Performance Notes (Apple Silicon)

Tested on **Apple M4 Pro** with Ollama running locally.

| Model         | Size  | Cold start | Warm  | Verdict                          |
|---------------|-------|-----------|-------|----------------------------------|
| `llama3.2:3b` | 2 GB  | ~5s       | <1s   | Best for high-volume simple tasks|
| `mistral`     | 4 GB  | ~20s      | ~3s   | Good default balance             |
| `qwen3.6`     | 23 GB | ~30s      | ~10s  | Overkill for simple routing      |

**Cold start is a one-time cost per session.** After the first request,
the model stays warm in memory for the duration of your `ollama serve` session.
Run a throwaway warm-up request if latency matters on the first real task.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED localhost:11434` | Run `ollama serve` in another terminal |
| `model not found` | Run `ollama pull mistral` |
| First request is very slow | Normal — cold start. Subsequent requests will be fast |
| All requests are slow | Model is too large for your RAM; try `llama3.2:3b` |
| `fetch is not defined` | Upgrade to Node.js 18+: `node --version` |
| Wrong route (simple sent to Ollama when it shouldn't be) | Use `--complex` flag and add keyword to complex list |

---

## Using with Claude Code (via CLAUDE.md)

You can instruct Claude Code to route tasks automatically by adding a
routing section to your project's `.claude/CLAUDE.md`. Claude Code will
read the file, pass content inline, and call the orchestrator via Bash.

```markdown
## Task routing — Ollama for generative simple tasks

For generative simple tasks, offload to the local Ollama orchestrator:

    node /path/to/claude_with_local_llm/index.js --simple "<prompt with content inline>"

| Category | Examples | Tool |
|---|---|---|
| Deterministic tool ops | Format Python, lint, run tests | CLI directly |
| Generative simple tasks | Extract values, convert formats, summarise | Ollama orchestrator |
| Generative complex tasks | Debug, design, refactor, security | Claude Code directly |

When reading files to pass to Ollama, pipe the content inline:

    node /path/to/index.js --simple "Extract all route paths from: $(cat routers/bp.py)"
```

**Important:** never send deterministic tool operations (formatting, linting,
migrations) to Ollama — use the CLI tools directly. Ollama is only for
tasks where a language model generates the output.

---

## Tips

**Do**
- Run a warm-up request at the start of each session to pre-load the model
- Use `--simple` / `--complex` flags until you trust auto-routing
- Gradually expand the keyword lists based on real misroutes you observe
- Use `--stats` to track how often you're hitting Ollama vs Claude Code
- Set `OLLAMA_MODEL` in every session that will call the orchestrator

**Don't**
- Use a 20GB+ model as your default for simple tasks — pick the smallest
  model that gives acceptable quality
- Route sensitive data through Ollama if your machine could be compromised
- Forget that `ollama serve` must be running before invoking the script
- Send `black`/`isort`/`flake8` tasks to Ollama — run the CLI tools directly

---

*Guide version: May 2026 — Node 18+, Ollama 0.x, Apple M4 Pro benchmarks*
