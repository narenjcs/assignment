# DocIntel — cross-cloud agentic document intelligence

End-to-end demo for the Technium assignment: a React chatbot on AWS uploads a two-page PDF or DOCX; an
**orchestrator agent on Amazon Bedrock AgentCore** routes DOCX to an AWS agent and PDF to an agent
running **inside Databricks**; both clouds expose **MCP servers** (AgentCore Gateway on AWS, a
Databricks App on Databricks) and both agents call tools across the boundary. Results land in
DynamoDB and a Unity Catalog table, and stream back to the browser. Sync and async modes are supported.

| Doc | Purpose |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Requirements mapping, architecture, contracts, AWS + Databricks deployment plan |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, milestones, dependencies |
| [docs/TASKS.md](docs/TASKS.md) | Task board and decisions log |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Binding engineering standards (limits, patterns, API/MCP conventions, gates) |
| [docs/DEMO.md](docs/DEMO.md) | Demo runbook: setup, deploy, the 4 demo runs, chat follow-up, R1–R10 mapping, troubleshooting, teardown |

## Quick start

```bash
make venv          # Python 3.12 tooling in ./.venv
npm install        # TypeScript workspaces
make samples       # generates samples/sample-contract.docx and samples/sample-report.pdf
make check         # lint + tests (required before any task is marked done)
```

Deploy (needs `aws login` and `databricks auth login --profile docintel`):

```bash
cp .env.example .env            # fill in Databricks warehouse id etc.
eval "$(scripts/pick-model.sh)" # confirms the Bedrock model is invocable
make build deploy-aws           # CDK: S3, DynamoDB, Cognito, Gateway, AgentCore runtimes, Lambdas, CloudFront
make deploy-databricks          # Asset Bundle: schema, volume, table, app (MCP + PDF agent), job
make link                       # exchanges cross-cloud credentials both ways
make e2e                        # 4 scenarios: docx/pdf × sync/async
```

## Layout

```
aws/infra      CDK (TypeScript)        aws/lambdas   api · s3-trigger · mcp-tools (TypeScript)
aws/agents     orchestrator · docx_agent (Python, Strands, AgentCore Runtime)
aws/common     shared Python helpers   databricks/   bundle · app (MCP server + PDF agent) · job · sql
frontend       Vite + React 19         scripts/      prereqs · pick-model · deploy-databricks · link · e2e · mcp-smoke
```

Region `us-east-1`, model `openai.gpt-oss-120b-1:0` (configurable via `BEDROCK_MODEL_ID` / CDK context).
