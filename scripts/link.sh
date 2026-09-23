#!/usr/bin/env bash
set -euo pipefail

# Cross-cloud secret wiring (PLAN.md §5, T6.1/T6.2). Idempotent/re-runnable, two directions:
#   1. AWS -> Databricks: cdk-outputs.json + .env -> secret scope "${DOCINTEL_SECRET_SCOPE:-docintel}"
#      (keys aws_gateway_url, aws_mcp_token_url, aws_mcp_client_id, aws_mcp_client_secret, aws_mcp_scope;
#      read by databricks/resources/apps.yml).
#   2. Databricks -> AWS: SP creds + app URL + job id -> Secrets Manager secret "DatabricksSecretArn"
#      as JSON {host, clientId, clientSecret, mcpUrl, jobId} (read by mcp-smoke.py / the AWS
#      orchestrator agent's Databricks MCP client).
# Then smoke-tests both directions via scripts/mcp-smoke.py. Secret values are never printed or
# passed as CLI args; they go over stdin / `file:///dev/stdin` only.
#
# Requires: `make deploy-aws` (cdk-outputs.json) and `make deploy-databricks` (.env SP creds)
# already run; `databricks`, `aws`, `jq`, `python3` on PATH; a working `docintel` Databricks CLI
# profile; AWS creds via the boto3/CLI default chain.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
OUTPUTS_FILE="${ROOT}/cdk-outputs.json"
PROFILE="${DATABRICKS_CONFIG_PROFILE:-docintel}"
REGION="${AWS_REGION:-us-east-1}"
SECRET_SCOPE="${DOCINTEL_SECRET_SCOPE:-docintel}"
JOB_NAME="docintel_pdf_agent"
APP_NAME="mcp-docintel"

db() { databricks --profile "$PROFILE" "$@"; }
die() { echo "!! $1" >&2; exit 1; }
need_env() { [[ -n "${!1:-}" ]] || die "missing \$$1 in ${ENV_FILE} ($2)"; }
out() { jq -r --arg k "$1" '(.DocIntelStack // (to_entries[0].value // {}))[$k] // empty' "$OUTPUTS_FILE"; }

echo "==> Preflight checks"
for t in databricks aws jq python3; do
  command -v "$t" >/dev/null || die "'$t' not on PATH"
done
[[ -f "$ENV_FILE" ]] || die "missing ${ENV_FILE} (copy .env.example -> .env and fill it in)"
[[ -f "$OUTPUTS_FILE" ]] || die "missing ${OUTPUTS_FILE} (run \`make deploy-aws\` first)"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

echo "==> Direction 1/2: AWS -> Databricks secret scope '${SECRET_SCOPE}'"
for v in AWS_GATEWAY_URL AWS_MCP_TOKEN_URL AWS_MCP_CLIENT_ID AWS_MCP_CLIENT_SECRET AWS_MCP_SCOPE; do
  need_env "$v" "produced by \`make deploy-aws\`; copy it from cdk-outputs.json / stack outputs"
done
if db secrets list-scopes -o json | jq -e --arg s "$SECRET_SCOPE" '.scopes[]? | select(.name==$s)' >/dev/null; then
  echo "    scope '${SECRET_SCOPE}' already exists"
else
  echo "    creating scope '${SECRET_SCOPE}'"
  db secrets create-scope "$SECRET_SCOPE"
fi
put_db_secret() { printf '%s' "$2" | db secrets put-secret "$SECRET_SCOPE" "$1"; }
put_db_secret aws_gateway_url "$AWS_GATEWAY_URL"
put_db_secret aws_mcp_token_url "$AWS_MCP_TOKEN_URL"
put_db_secret aws_mcp_client_id "$AWS_MCP_CLIENT_ID"
put_db_secret aws_mcp_client_secret "$AWS_MCP_CLIENT_SECRET"
put_db_secret aws_mcp_scope "$AWS_MCP_SCOPE"
echo "    wrote 5 keys to scope '${SECRET_SCOPE}' (values not printed)"

echo "==> Direction 2/2: Databricks -> AWS secret 'DatabricksSecretArn'"
DB_HOST="${DATABRICKS_HOST:-}"
if [[ -z "$DB_HOST" ]]; then
  DB_HOST="$(db auth profiles -o json 2>/dev/null | jq -r --arg p "$PROFILE" '.profiles[] | select(.name==$p) | .host' | head -1)"
fi
[[ -n "$DB_HOST" ]] || die "cannot resolve Databricks host; set DATABRICKS_HOST in .env or run \`databricks auth login --profile ${PROFILE}\`"
need_env DATABRICKS_SP_CLIENT_ID "produced by \`make deploy-databricks\`"
need_env DATABRICKS_SP_CLIENT_SECRET "produced by \`make deploy-databricks\`"
DB_MCP_URL="${DATABRICKS_MCP_URL:-}"
if [[ -z "$DB_MCP_URL" ]]; then
  APP_URL="$(db apps get "$APP_NAME" -o json | jq -r '.url // empty')"
  [[ -n "$APP_URL" ]] || die "app '${APP_NAME}' has no URL yet; run \`make deploy-databricks\` first"
  DB_MCP_URL="${APP_URL%/}/mcp"
fi
DB_JOB_ID="${DATABRICKS_JOB_ID:-}"
if [[ -z "$DB_JOB_ID" ]]; then
  DB_JOB_ID="$(db jobs list --name "$JOB_NAME" -o json | jq -r '.[0].job_id // empty')"
fi
[[ -n "$DB_JOB_ID" ]] || die "cannot resolve job id for '${JOB_NAME}'; run \`make deploy-databricks\` first"
SECRET_ARN="$(out DatabricksSecretArn)"
[[ -n "$SECRET_ARN" ]] || die "cdk-outputs.json has no 'DatabricksSecretArn' (run \`make deploy-aws\`)"
jq -n --arg host "$DB_HOST" --arg id "$DATABRICKS_SP_CLIENT_ID" --arg secret "$DATABRICKS_SP_CLIENT_SECRET" \
  --arg mcp_url "$DB_MCP_URL" --arg job_id "$DB_JOB_ID" \
  '{host: $host, clientId: $id, clientSecret: $secret, mcpUrl: $mcp_url, jobId: $job_id}' \
  | aws secretsmanager put-secret-value --region "$REGION" --secret-id "$SECRET_ARN" \
      --secret-string file:///dev/stdin >/dev/null
echo "    wrote host/clientId/clientSecret/mcpUrl/jobId to ${SECRET_ARN} (values not printed)"

echo "==> Smoke-testing both directions"
"${ROOT}/.venv/bin/python" "${ROOT}/scripts/mcp-smoke.py" both
echo "==> Link complete: both MCP servers reachable with cross-cloud credentials."
