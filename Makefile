# Claude-Ollama Orchestrator — Makefile
#
# Routes simple generative tasks to local Ollama (free) and complex tasks
# to Claude Code. Run `make help` to see all available commands.

.PHONY: help install test test-file lint format format-check check ci \
        stats reset logs clean

# Colors
BLUE   := \033[0;34m
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
NC     := \033[0m

help: ## Show this help message
	@echo "$(BLUE)Claude-Ollama Orchestrator$(NC)"
	@echo "=========================="
	@echo ""
	@echo "$(GREEN)Available commands:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-18s$(NC) %s\n", $$1, $$2}'
	@echo ""

# =============================================================================
# Dependencies
# =============================================================================

install: ## Install dev dependencies (eslint, prettier)
	@echo "$(BLUE)Installing dev dependencies...$(NC)"
	npm install
	@echo "$(GREEN)Done — node_modules ready$(NC)"

# =============================================================================
# Testing
# =============================================================================

test: ## Run the full test suite
	@echo "$(BLUE)Running tests...$(NC)"
	npm test
	@echo "$(GREEN)Tests complete$(NC)"

test-file: ## Run a single test file  (usage: make test-file FILE=tests/routing.test.js)
ifndef FILE
	@echo "$(RED)Error: FILE not specified$(NC)"
	@echo "Usage: make test-file FILE=tests/routing.test.js"
	@exit 1
endif
	@echo "$(BLUE)Running $(FILE)...$(NC)"
	node --test $(FILE)

# =============================================================================
# Code Quality
# =============================================================================

format: ## Format all files with Prettier
	@echo "$(BLUE)Formatting with Prettier...$(NC)"
	npm run format
	@echo "$(GREEN)Formatting complete$(NC)"

format-check: ## Check formatting without writing
	@echo "$(BLUE)Checking formatting...$(NC)"
	npm run format:check
	@echo "$(GREEN)Format check passed$(NC)"

lint: ## Run ESLint
	@echo "$(BLUE)Running ESLint...$(NC)"
	npm run lint
	@echo "$(GREEN)Lint passed$(NC)"

check: format-check lint ## Format check + lint in one step
	@echo "$(GREEN)All checks passed$(NC)"

ci: check test ## Full CI pipeline: format check, lint, tests
	@echo "$(GREEN)CI passed$(NC)"

# =============================================================================
# Orchestrator
# =============================================================================

stats: ## Show routing stats (Ollama calls vs Claude Code referrals)
	@node index.js --stats

reset: ## Reset routing stats
	@echo "$(YELLOW)Resetting orchestrator stats...$(NC)"
	@node index.js --reset
	@echo "$(GREEN)Stats reset$(NC)"

logs: ## Tail the orchestrator log (Ctrl-C to stop)
	@echo "$(BLUE)Tailing orchestrator.log — Ctrl-C to stop$(NC)"
	tail -f orchestrator.log | grep --line-buffered -E "REQUEST|ROUTER|OLLAMA|CLAUDE|ERROR|SKILLS"

# =============================================================================
# Cleanup
# =============================================================================

clean: ## Remove node_modules
	@echo "$(RED)Removing node_modules...$(NC)"
	rm -rf node_modules
	@echo "$(GREEN)Cleanup complete$(NC)"
