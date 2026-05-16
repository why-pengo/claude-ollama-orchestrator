# Claude Ollama Orchestrator

Routes mechanical tasks to local Ollama (free) and flags complex tasks for Claude Code (Claude Pro subscription). No Anthropic API key required.

**Repo:** https://github.com/why-pengo/claude-ollama-orchestrator

---

## Stack

- Node.js 22+ (native fetch, ESM modules — no CommonJS)
- Ollama local server (default model: mistral)
- Ink + React for the TUI dashboard

## Key Files

| File                      | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `index.js`                | CLI entry point — `parseArgs`, `--file`, `--stats`, `--dashboard` flags |
| `ollama-router.js`        | Routing logic, Ollama calls, stats persistence, cost estimation         |
| `claude-orchestrator.js`  | Skills/rules wrapper, logging                                           |
| `dashboard.js`            | Full-screen Ink TUI dashboard                                           |
| `orchestrator.log`        | Append-only log (gitignored)                                            |
| `orchestrator-stats.json` | Persisted stats across runs (gitignored)                                |

## Env Vars

| Var                | Default   | Purpose                                                                                             |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `OLLAMA_MODEL`     | `mistral` | Which local model to use                                                                            |
| `OLLAMA_ORCH_PATH` | —         | Full path to `index.js`; set in shell profile for portable CLAUDE.md instructions in other projects |

Source via `source env.source` (gitignored) or set in shell profile.

## Hardware Context

Apple M4 Pro. Mistral (4GB) warm ~2–6s, cold ~20s. qwen3:4b (23GB) too slow for simple tasks (~30s cold, ~10s warm) — stick with mistral for routing.

---

## Routing Logic

The router checks **complex keywords first**, then medium, then simple. Complex always wins if present. Within simple, **size is checked second**: a simple-keyword prompt longer than `OLLAMA_SIMPLE_SIZE_LIMIT` (default 20 000 chars) is escalated to tier 2 to avoid OOM / timeout on the local model.

**Simple keywords** (→ Local Ollama, or tier 2 if oversized): `format, extract, convert, parse, organise, organize, list, template, rename, sort`

**Medium keywords** (→ Remote Ollama): `explain, reason`

**Complex keywords** (→ Claude Code): `architect, security, tradeoff, plan, clean, debug, refactor, design, implement, optimise, optimize`

### Routing Fix Rule

When a task misroutes, **move the keyword to the correct tier** — don't just remove it from the wrong one. The router checks complex first; if a prompt has both a complex-intent word and a simpler word, complex wins.

### Three-Category Task Distinction

Always distinguish before routing:

| Category               | Examples                                   | Right tool                                  |
| ---------------------- | ------------------------------------------ | ------------------------------------------- |
| Deterministic tool ops | Format Python, lint, run tests             | CLI directly (`make format`, `black`, etc.) |
| Generative simple      | Extract values, convert formats, summarise | Local Ollama (tier 1)                       |
| Generative medium      | Explain concepts, reason through options   | Remote Ollama (tier 2)                      |
| Generative complex     | Debug, design, refactor, security review   | Claude Code directly (tier 3)               |

**Never send deterministic CLI ops to Ollama** — it can only generate text, not run tools.

---

## Monitoring

```bash
tail -f orchestrator.log | grep -E "REQUEST|ROUTER|OLLAMA|CLAUDE|CLASSIFY|WARN|ERROR"
```

Stats: `node index.js --stats`
Dashboard: `node index.js --dashboard`

### Claude Code activity tracking

A global `Stop` hook in `~/.claude/settings.json` calls `node $OLLAMA_ORCH_PATH --track` after every Claude Code response, logging a `[CLAUDE]` entry and incrementing `claudeCodeReferrals`. The hook warns to stderr if `OLLAMA_ORCH_PATH` is unset.

A global `UserPromptSubmit` hook calls `node $OLLAMA_ORCH_PATH --classify` on every prompt, logging a `[CLASSIFY]` entry showing how the router would have routed the task — without enforcing it. Useful for auditing whether tasks that went to Claude Code could have been offloaded to Ollama.

Both hooks skip when `cwd` matches the orchestrator's own repo so meta-work on this project doesn't pollute the stats.

---

## Using the Orchestrator from Other Projects

Add a task routing section to `.claude/CLAUDE.md` in the target project. Example snippet:

```
## Task Routing via Ollama Orchestrator

For generative simple tasks (extract, convert, summarise), use:
  node $OLLAMA_ORCH_PATH --simple --file <path> "<prompt>"

For complex tasks (debug, design, refactor), handle in Claude Code directly.
Do NOT send deterministic operations (make format, black, npm test) to Ollama.
```

Tested on health_track PR #6 (2026-05-09): "Extract all API routes from bp.py" → Ollama → mistral → correct table in 19s.

---

## GitHub PR Review Replies

When addressing a PR review comment, reply **in the specific comment thread**, not as a top-level PR comment:

```bash
# Find comment ID
gh api repos/{owner}/{repo}/pulls/{pr}/comments

# Reply in thread
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies -f body="..."
```

Using `gh pr comment` posts a general top-level comment — reviewers lose the inline context.
