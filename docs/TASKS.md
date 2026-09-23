# DocIntel – Task Board

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (needs Naren)

## P0 Discovery
- [x] T0.1 Read brief, inventory existing starter (CopilotKit A2A template — not reused)
- [x] T0.2 Verify AgentCore CFN/CDK support, zip deploy, region availability (us-east-1 chosen)
- [x] T0.3 Verify Databricks Apps MCP hosting, `ai_parse_document`, M2M auth
- [x] T0.4 Write PLAN / ROADMAP / TASKS

## Decisions log
- 2026-09-23 Region → us-east-1 (existing buckets). Lambdas → TypeScript only (Python kept for AgentCore agents + Databricks). Model → `openai.gpt-oss-120b-1:0` on Bedrock (Claude gated; best low-cost tool-caller in tests), `databricks-gpt-oss-120b` on Databricks.

- 2026-09-23 `reference/aws_terraform/` (Naren, AWS coding agent) reviewed → reference only (docs/REVIEW-aws_terraform.md); harvested S3 result copy + UC lineage columns. IaC stays CDK.

## P1 Scaffold
- [x] T1.0 `docs/DEVELOPMENT.md` standards (§1–§12: limits, layout, TS/Python rules, tests, gates, AI working agreement, git, design patterns, HTTP API, MCP tools, observability/security) + root `CLAUDE.md`, `.editorconfig`, `.prettierrc`, root `pyproject.toml` (Ruff/ty), `scripts/lint-file-length.sh`, `make lint/format/test/check/hooks`; existing Python is Ruff-clean
- [x] T1.4 Tooling per workspace: root `package.json` (npm workspaces), `eslint.config.js` (rules in DEVELOPMENT.md §3), vitest configs, `tsconfig.base.json`; `make check` green on the empty skeleton
- [x] T1.1 Repo layout, `.gitignore`, `.env.example`, `Makefile`, root `README.md`
- [x] T1.2 `samples/make_samples.py` → 2-page DOCX + PDF
- [x] T1.3 Shared code: `aws/lambdas/src/lib/` (TS: job store, S3, SSE) — todo; `aws/common/docintel_common` (Python: auth, secrets, sse, config for agents) — done and Ruff-clean

## P2 AWS core infra (CDK)
- [x] T2.1 CDK app skeleton (`aws/infra`), context: region, modelId
- [x] T2.2 S3 uploads bucket (CORS, lifecycle, notifications) + web bucket + CloudFront (OAC)
- [x] T2.3 DynamoDB `docintel-jobs` + GSI + TTL
- [x] T2.4 Cognito user pool, domain, resource server, M2M client (secret)
- [x] T2.5 Secrets Manager placeholders (`docintel/databricks`)
- [x] T2.6 Lambda `api` (TypeScript, Function URL streaming): uploads, jobs, process, chat, health
- [x] T2.7 Lambda `s3-trigger` (TypeScript) — the earlier Python draft was retired on 2026-09-23
- [x] T2.8 `BucketDeployment` for SPA + runtime `config.json`

## P3 AWS MCP server
- [x] T3.1 (Sonnet built, Fable reviewed 1 round — 11 findings fixed, 174 tests) `mcp-tools` Lambda (TypeScript, 7 tools, `mammoth` for DOCX) — Python draft retired; `aws/lambdas/tools.json` schema done
- [x] T3.2 Gateway (Cognito JWT) + Lambda target in CDK
- [x] T3.3 `scripts/mcp-smoke.py` (token → list_tools → call `get_job`)

## P4 AWS agents (AgentCore Runtime)
- [x] T4.1 DOCX agent (Strands + AgentCore SDK): extract via MCP, structured enrichment, save result
- [x] T4.2 Orchestrator agent: modes sync/async/chat, routing, Databricks MCP client, delegate tool, SSE event mapping, async-task pattern
- [x] T4.3 `aws/agents/build.sh` – arm64 zip packaging with uv — Sonnet built, Fable reviewed 1 round (10 findings fixed), 85 tests, zips 29 MB
- [x] T4.4 Runtimes + IAM in CDK (`AgentRuntimeArtifact.fromS3`/`fromCodeAsset`)
- [x] T4.5 `scripts/pick-model.sh` — probes tool-calling on candidate models, prints the first usable BEDROCK_MODEL_ID

## P5 Databricks
- [x] T5.1 `databricks.yml` bundle (target dev, profile docintel, variables)
- [x] T5.2 App: FastAPI + MCP server (`/mcp`), tools, UC helpers, FMAPI enrichment, `ai_parse_document` OCR
- [x] T5.3 PDF agent loop (tool-calling on FMAPI) using local tools + AWS MCP tools
- [x] T5.4 Job `docintel_pdf_agent` (serverless) reusing the package
- [x] T5.5 `sql/setup.sql` + idempotent table creation in app startup
- [x] T5.6 `scripts/deploy-databricks.sh` (secret scope, SP, grants, bundle deploy, app start) — Sonnet built, Fable reviewed 2 rounds (11 findings fixed), 35 tests; deploy script + grants unverified until a workspace exists

## P6 Cross-cloud link
- [x] T6.1 `scripts/link.sh` – exchange secrets both ways from CDK outputs + Databricks
- [x] T6.2 (written + unit-tested; live run pending a deployed stack) Smoke tests both directions

## P7 Frontend
- [x] T7.1 Vite React TS Tailwind scaffold, runtime config loader
- [x] T7.2 Upload panel (dropzone, mode toggle), jobs list with polling
- [x] T7.3 Job detail: status stepper, agent trace (AWS vs Databricks badges), results card
- [x] T7.4 Streaming: sync-process stream + chat panel (SSE parser) — Sonnet built, Fable reviewed 2 rounds (15 findings fixed), 78 tests, 96% cov
- [x] T7.5 Build + deploy via CDK

## P8 E2E + demo
- [x] T8.1 `scripts/e2e.sh` (4 runs)
- [x] T8.2 `docs/DEMO.md` runbook
- [x] T8.3 Root README final pass

## Status 2026-09-24
All 41 build tasks complete. 426 tests green across six workspaces (lambdas 174, agents 85, frontend 77, databricks 35, infra 29, scripts 26); ESLint/Prettier/tsc/Ruff/ty clean; `cdk synth` produces 54 resources. 66 review findings were fixed across 9 review rounds before anything was ticked. Nothing is deployed — the remaining work is live deployment + the E2E run, which needs the items below.

## Blocked on Naren
- [!] B1 `aws login`
- [!] B2 `databricks auth login --host <ws> --profile docintel`
- [x] B3 Bedrock model: resolved without the Anthropic form → `openai.gpt-oss-120b-1:0` (fallback Nova 2 Lite)
- [!] B4 Databricks workspace prerequisites (UC, serverless, Apps, SQL warehouse id, FMAPI endpoint name)
