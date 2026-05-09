# Claude-Ollama Orchestrator

Routes simple generative tasks to a local [Ollama](https://ollama.com) model (free, private) and complex tasks to your open Claude Code session. Built for Claude Pro users — no Anthropic API key required.

## How it works

Every request is assessed against two keyword lists:

| Route                    | Triggered by                                                                                       | Cost                  |
| ------------------------ | -------------------------------------------------------------------------------------------------- | --------------------- |
| **Ollama** (local)       | `format`, `extract`, `convert`, `parse`, `sort`, `list`, `rename`, `template`, `organise`          | Free                  |
| **Claude Code** referral | `design`, `architect`, `debug`, `explain`, `refactor`, `security`, `implement`, `clean`, `plan`, … | Your Pro subscription |

Complex tasks print a ready-to-paste prompt for your Claude Code session. Simple tasks stream tokens from Ollama directly to your terminal.

## Requirements

- [Node.js](https://nodejs.org) 18+
- [Ollama](https://ollama.com) running locally (`ollama serve`)
- A model pulled, e.g. `ollama pull mistral`

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
node index.js --complex "Design a microservice architecture"

# Pass a file (avoids shell substitution and ARG_MAX limits)
node index.js --file src/models.py "Extract all class names"
node index.js --simple --file data.csv "Convert this to JSON"

# Preview routing without executing
node index.js --dry-run "clean up and organise this file"
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

| Variable           | Default   | Description                                                                             |
| ------------------ | --------- | --------------------------------------------------------------------------------------- |
| `OLLAMA_MODEL`     | `mistral` | Model to use for simple tasks                                                           |
| `OLLAMA_PORT`      | `11434`   | Port Ollama listens on (used by the dashboard health check)                             |
| `OLLAMA_ORCH_PATH` | —         | Full path to `index.js` — set in your shell profile for portable CLAUDE.md instructions |

Example shell profile entry:

```bash
export OLLAMA_MODEL=mistral
export OLLAMA_ORCH_PATH=/path/to/claude-ollama-orchestrator/index.js
```

## CLAUDE.md integration

Add a task routing section to any project's `.claude/CLAUDE.md` so Claude Code offloads simple tasks automatically:

```markdown
## Task routing — Ollama for simple generative tasks

For simple generative tasks, run the Ollama orchestrator via Bash:

    node ${OLLAMA_ORCH_PATH} --simple --file <path> "<instruction>"

**Send to Ollama:** extract values · convert formats · parse/organise data · list items · rename fields

**Never send to Ollama:** make format · make lint · make test · make migrate
(these are deterministic CLI operations — run them directly)

**Send to Claude Code:** debug · design · refactor · security review · explain · implement
```

## Development

```bash
make test          # run the test suite (78 tests, no Ollama required)
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
assessComplexity("Design a REST API")         → complex ✓
assessComplexity("List steps to implement X") → complex ✓  (implement beats list)
assessComplexity("Clean up and organise")     → complex ✓  (clean beats organise)
```

## Roadmap

| #                                                                      | Feature                                 | Status  |
| ---------------------------------------------------------------------- | --------------------------------------- | ------- |
| [#1](https://github.com/why-pengo/claude-ollama-orchestrator/issues/1) | TUI dashboard (`--dashboard` mode)      | ✅ done |
| [#3](https://github.com/why-pengo/claude-ollama-orchestrator/issues/3) | Auto-fallback when Ollama is offline    | ✅ done |
| [#4](https://github.com/why-pengo/claude-ollama-orchestrator/issues/4) | `--dry-run` flag to preview routing     | ✅ done |
| [#5](https://github.com/why-pengo/claude-ollama-orchestrator/issues/5) | Estimated cost savings in `--stats`     |         |
| [#6](https://github.com/why-pengo/claude-ollama-orchestrator/issues/6) | Three-tier routing with remote GPU node |         |
