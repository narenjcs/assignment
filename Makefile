# DocIntel – cross-cloud agentic document intelligence (AWS + Databricks)
SHELL := /bin/bash
.DEFAULT_GOAL := help
-include .env
export

AWS_REGION ?= us-east-1
# Bundle variables every Databricks deploy needs (warehouse_id has no default in databricks.yml).
# The Databricks CLI's own Terraform download fails on HashiCorp's expired signing key, so
# every bundle command needs a local binary (see scripts/deploy-databricks.sh).
DBX_TF = DATABRICKS_TF_EXEC_PATH=$$(command -v terraform) DATABRICKS_TF_VERSION=$$(terraform version -json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["terraform_version"])' 2>/dev/null)

DBX_VARS = --var catalog=$(DATABRICKS_CATALOG) --var schema=$(DATABRICKS_SCHEMA) \
           --var warehouse_id=$(DATABRICKS_WAREHOUSE_ID) --var llm_endpoint=$(DATABRICKS_LLM_ENDPOINT) \
           --var aws_secret_scope=docintel
DATABRICKS_CONFIG_PROFILE ?= docintel

help: ## Show targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}'

prereqs: ## Check CLIs + cloud sessions
	@bash scripts/prereqs.sh

samples: .venv/bin/ruff ## Generate 2-page sample DOCX + PDF into samples/
	@.venv/bin/python samples/make_samples.py

build: build-agents build-frontend ## Build all deployable artifacts (no Docker needed)
	@echo "Lambdas need no pre-build: CDK's NodejsFunction bundles them with esbuild at synth time."

build-agents: ## Package AgentCore runtime zips (arm64 deps via uv)
	@bash aws/agents/build.sh

build-frontend: ## Build the React SPA
	@cd frontend && npm install --silent && npm run build

deploy-aws: ## CDK deploy (requires `aws login`)
	@cd aws/infra && npm install --silent && npx cdk deploy --require-approval never --outputs-file ../../cdk-outputs.json -c modelId=$(BEDROCK_MODEL_ID)

deploy-databricks: ## Bundle deploy + SP/secret scope/grants (requires `databricks auth login --profile docintel`)
	@bash scripts/deploy-databricks.sh

# ── Per-service deploys ────────────────────────────────────────────────────
# `make deploy-aws` / `make deploy-databricks` are the safe defaults and always work.
# These are faster paths for the common "I only changed one thing" case.

deploy-frontend: build-frontend ## SPA only: S3 sync + CloudFront invalidation (~20s, no CloudFormation)
	@bash scripts/deploy-frontend.sh

deploy-lambdas: ## Lambda code only: rebundle and hotswap, falling back to a normal deploy
	@cd aws/infra && npx cdk deploy --require-approval never --hotswap-fallback -c modelId=$(BEDROCK_MODEL_ID)

deploy-agents: build-agents ## AgentCore runtimes only: rebuild arm64 zips, then deploy
	@cd aws/infra && npx cdk deploy --require-approval never --outputs-file ../../cdk-outputs.json -c modelId=$(BEDROCK_MODEL_ID)

deploy-dbx-app: ## Databricks App only: sync source and restart it (skips SP/grants setup)
	@cd databricks && $(DBX_TF) databricks bundle deploy -t dev -p $(DATABRICKS_CONFIG_PROFILE) --auto-approve $(DBX_VARS)
	@cd databricks && $(DBX_TF) databricks bundle run mcp_docintel -t dev -p $(DATABRICKS_CONFIG_PROFILE) $(DBX_VARS)

deploy-dbx-job: ## Databricks bundle resources only (job, schema, volume) - no app restart
	@cd databricks && $(DBX_TF) databricks bundle deploy -t dev -p $(DATABRICKS_CONFIG_PROFILE) --auto-approve $(DBX_VARS)

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
	@[ -d scripts/tests ] && .venv/bin/pytest -q scripts/tests || true

check: lint test ## Quality gate required before a task is marked done

hooks: ## Install pre-commit hook running `make lint`
	@printf '#!/usr/bin/env bash\nmake lint\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo "pre-commit hook installed"

dev-frontend: ## Run the SPA locally against the deployed API
	@cd frontend && npm run dev

lock: ## Block all public API traffic in seconds (no redeploy, reverse with `make unlock`)
	@./scripts/access.sh lock

unlock: ## Restore public API service after `make lock`
	@./scripts/access.sh unlock

access-status: ## Report whether the public API is locked, and probe it live
	@./scripts/access.sh status

destroy: ## Tear down AWS stack and Databricks bundle
	@cd aws/infra && npx cdk destroy --force
	@cd databricks && databricks bundle destroy --auto-approve -p $(DATABRICKS_CONFIG_PROFILE) || true

.PHONY: help venv prereqs samples build build-agents deploy-frontend deploy-lambdas deploy-agents deploy-dbx-app deploy-dbx-job build-frontend deploy-aws deploy-databricks link e2e dev-frontend lock unlock access-status destroy lint format test check hooks
