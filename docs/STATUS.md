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

### 1. UI polish (code complete — deploy blocked on AWS login)

All UI code is finished and verified locally: lint, 95 unit tests, `tsc`, the production
build, and the file-length check all pass. The only thing left is shipping it —
`make deploy-frontend` failed with `Your session has expired`. Log in to AWS again, re-run
that one command (~20 s, no CloudFormation), then verify. Nothing else is outstanding.

Specified in **[UI-PLAN.md](UI-PLAN.md)**, tracked as **P10 / U1–U7** in [TASKS.md](TASKS.md).

| Task | State | Notes |
|---|---|---|
| U1 flow-model | ✅ done | `frontend/src/lib/flow-model.ts`, pure + tested |
| U2 flow view | ✅ done | Dark "console" dialog behind the **View flow** button, UI-PLAN §1 |
| U3 mode cards | ✅ done | sync/async explained where the choice is made |
| U4 palette | ✅ done | yellow gone; AWS orange survives only as a large-fill accent, never text |
| U5 agent trace restyle | ✅ done | cloud-coloured rail; collapses once the job is COMPLETED |
| U6 scroll + a11y + skeletons | ✅ done | per-panel `scroll-panel` regions, focus trap, Esc-to-close |
| U7 review + ship | ⛔ **blocked** | code gates green; **`make deploy-frontend` needs a fresh AWS login** |

**How to continue it:**
```bash
cd frontend && npm run lint && npm test && npm run build   # must stay green
make deploy-frontend                                       # ~20s, no CloudFormation
curl -s https://d3fhr1wqlh1ql9.cloudfront.net/config.json  # verify after deploy
```
Read UI-PLAN §1 (flow view), §3.1 (palette) and §4 (deployment) before touching the UI.

### 2. Optional hardening (not required by the brief)

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
4. **Databricks serverless DNS is allow-listed.** S3 and the AgentCore Gateway resolve; the
   Cognito endpoint does not. That is why AWS passes the token in.
5. **An expired Databricks bearer returns 403, not 401.** Catch both when touching auth code.
6. **Never pass a token as a Databricks job parameter** — parameters persist in run history.
7. **Do not `sys.exit(0)` in a serverless Python task** — any `SystemExit` marks the run Failed.
8. **Shell output here passes through a compressor** that can mangle file contents; use `Read`
   or structured output (`jq`, `--reporter=json`) for anything you reason about.

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
