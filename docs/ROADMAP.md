# DocIntel – Roadmap

Phases are sequential where arrows are shown; otherwise they can overlap. Effort is a human-equivalent estimate; Nari executes the build phases in this session.

| Phase | Goal | Deliverables | Exit criteria | Est. |
|---|---|---|---|---|
| **P0 Discovery** ✅ | Understand brief, verify platform capabilities, pick region + model | `docs/PLAN.md`, `docs/ROADMAP.md`, `docs/TASKS.md` | Architecture agreed, risks listed, region us-east-1, model gpt-oss-120b | 0.5 d |
| **P1 Scaffold** | Monorepo, tooling, samples | `README.md`, `Makefile`, `.gitignore`, `.env.example`, `samples/` generator, shared TS lib for Lambdas + tiny Python helper for agents | `make samples` produces 2-page DOCX + PDF | 0.5 d |
| **P2 AWS core infra** | Storage, API, ingest | CDK stack with S3, DynamoDB, Cognito, `api` + `s3-trigger` Lambdas, CloudFront | `cdk synth` clean; `GET /health` works after deploy | 1 d |
| **P3 AWS MCP server** | Gateway + tools | `mcp-tools` Lambda (TypeScript), `tools.json`, Gateway (Cognito JWT) | `scripts/mcp-smoke.py aws` lists 7 tools | 0.5 d |
| **P4 AWS agents** | Orchestrator + DOCX agent on AgentCore Runtime | Strands agents, zip build, runtime IaC, IAM grants | DOCX sync + async runs complete end-to-end inside AWS | 1.5 d |
| **P5 Databricks** | MCP server app, PDF agent, job, UC objects | DAB, App, Job, table DDL, SP + secrets script | `scripts/mcp-smoke.py databricks` lists tools; job runs green | 1.5 d |
| **P6 Cross-cloud link** | Secrets exchange, both directions | `make link`, smoke tests | PDF sync + async runs complete with UC rows + AWS status callbacks | 0.5 d |
| **P7 Frontend** | Upload, jobs, trace, streaming chat | Vite React app deployed to CloudFront | All four demo runs drive from the UI | 1 d |
| **P8 E2E + demo** | Prove it | `scripts/e2e.sh`, `docs/DEMO.md`, screenshots/GIF | E2E script passes; demo rehearsed | 0.5 d |
| **P9 Hardening (stretch)** | Production-leaning polish | Cognito user auth on API, WAF, AgentCore Memory for chat, MLflow tracing on Databricks, cost dashboard | Optional | 1–2 d |

## Milestones
- **M1 – Local build green** (end P1–P4 code): `make build` succeeds without cloud access.
- **M2 – AWS-only path live** (end P4): DOCX document processed via S3 → Lambda → Orchestrator → DOCX agent → Gateway MCP tools → DynamoDB → UI.
- **M3 – Databricks path live** (end P6): PDF document processed via Databricks MCP + PDF agent → UC Volume/Table → AWS callbacks.
- **M4 – Demo ready** (end P8).

## Dependencies on Naren
1. ~~`aws login` before P2 deploy~~ — done 2026-09-23 (account <AWS_ACCOUNT_ID>, region us-east-1).
2. `databricks auth login --profile docintel` and workspace prerequisites before P5 deploy — **pending** (need the workspace host).
3. ~~Bedrock model access~~ — resolved: agents use `openai.gpt-oss-120b-1:0` (no Anthropic form required).
