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

The router checks **complex keywords first**, then simple. Complex always wins if present.

**Simple keywords** (→ Ollama): `format, extract, convert, parse, organise, organize, list, template, rename, sort`

**Complex keywords** (→ Claude Code): `design, architect, optimise, optimize, debug, reason, plan, refactor, security, tradeoff, implement, explain, clean`

### Routing Fix Rule

When a task misroutes, **move the keyword to the complex list** — don't just remove it from simple. The router checks complex first; if a prompt has both a complex-intent word and an unrelated simple word, complex wins. Simply deleting from simple leaves the simple keyword matching.

### Three-Category Task Distinction

Always distinguish before routing:

| Category               | Examples                                   | Right tool                                  |
| ---------------------- | ------------------------------------------ | ------------------------------------------- |
| Deterministic tool ops | Format Python, lint, run tests             | CLI directly (`make format`, `black`, etc.) |
| Generative simple      | Extract values, convert formats, summarise | Ollama orchestrator                         |
| Generative complex     | Debug, design, refactor, security review   | Claude Code directly                        |

**Never send deterministic CLI ops to Ollama** — it can only generate text, not run tools.

---

## Monitoring

```bash
tail -f orchestrator.log | grep -E "REQUEST|ROUTER|OLLAMA|CLAUDE|ERROR"
```

Stats: `node index.js --stats`
Dashboard: `node index.js --dashboard`

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
