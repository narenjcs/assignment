# Observability

DocIntel uses the job UUID as the cross-cloud correlation key. Every log line is one JSON object, so
CloudWatch Logs Insights discovers its fields automatically.

Field names follow each language's convention: TypeScript Lambdas log `jobId` / `durationMs`, Python
services (AgentCore runtimes, Databricks App and Job) log `job_id` / `duration_ms`. A cross-service
query must filter on both. Never log document text, model prompts/tokens, presigned URLs, bearer tokens, or client secrets.

## AWS

All Lambda logs are one JSON object per line.

| Service | Main events | Correlation fields |
|---|---|---|
| `api` | `api_request_completed`, `api_request_failed` (no "started" event: the UI polls every 3 s) | `requestId`, HTTP method/path, duration; routes with a job can be correlated through the job record |
| `s3-trigger` | `upload_event_processed`, `job_queued_async`, `orchestrator_async_accepted`, `orchestrator_async_rejected` | `jobId`, mode, object size, duration |
| `mcp-tools` | `mcp_tool_completed`, `mcp_tool_failed` (including `UNKNOWN_TOOL`) | tool name, duration, error code |
| `orchestrator` AgentCore Runtime | `orchestrator_invoked`, `orchestrator_sync_completed` / `orchestrator_sync_failed`, `orchestrator_async_completed` / `orchestrator_async_failed` | `job_id`, mode, AgentCore session ID, duration |
| `docx_agent` AgentCore Runtime | `docx_agent_started`, `docx_agent_completed` / `docx_agent_failed` | `job_id`, AgentCore session ID, duration |

CloudWatch Embedded Metric Format records create these `DocIntel` metrics:

| Metric | Dimensions | Meaning |
|---|---|---|
| `ApiRequest` | `service`, `outcome` | API success/failure count |
| `UploadNotification` | `service`, `mode`, `outcome` | S3 upload notification delivery; outcome is `fresh` or `duplicate` |
| `OrchestratorAsyncInvocation` | `service`, `outcome` | Async orchestrator accepted/failed count |
| `McpToolInvocation` | `service`, `tool`, `outcome` | Gateway tool success/failure count; unrecognised tool names are recorded as `tool=unknown` |

`jobId` and `requestId` are deliberately excluded from metric dimensions to avoid high-cardinality metrics.

### CloudWatch Logs Insights examples

```sql
fields @timestamp, service, event, jobId, requestId, tool, durationMs, error
| filter service = "mcp-tools"
| sort @timestamp desc
| limit 100
```

```sql
fields @timestamp, jobId, event, mode, durationMs, error
| filter service = "s3-trigger" and ispresent(jobId)
| sort @timestamp asc
```

One job across the Lambdas and the AgentCore runtimes (select the Lambda log groups plus the
`/aws/bedrock-agentcore/runtimes/*` groups):

```sql
fields @timestamp, @log, event, durationMs, duration_ms, error
| filter jobId = "<JOB_ID>" or job_id = "<JOB_ID>"
| sort @timestamp asc
```

Failure events (`*_failed`) are logged at `ERROR` level in both languages.

## Databricks

The PDF agent writes JSON log messages to the Databricks App logs for sync runs and Databricks Job run logs for async runs.

| Event | Meaning |
|---|---|
| `pdf_agent_started` | A PDF pipeline started; includes `job_id`, run mode and optional Databricks run ID. |
| `pdf_pipeline_step_started` | One of `ingest`, `extract`, `enrich`, `persist` began. |
| `pdf_pipeline_step_completed` | A stage completed; includes duration in milliseconds. |
| `aws_job_status_reported` | The PDF agent successfully reported `PROCESSING` or `COMPLETED` to AWS MCP. |
| `pdf_agent_completed` | The complete pipeline succeeded; includes total duration. |
| `pdf_agent_failed` | The complete pipeline failed; includes error type and total duration. |

### Investigation order

1. Start with the AWS job ID in DynamoDB or the frontend trace.
2. Search Databricks App/Job logs for `job_id`.
3. Match a PDF async job's `databricks_run_id` to the Jobs UI.
4. Search AWS logs for the same ID to inspect Gateway callbacks and final job writes.
5. Use the stored DynamoDB events as the user-facing, append-only processing trace; logs provide operational detail and durations.
