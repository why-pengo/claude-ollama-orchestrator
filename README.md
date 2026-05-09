# Claude-Ollama Orchestrator

Routes generative tasks across three tiers — local Ollama, remote Ollama, and Claude Code — based on task complexity. Built for Claude Pro users; no Anthropic API key required.

## How it works

Every request is assessed against three keyword lists:

| Tier                 | Triggered by                                                                              | Node                              | Cost                  |
| -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- | --------------------- |
| **Simple** (tier 1)  | `format`, `extract`, `convert`, `parse`, `sort`, `list`, `rename`, `template`, `organise` | Local Ollama (e.g. mistral 7B)    | Free                  |
| **Medium** (tier 2)  | `debug`, `explain`, `refactor`, `design`, `implement`, `reason`, `optimise`               | Remote Ollama (e.g. Qwen 2.5 32B) | Free                  |
| **Complex** (tier 3) | `architect`, `security`, `tradeoff`, `plan`, `clean`, …                                   | Claude Code session               | Your Pro subscription |

Simple and medium tasks stream tokens directly to your terminal. Complex tasks print a ready-to-paste prompt for your Claude Code session. If a node is offline, the orchestrator silently cascades to the next tier.

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

| Variable              | Default       | Description                                                                             |
| --------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `OLLAMA_MODEL`        | `mistral`     | Model for simple (tier 1) tasks                                                         |
| `OLLAMA_REMOTE_HOST`  | —             | URL of remote Ollama node — enables medium tier (e.g. `http://192.168.1.10:11434`)      |
| `OLLAMA_REMOTE_MODEL` | `qwen2.5:32b` | Model for medium (tier 2) tasks                                                         |
| `OLLAMA_PORT`         | `11434`       | Local Ollama port (used by the dashboard health check)                                  |
| `OLLAMA_ORCH_PATH`    | —             | Full path to `index.js` — set in your shell profile for portable CLAUDE.md instructions |

Example shell profile entry:

```bash
export OLLAMA_MODEL=mistral
export OLLAMA_REMOTE_HOST=http://192.168.1.10:11434
export OLLAMA_REMOTE_MODEL=qwen2.5:32b
export OLLAMA_ORCH_PATH=/path/to/claude-ollama-orchestrator/index.js
```

## CLAUDE.md integration

Add a task routing section to any project's `.claude/CLAUDE.md` so Claude Code offloads simple and medium tasks automatically:

```markdown
## Task routing — Ollama for generative tasks

For simple generative tasks, run the Ollama orchestrator via Bash:

    node ${OLLAMA_ORCH_PATH} --simple --file <path> "<instruction>"

**Send to Ollama (simple):** extract values · convert formats · parse/organise data · list items · rename fields

**Send to Ollama (medium — omit --simple flag):** debug · explain · refactor · design · implement

**Never send to Ollama:** make format · make lint · make test · make migrate
(these are deterministic CLI operations — run them directly)

**Send to Claude Code:** architect · security review · tradeoffs · planning
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
assessComplexity("Debug this traceback")      → medium  ✓
assessComplexity("Design a REST API")         → medium  ✓
assessComplexity("List steps to implement X") → medium  ✓  (implement beats list)
assessComplexity("Architect a system")        → complex ✓
assessComplexity("Clean up and organise")     → complex ✓  (clean beats organise)
```

## Roadmap

| #                                                                      | Feature                                 | Status  |
| ---------------------------------------------------------------------- | --------------------------------------- | ------- |
| [#1](https://github.com/why-pengo/claude-ollama-orchestrator/issues/1) | TUI dashboard (`--dashboard` mode)      | ✅ done |
| [#3](https://github.com/why-pengo/claude-ollama-orchestrator/issues/3) | Auto-fallback when Ollama is offline    | ✅ done |
| [#4](https://github.com/why-pengo/claude-ollama-orchestrator/issues/4) | `--dry-run` flag to preview routing     | ✅ done |
| [#5](https://github.com/why-pengo/claude-ollama-orchestrator/issues/5) | Estimated cost savings in `--stats`     | ✅ done |
| [#6](https://github.com/why-pengo/claude-ollama-orchestrator/issues/6) | Three-tier routing with remote GPU node | ✅ done |
