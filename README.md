# DocIntel — cross-cloud agentic document intelligence

End-to-end demo for the Technium assignment: a React chatbot on AWS uploads a two-page PDF or DOCX; an
**orchestrator agent on Amazon Bedrock AgentCore** routes DOCX to an AWS agent and PDF to an agent
running **inside Databricks**; both clouds expose **MCP servers** (AgentCore Gateway on AWS, a
Databricks App on Databricks) and both agents call tools across the boundary. Results land in
DynamoDB and a Unity Catalog table, and stream back to the browser. Sync and async modes are supported.

| Doc | Purpose |
|---|---|
| **[docs/STATUS.md](docs/STATUS.md)** | **Start here** — what is done, what is left, how to continue |
| [docs/FLOWS.md](docs/FLOWS.md) | How each of the four paths runs (sync/async × DOCX/PDF) and how every hop authenticates — sequence diagrams |
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

**Terraform is required for the Databricks half.** Databricks Asset Bundles drive Terraform
internally, and the Databricks CLI's own download of it fails on HashiCorp's expired signing key,
so install a local binary once (any recent version works — the deploy script declares whichever
one it finds):

```bash
curl -sL -o /tmp/tf.zip https://releases.hashicorp.com/terraform/1.5.5/terraform_1.5.5_linux_amd64.zip
unzip -o /tmp/tf.zip -d "$HOME/.local/bin" && chmod +x "$HOME/.local/bin/terraform"
```

`make prereqs` checks for it along with the other tools and cloud sessions.

Deploy (needs `aws login` and `databricks auth login --profile docintel`):

```bash
cp .env.example .env            # fill in Databricks warehouse id etc.
eval "$(scripts/pick-model.sh)" # confirms the Bedrock model is invocable
make build deploy-aws           # CDK: S3, DynamoDB, Cognito, Gateway, AgentCore runtimes, Lambdas, CloudFront
make deploy-databricks          # Asset Bundle: schema, volume, table, app (MCP + PDF agent), job
make link                       # exchanges cross-cloud credentials both ways
make e2e                        # 4 scenarios: docx/pdf × sync/async
```

Iterating on one piece? These skip the parts that did not change:

| Changed | Command | Roughly |
|---|---|---|
| React app | `make deploy-frontend` | 20s — S3 sync + CloudFront invalidation, no CloudFormation |
| Lambda code | `make deploy-lambdas` | 1m — esbuild rebundle, hotswapped in place |
| Agent code | `make deploy-agents` | 6m — rebuilds arm64 zips, then deploys |
| Databricks app | `make deploy-dbx-app` | 2m — syncs source and restarts the app |
| Databricks job/UC | `make deploy-dbx-job` | 1m — bundle resources only |

`make deploy-aws` and `make deploy-databricks` always work and are the right choice when
infrastructure itself changed; the table above is for code-only edits.

## Layout

```
aws/infra      CDK (TypeScript)        aws/lambdas   api · s3-trigger · mcp-tools (TypeScript)
aws/agents     orchestrator · docx_agent (Python, Strands, AgentCore Runtime)
aws/common     shared Python helpers   databricks/   bundle · app (MCP server + PDF agent) · job · sql
frontend       Vite + React 19         scripts/      prereqs · pick-model · deploy-databricks · link · e2e · mcp-smoke
```

Region `us-east-1`, model `openai.gpt-oss-120b-1:0` (configurable via `BEDROCK_MODEL_ID` / CDK context).
