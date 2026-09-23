# DocIntel – cross-cloud agentic document intelligence (AWS + Databricks)
SHELL := /bin/bash
.DEFAULT_GOAL := help
-include .env
export

AWS_REGION ?= us-east-1
DATABRICKS_CONFIG_PROFILE ?= docintel

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}'

prereqs: ## Check CLIs + cloud sessions
	@bash scripts/prereqs.sh

samples: .venv/bin/ruff ## Generate 2-page sample DOCX + PDF into samples/
	@.venv/bin/python samples/make_samples.py

build: build-lambdas build-agents build-frontend ## Build all deployable artifacts (no Docker needed)

build-lambdas: ## Vendor Python deps for Lambdas + compile Node API Lambda
	@bash aws/lambdas/build.sh

build-agents: ## Package AgentCore runtime zips (arm64 deps via uv)
	@bash aws/agents/build.sh

build-frontend: ## Build the React SPA
	@cd frontend && npm install --silent && npm run build

deploy-aws: ## CDK deploy (requires `aws login`)
	@cd aws/infra && npm install --silent && npx cdk deploy --require-approval never --outputs-file ../../cdk-outputs.json -c modelId=$(BEDROCK_MODEL_ID)

deploy-databricks: ## Bundle deploy + SP/secret scope/grants (requires `databricks auth login --profile docintel`)
	@bash scripts/deploy-databricks.sh

link: ## Exchange cross-cloud secrets (AWS<->Databricks) and smoke-test both MCP servers
	@bash scripts/link.sh

e2e: ## Run the 4 end-to-end scenarios against the deployed stack
	@bash scripts/e2e.sh

venv: ## Create ./.venv (Python 3.12) with pinned dev tooling (ruff, ty, pytest, boto3[crt]...)
	@uv venv -q --python 3.12 .venv && uv pip install -q --python .venv/bin/python -r requirements-dev.txt && echo ".venv ready"

.venv/bin/ruff:
	@$(MAKE) --no-print-directory venv

lint: .venv/bin/ruff ## Ruff + ty (Python), file-length gate, ESLint/Prettier/tsc (TS workspaces)
	@bash scripts/lint-file-length.sh
	@.venv/bin/ruff check . && .venv/bin/ruff format --check .
	@.venv/bin/ty check --python .venv aws/common aws/agents databricks/app/src 2>&1 | grep -v "^info:"
	@npm run lint --silent && npm run format:check --silent

format: .venv/bin/ruff ## Auto-format TS (prettier) and Python (ruff)
	@.venv/bin/ruff format . && .venv/bin/ruff check --fix .
	@npm run format --silent >/dev/null

test: .venv/bin/ruff ## vitest (TS workspaces) + pytest (Python)
	@npm test --silent
	@[ -d aws/agents/tests ] && .venv/bin/pytest -q aws/agents/tests || true
	@[ -d databricks/tests ] && .venv/bin/pytest -q databricks/tests || true

check: lint test ## Quality gate required before a task is marked done

hooks: ## Install pre-commit hook running `make lint`
	@printf '#!/usr/bin/env bash\nmake lint\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo "pre-commit hook installed"

dev-frontend: ## Run the SPA locally against the deployed API
	@cd frontend && npm run dev

destroy: ## Tear down AWS stack and Databricks bundle
	@cd aws/infra && npx cdk destroy --force
	@cd databricks && databricks bundle destroy --auto-approve -p $(DATABRICKS_CONFIG_PROFILE) || true

.PHONY: help venv prereqs samples build build-lambdas build-agents build-frontend deploy-aws deploy-databricks link e2e dev-frontend destroy lint format test check hooks
