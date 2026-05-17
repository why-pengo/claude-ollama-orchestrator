# Claude-Ollama Orchestrator

Routes generative tasks across three tiers — local Ollama, remote Ollama, and Claude Code — based on task complexity. Built for Claude Pro users; no Anthropic API key required.

## How it works

Every request is assessed against three keyword lists:

| Tier                 | Triggered by                                                                                                                                                                              | Node                              | Cost                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------- |
| **Simple** (tier 1)  | `format`, `extract`, `convert`, `parse`, `sort`, `list`, `rename`, `template`, `organise`, `organize`, `summarise`, `summarize`, `count`, `enumerate`, `outline`, `tldr`, `draft`, `stub` | Local Ollama (e.g. mistral 7B)    | Free                  |
| **Medium** (tier 2)  | `explain`, `reason`, `compare`, `describe`, `walkthrough`, `walk through`, `tutorial`, `analyse`, `analyze`                                                                               | Remote Ollama (e.g. Llama 3.1 8B) | Free                  |
| **Complex** (tier 3) | `architect`, `security`, `tradeoff`, `plan`, `clean`, `debug`, `refactor`, `design`, `implement`, `optimise`, `optimize`                                                                  | Claude Code session               | Your Pro subscription |

Simple tasks stream tokens directly to your terminal. Medium tasks do too — when a remote Ollama node is configured and available; otherwise they cascade to Claude Code. Complex tasks always print a ready-to-paste prompt for your Claude Code session.

## Why not route complex tasks to the Claude API?

If you have Claude Pro / Max, you already have Claude via Claude Code — a separate API account means separate billing on top of your subscription. This setup keeps it simple: Ollama handles mechanical work for free, and Claude Code (which you already have open) handles the rest.

## Model benchmarks (Apple M4 Pro)

| Model             | Tier   | Size  | Cold start | Warm | Notes                         |
| ----------------- | ------ | ----- | ---------- | ---- | ----------------------------- |
| `mistral`         | Simple | 4 GB  | ~20s       | ~3s  | Best default balance          |
| `llama3.2:3b`     | Simple | 2 GB  | ~5s        | <1s  | Fastest, good for high volume |
| `llama3.1:latest` | Medium | 5 GB  | ~10s       | ~3s  | Sensible default for tier 2   |
| `qwen3.6:latest`  | Medium | 24 GB | ~35s       | ~10s | More capable, larger download |

Cold start is a one-time cost per `ollama serve` session. Run a throwaway warm-up request if first-request latency matters.

## Requirements

- [Node.js](https://nodejs.org) 22+
- [Ollama](https://ollama.com) running locally (`ollama serve`)
- A model pulled, e.g. `ollama pull mistral`
- _(Optional)_ A remote Ollama node for medium-tier tasks (e.g. Linux box with an RTX GPU)

## Installation

```bash
git clone https://github.com/why-pengo/claude-ollama-orchestrator.git
cd claude-ollama-orchestrator
```

Install dependencies (runtime + dev tools):

```bash
make install
```

## Usage

```bash
node index.js "Your request"

# Force routing
node index.js --simple  "Format this JSON: {name:'alice'}"
node index.js --complex "Architect a microservice system"

# Pass a file (avoids shell substitution and ARG_MAX limits)
node index.js --file src/models.py "Extract all class names"
node index.js --simple --file data.csv "Convert this to JSON"

# Preview routing without executing
node index.js --dry-run "debug this function"
node index.js --dry-run --file src/models.py "Extract all class names"

# Live TUI dashboard
node index.js --dashboard

# Stats and log
node index.js --stats
node index.js --reset
```

Or via the Makefile:

```bash
make stats   # routing stats
make logs    # live log tail
make reset   # reset stats
```

## Environment variables

| Variable              | Default           | Description                                                                             |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `OLLAMA_MODEL`        | `mistral`         | Model for simple (tier 1) tasks                                                         |
| `OLLAMA_REMOTE_HOST`  | —                 | URL of remote Ollama node — enables medium tier (e.g. `http://192.168.1.10:11434`)      |
| `OLLAMA_REMOTE_MODEL` | `llama3.1:latest` | Model for medium (tier 2) tasks                                                         |
| `OLLAMA_PORT`         | `11434`           | Local Ollama port (used by the dashboard health check)                                  |
| `OLLAMA_ORCH_PATH`    | —                 | Full path to `index.js` — set in your shell profile for portable CLAUDE.md instructions |

Example shell profile entry:

```bash
export OLLAMA_MODEL=mistral
export OLLAMA_REMOTE_HOST=http://192.168.1.10:11434
export OLLAMA_REMOTE_MODEL=llama3.1:latest
export OLLAMA_ORCH_PATH=/path/to/claude-ollama-orchestrator/index.js
```

## CLAUDE.md integration

Add a task routing section to any project's `.claude/CLAUDE.md` so Claude Code offloads simple and medium tasks automatically:

```markdown
## Task routing — Ollama for generative tasks

For simple generative tasks, run the Ollama orchestrator via Bash:

    node ${OLLAMA_ORCH_PATH} --simple --file <path> "<instruction>"

**Send to Ollama (simple):** extract values · convert formats · parse/organise data · list items · rename fields · summarise threads · count occurrences · outline structure · draft messages · stub tests

**Send to Ollama (medium — use --medium flag):** explain · reason · compare · describe · walkthrough · walk through · tutorial · analyse · analyze

**Never send to Ollama:** make format · make lint · make test · make migrate
(these are deterministic CLI operations — run them directly)

**Send to Claude Code:** debug · refactor · design · implement · architect · security review · tradeoffs · planning
```

## Development

```bash
make test          # run the test suite (94 tests, no Ollama required)
make lint          # ESLint
make format        # Prettier --write
make format-check  # Prettier --check (used in CI)
make ci            # full pipeline: format-check + lint + test
make test-file FILE=tests/routing.test.js  # single file
```

Tests use Node's built-in `node:test` runner — no extra install needed to run them.

CI runs automatically on every push and PR to `main` via GitHub Actions.

## Routing decisions

The test suite locks in the routing matrix so keyword changes never silently break:

```
assessComplexity("Format this JSON")          → simple  ✓
assessComplexity("Extract all URLs")          → simple  ✓
assessComplexity("Explain TCP vs UDP")         → medium  ✓
assessComplexity("Debug this traceback")      → complex ✓
assessComplexity("Design a REST API")         → complex ✓
assessComplexity("List steps to implement X") → complex ✓  (implement beats list)
assessComplexity("Architect a system")        → complex ✓
assessComplexity("Clean up and organise")     → complex ✓  (clean beats organise)
```

## Tips

**Do**

- Warm up the model at the start of each session (`node index.js "say hello"`) to avoid cold-start latency on the first real task
- Use `--simple` / `--complex` / `--dry-run` until you trust auto-routing for your prompts
- Add keywords to the correct tier based on real misroutes you observe — run the exact misrouted prompt with `--dry-run` to confirm the fix
- Use `--stats` to track your Ollama vs Claude Code split over time

**Don't**

- Use a large model as your local default — pick the smallest that gives acceptable quality for simple tasks
- Send `black` / `isort` / `make test` to Ollama — they are deterministic CLI ops, not generative tasks
- Forget that `ollama serve` must be running before invoking the orchestrator
- Route sensitive data through Ollama if your machine could be compromised

## Troubleshooting

| Symptom                                         | Fix                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED localhost:11434`                  | Run `ollama serve` in another terminal                                                                                                                |
| `model not found`                               | Run `ollama pull mistral`                                                                                                                             |
| First request is slow                           | Normal — cold start. Subsequent requests will be fast                                                                                                 |
| All requests are slow                           | Model too large for your RAM; try `llama3.2:3b`                                                                                                       |
| `node $OLLAMA_ORCH_PATH` produces no output     | `OLLAMA_ORCH_PATH` may point through a symlink — ensure it resolves to the real path, or update to the latest version (fixes `fs.realpathSync` guard) |
| Medium tasks not using remote node              | `OLLAMA_REMOTE_HOST` not set — add it to your shell profile and re-source                                                                             |
| Wrong route for a prompt                        | Use `--dry-run` to preview, then move the keyword to the correct tier list in `ollama-router.js`                                                      |
| `[ERROR] File not found` with `--file`          | Path is relative to where you run the command — use an absolute path                                                                                  |
| `OLLAMA_ORCH_PATH` unset in Claude Code session | Add `export OLLAMA_ORCH_PATH=...` to `~/.zshrc` and restart the terminal / Claude Code                                                                |

## Roadmap

| #                                                                      | Feature                                 | Status  |
| ---------------------------------------------------------------------- | --------------------------------------- | ------- |
| [#1](https://github.com/why-pengo/claude-ollama-orchestrator/issues/1) | TUI dashboard (`--dashboard` mode)      | ✅ done |
| [#3](https://github.com/why-pengo/claude-ollama-orchestrator/issues/3) | Auto-fallback when Ollama is offline    | ✅ done |
| [#4](https://github.com/why-pengo/claude-ollama-orchestrator/issues/4) | `--dry-run` flag to preview routing     | ✅ done |
| [#5](https://github.com/why-pengo/claude-ollama-orchestrator/issues/5) | Estimated cost savings in `--stats`     | ✅ done |
| [#6](https://github.com/why-pengo/claude-ollama-orchestrator/issues/6) | Three-tier routing with remote GPU node | ✅ done |
