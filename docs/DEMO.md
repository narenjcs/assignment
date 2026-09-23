# DocIntel — Demo runbook

Ordered script for a live walkthrough of the deployed stack, plus the commands used to verify
each step from the CLI. See [PLAN.md](PLAN.md) for the architecture and contracts referenced
below, and [DEVELOPMENT.md](DEVELOPMENT.md) for engineering standards.

## 1. Prerequisites

- `aws login` (or otherwise a valid AWS session — `aws sts get-caller-identity` succeeds), account
  with Bedrock AgentCore + the chosen model (`openai.gpt-oss-120b-1:0` by default) available in
  `us-east-1`.
- `databricks auth login --host https://<workspace> --profile docintel` — a workspace with Unity
  Catalog, serverless compute, Databricks Apps, and a serverless SQL warehouse enabled.
- CLIs on PATH: `aws`, `databricks`, `node`/`npm`, `uv`, `jq`, `curl`. Run `make prereqs` to check
  all of the above in one shot (prints ✔/✘ per item).
- `cp .env.example .env` and fill in `DATABRICKS_WAREHOUSE_ID` (serverless SQL warehouse id) and,
  if not using the default, `DATABRICKS_LLM_ENDPOINT` / `BEDROCK_MODEL_ID`.

## 2. One-time setup

```bash
make venv               # ./.venv with ruff/ty/pytest/boto3
npm install              # frontend + Lambda + CDK TypeScript workspaces
make samples              # samples/sample-contract.docx, samples/sample-report.pdf
make check                # lint + unit tests — should be green before deploying
eval "$(scripts/pick-model.sh)"   # confirms BEDROCK_MODEL_ID is tool-call-capable, exports it
```

## 3. Deploy

```bash
make build deploy-aws     # CDK: S3, DynamoDB, Cognito, Gateway, AgentCore runtimes, Lambdas, CloudFront
                           # writes cdk-outputs.json (ApiUrl, WebUrl, GatewayUrl, table/secret ARNs, ...)
make deploy-databricks    # Asset Bundle: secret scope + SP, catalog/schema/volume/table, MCP app, job
make link                 # exchanges cross-cloud credentials both ways, smoke-tests both MCP servers
```

`make link` is the gate: it fails loudly (non-zero exit) if either MCP server is unreachable or
missing an expected tool, so a clean run means both clouds can already talk to each other before
you touch the UI. Re-run any of the three commands any time — all three are idempotent.

Open the frontend at the `WebUrl` from `cdk-outputs.json`:

```bash
jq -r '.DocIntelStack.WebUrl' cdk-outputs.json
```

## 4. The 4 demo runs

Either click through the UI (below) or run all four non-interactively with `make e2e` (also
exercises the chat follow-up; see §5 and §9). Each UI run:

1. **Upload** — on the landing page, drag a sample file onto the dropzone (`UploadPanel`), pick
   **DOCX** or **PDF**, toggle **Sync** or **Async**, submit.
2. **Async runs** land straight in the jobs list (`JobsList`) at `PENDING_UPLOAD` → `UPLOADED` →
   `QUEUED` → `PROCESSING`, polling every 3 s; click the row to open `JobDetail`.
   **Sync runs** open `JobDetail` immediately and stream live: the status **Stepper**, the
   **agent trace** (`JobTrace`, AWS/Databricks badges per tool call) and the result populate as
   events arrive.
3. Watch the trace: DOCX jobs show only AWS-badged tool calls (`extract_docx_text`,
   `save_job_result`); PDF jobs show a `run_pdf_agent` call handed off to Databricks-badged tool
   calls (`ingest_pdf` → `extract_pdf_text`/OCR → `enrich_document` → `persist_document_result`).
4. On completion, `JobResultCard` + `ResultMetaGrid` show summary, key points, entities, topics,
   sentiment, language, page/word counts, extraction method and model; PDF jobs also show the UC
   table name and (async) the Databricks run id.

Run the four combinations: **DOCX/sync**, **DOCX/async**, **PDF/sync**, **PDF/async** — sync and
async should visibly differ (sync streams live token-by-token; async shows the polling steps).

## 5. Chat follow-up

On a completed job's `JobDetail`, open the chat panel (`ChatPanel`) and ask something grounded in
the result, e.g. "What are the key risks in this document?" (`ChatComposer` → `POST /chat`,
SSE). The answer streams token-by-token in `ChatMessageList` and should reference the same
summary/entities shown in the result card, proving the follow-up is grounded on the stored job
result rather than a fresh, ungrounded completion.

## 6. Requirement → visual mapping (R1–R10)

| # | Requirement | Where to see it |
|---|---|---|
| R1 | AWS-hosted chatbot frontend, upload + submit | The SPA itself, served from CloudFront (`WebUrl`) |
| R2 | S3 upload → Lambda event → AWS agent | Async run: `JobsList` status ticks `UPLOADED→QUEUED` without any client call after the PUT |
| R3 | DOCX summarised by an AWS AgentCore agent | DOCX job's `JobTrace` — every tool call is AWS-badged |
| R4 | PDF summarised by a Databricks agent | PDF job's `JobTrace` — `run_pdf_agent` hands off to Databricks-badged calls; UC table name in the result card |
| R5 | Orchestrator securely drives both clouds | `JobTrace` shows one orchestrator session routing to both AWS and Databricks tool calls |
| R6 | MCP servers on both clouds, cross-cloud tool calls | `make link`'s smoke-test output (`scripts/mcp-smoke.py both`) lists tools + a live call on each server |
| R7 | Databricks Volume → OCR/extract → UC table | §9 UC query below shows the row Databricks wrote for the PDF job just run |
| R8 | Streamed chatbot responses | Sync `JobDetail` and the chat panel both show token-by-token streaming |
| R9 | Storage on both sides | §9 DynamoDB item + UC row for the same `jobId` |
| R10 | E2E demo, sync + async, status/results in UI | The 4 runs in §4 plus `make e2e`'s results table |

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `make link` fails on the AWS check | `AWS_MCP_*` vars missing from `.env` — copy them from `cdk-outputs.json` (`GatewayUrl`, `CognitoTokenUrl`, `CognitoClientId`, `CognitoScope`) into `.env` as `AWS_GATEWAY_URL`/`AWS_MCP_TOKEN_URL`/`AWS_MCP_CLIENT_ID`/`AWS_MCP_SCOPE`, and the Cognito M2M client secret as `AWS_MCP_CLIENT_SECRET` |
| `make link` fails on the Databricks check | Re-run `make deploy-databricks`; confirm the app `mcp-docintel` is `RUNNING` (`databricks --profile docintel apps get mcp-docintel -o json \| jq .app_status.state`) |
| `scripts/e2e.sh` health check fails | Stack not deployed yet, or `ApiUrl` in `cdk-outputs.json` is stale — re-run `make deploy-aws` |
| Async job stuck at `QUEUED` | Check the orchestrator AgentCore runtime's CloudWatch logs; confirm `s3-trigger` actually fired (`aws logs tail /aws/lambda/<s3-trigger-fn> --since 10m`) |
| PDF job fails at the Databricks hop | Check the job run: `databricks --profile docintel jobs list-runs --job-id "$(databricks --profile docintel jobs list --name docintel_pdf_agent -o json \| jq -r '.[0].job_id')" -o json`, or the app logs in the workspace UI (Compute → Apps → mcp-docintel → Logs) |
| Chat panel returns nothing | The job must be `COMPLETED` first — chat is grounded on `result`, not a live document |

## 8. Teardown

```bash
make destroy   # cdk destroy (AWS) + databricks bundle destroy (Databricks) — asks for confirmation
```

This removes the CDK stack and the Databricks bundle's managed resources (job, app, schema-level
objects the bundle owns). It does **not** drop the `docintel` catalog itself or the secret scope
(`databricks secrets delete-scope docintel` to remove that manually if desired).

## 9. Inspecting the raw data stores

DynamoDB — most recent jobs and a single job's full item:

```bash
TABLE="$(jq -r '.DocIntelStack.JobsTableName' cdk-outputs.json)"
aws dynamodb scan --table-name "$TABLE" --region us-east-1 --max-items 5 \
  | jq '.Items[] | {jobId: .jobId.S, status: .status.S, docType: .docType.S, mode: .mode.S}'
aws dynamodb get-item --table-name "$TABLE" --region us-east-1 \
  --key "{\"jobId\":{\"S\":\"<jobId>\"}}" | jq .Item
```

Unity Catalog — via **Catalog Explorer** in the workspace UI (`docintel.docs.document_results`,
"Sample Data"), or from the CLI (needs `DATABRICKS_WAREHOUSE_ID` from `.env`):

```bash
databricks --profile docintel api post /api/2.0/sql/statements --json "$(jq -n \
  --arg wid "$DATABRICKS_WAREHOUSE_ID" \
  '{warehouse_id: $wid, wait_timeout: "30s",
    statement: "SELECT job_id, file_name, page_count, summary FROM docintel.docs.document_results ORDER BY processed_at DESC LIMIT 5"}')" \
  | jq '.result.data_array'
```

S3 — the JSON copy of a job's result:

```bash
BUCKET="$(jq -r '.DocIntelStack.UploadsBucket' cdk-outputs.json)"
aws s3 cp "s3://${BUCKET}/results/<jobId>/result.json" - | jq .
```
