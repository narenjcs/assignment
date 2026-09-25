# Status and handover

_Last updated 2026-09-24. Read this first if you are picking the project up._

## TL;DR

**The assignment is functionally complete and deployed.** All four paths (DOCX/PDF × sync/async)
run end to end on live AWS + Databricks, with MCP servers on both clouds calling each other.
The only work outstanding is **UI polish**, which is in progress and is presentation-only.

| | |
|---|---|
| Live app | https://d3fhr1wqlh1ql9.cloudfront.net |
| Repo | https://github.com/narenjcs/assignment |
| Build tasks | 42 done · 7 in progress (all UI) · 1 todo |

---

## What is done and verified

Each of these was run against live infrastructure, not just tested locally.

| Requirement (brief) | Status | Evidence |
|---|---|---|
| React chatbot on AWS, upload + submit | ✅ | CloudFront SPA, presigned S3 upload |
| S3 → Lambda trigger picked up by an AI agent | ✅ | `s3-trigger` → `InvokeAgentRuntime` |
| DOCX summarised **inside AWS Bedrock AgentCore** | ✅ | `docintel_docx_agent` runtime; job `processor: aws-docx-agent` |
| PDF summarised **inside Databricks** | ✅ | Databricks App / serverless job; `processor: databricks-pdf-agent` |
| AWS orchestration layer invoking both | ✅ | `docintel_orchestrator` runtime routes by `docType` |
| **MCP server on AWS** | ✅ | AgentCore Gateway, 7 tools, Cognito JWT |
| **MCP server on Databricks** | ✅ | App `mcp-docintel`, 8 tools |
| **MCP tool calls from agents on both clouds** | ✅ | AWS agents → Gateway; Databricks agent → Gateway (the callback) |
| PDF from a Volume, OCR/extract, persist to a **UC table** | ✅ | `/Volumes/workspace/docs/inbox` → `workspace.docs.document_results` |
| Response streamed back to the user | ✅ | SSE `status`/`tool`/`token`/`result`/`done` |
| Sync **and** async execution modes | ✅ | all four combinations run |
| Job status + results exposed to the frontend | ✅ | `GET /jobs`, `GET /jobs/{id}` |

Quality: **426 unit tests** across six workspaces, ESLint/Prettier/tsc/Ruff/ty clean, `make check`
green. 66 review findings were fixed before anything was marked done, and **~30 further defects
were found only by deploying** — see PLAN.md §0.1.

---

## What is left

### 1. UI polish — ✅ done and deployed

All UI work is finished, committed on branch `ui-polish-flow-dialog`, and live at
<https://d3fhr1wqlh1ql9.cloudfront.net>. Lint, 95 unit tests, `tsc`, the production build
and the file-length check all pass. Deployed bundle hash verified against the local build.
Nothing is outstanding here.

Specified in **[UI-PLAN.md](UI-PLAN.md)**, tracked as **P10 / U1–U7** in [TASKS.md](TASKS.md).

| Task | State | Notes |
|---|---|---|
| U1 flow-model | ✅ done | `frontend/src/lib/flow-model.ts`, pure + tested |
| U2 flow view | ✅ done | Dark "console" dialog behind the **View flow** button, UI-PLAN §1 |
| U3 mode cards | ✅ done | sync/async explained where the choice is made |
| U4 palette | ✅ done | yellow gone; AWS orange survives only as a large-fill accent, never text |
| U5 agent trace restyle | ✅ done | cloud-coloured rail; collapses once the job is COMPLETED |
| U6 scroll + a11y + skeletons | ✅ done | per-panel `scroll-panel` regions, focus trap, Esc-to-close |
| U7 review + ship | ✅ done | deployed via `make deploy-frontend`; bundle hash verified live |

**How to continue it:**
```bash
cd frontend && npm run lint && npm test && npm run build   # must stay green
make deploy-frontend                                       # ~20s, no CloudFormation
curl -s https://d3fhr1wqlh1ql9.cloudfront.net/config.json  # verify after deploy
```
Read UI-PLAN §1 (flow view), §3.1 (palette) and §4 (deployment) before touching the UI.

### 2. Public access kill switch — ✅ in place, and the demo is LOCKED right now

The API is an unauthenticated Lambda Function URL (PLAN.md §2.5), so while it is open anyone
holding the CloudFront link can spend Bedrock/Databricks money through `POST /chat` and
`POST /jobs/{id}/process`, write into the uploads bucket, and read every job in the table.
Toggle it in seconds, with no redeploy and nothing torn down:

```bash
make unlock         # before a demo — API live again
make lock           # after a demo — every route throttles
make access-status  # which state am I in, plus a live probe of /health
```

It sets the `docintel-api` function's reserved concurrency to 0, so AWS refuses to start an
invocation at all: routes fail at the throttle before any handler code, model call, or DynamoDB
read. Locked returns HTTP 429 on every route, unlocked returns 200; both directions were
verified against the live endpoint. The static SPA stays reachable either way, which is
harmless — it is public HTML that does nothing without the API. See `scripts/access.sh`.

**This does not fix `GET /jobs`**, which returns every job with no owner scoping once unlocked.
That needs a per-user identity and is not a small change.


### 3. Optional hardening (not required by the brief)

- **API is unauthenticated** by design for the demo (PLAN §2.5), with a reserved-concurrency cap.
  Next step would be a shared-secret header or Cognito user login.
- **Databricks can mint its own AWS token** if `*.amazoncognito.com` is added to the workspace
  network policy; the code path already exists and the passthrough becomes unnecessary.
- **App deployment snapshots** accumulate one per deploy under the app service principal's home;
  prune periodically, keeping the active one.

---

## How to work on this

### First five minutes
```bash
make prereqs      # checks tooling + both cloud sessions
make venv         # Python 3.12 toolchain (one-time)
npm install       # TypeScript workspaces (one-time)
make check        # 426 tests + all linters — must be green before you change anything
```

### Deploying a change
| Changed | Command | Time |
|---|---|---|
| React app | `make deploy-frontend` | ~20 s |
| Lambda code | `make deploy-lambdas` | ~1 min |
| Agent code | `make deploy-agents` | ~6 min |
| Databricks app | `make deploy-dbx-app` | ~2 min |
| Databricks job/UC | `make deploy-dbx-job` | ~1 min |
| Infrastructure | `make deploy-aws` / `make deploy-databricks` | 5–8 min |

### Verifying end to end
```bash
python scripts/mcp-smoke.py both   # proves both MCP servers, each using the other cloud's creds
make e2e                           # all four scenarios
```

### Things that will bite you
1. **Sessions expire.** `aws login` roughly hourly; `databricks auth login --profile docintel`.
2. **Terraform must be on `PATH`** for any Databricks bundle command — the CLI's own download
   fails on HashiCorp's expired signing key. `make prereqs` checks it.
3. **Never use the `dev` / `prod` Databricks profiles** — they belong to another project.
4. **Databricks serverless egress is restricted.** The AgentCore Gateway resolves; Cognito does
   not, which is why AWS passes the token in. Since 2026-09-25 **S3 is blocked too**
   (`Connection reset by peer`), which is why `ingest_pdf` fetches the PDF through the Gateway's
   `get_document_content` tool (chunked, any size). Path-style S3 URLs do not help; the proxy
   blocks all of S3.
5. **An expired Databricks bearer returns 403, not 401.** Catch both when touching auth code.
6. **Never pass a token as a Databricks job parameter** — parameters persist in run history.
7. **Do not `sys.exit(0)` in a serverless Python task** — any `SystemExit` marks the run Failed.
8. **Shell output here passes through a compressor** that can mangle file contents; use `Read`
   or structured output (`jq`, `--reporter=json`) for anything you reason about.
9. **The Databricks App can be stopped by the platform** ("stopped due to workspace or account
   status"). PDF jobs then fail with "Cannot connect to the Databricks MCP App". Start it with
   `databricks --profile docintel apps start mcp-docintel`; `make e2e` checks this up front.

### Where to read what
| Question | Document |
|---|---|
| What is this and how is it built? | [PLAN.md](PLAN.md) — §0 is the live environment |
| How does a document actually flow? Auth? | [FLOWS.md](FLOWS.md) — sequence diagrams per path |
| What are the coding rules? | [DEVELOPMENT.md](DEVELOPMENT.md) — binding, gated by `make check` |
| What is done / next? | [TASKS.md](TASKS.md) |
| How do I demo it? | [DEMO.md](DEMO.md) |
| UI work | [UI-PLAN.md](UI-PLAN.md) |

---

## Environment reference

| | |
|---|---|
| AWS account / region | `<AWS_ACCOUNT_ID>` / `us-east-1` |
| Bedrock model | `openai.gpt-oss-120b-1:0` (Claude is gated behind an unsubmitted use-case form) |
| Databricks workspace | `https://dbc-34766815-3348.cloud.databricks.com` (AWS-hosted) |
| Catalog / schema / table | `workspace.docs.document_results` (Default Storage → built-in catalog) |
| SQL warehouse | `63ea130ae37ddbb9` |
| FM endpoint | `databricks-gpt-oss-120b` |
| Databricks CLI profile | `docintel` |

Teardown when finished: `make destroy` (removes the AWS stack and the Databricks bundle).
