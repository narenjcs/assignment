#!/usr/bin/env bash
set -euo pipefail

# Deploys the DocIntel Databricks bundle (PLAN.md §4). Provisions Databricks-side
# resources only: secret scope, SP + OAuth secret, UC grants, bundle (schema,
# volume, table via app startup, job, app), permission grants, and app start.
# Cross-cloud secret wiring (AWS creds -> the "docintel" scope) is a separate
# step (`make link`, PLAN.md §5) and is NOT run here.
#
# Usage: scripts/deploy-databricks.sh [target]
#   target defaults to "dev" (matches databricks/databricks.yml)
#
# Requires: `databricks` CLI on PATH, authenticated via the `docintel` CLI
# profile referenced by databricks/databricks.yml (workspace.profile). Run
# `databricks auth login --profile docintel` first if that profile is missing.
# Never destructive: creates/updates resources only, no delete/destroy calls.

TARGET="${1:-dev}"
PROFILE="${DATABRICKS_PROFILE:-docintel}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../databricks" && pwd)"
ENV_FILE="${BUNDLE_DIR}/../.env"

CATALOG="${DOCINTEL_CATALOG:-docintel}"
SCHEMA="${DOCINTEL_SCHEMA:-docs}"
SECRET_SCOPE="${DOCINTEL_SECRET_SCOPE:-docintel}"
SP_NAME="docintel-aws"
APP_NAME="mcp-docintel"
JOB_NAME="docintel_pdf_agent"

db() { databricks --profile "$PROFILE" "$@"; }
jval() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "==> Deploying DocIntel bundle to target '${TARGET}' (profile '${PROFILE}')"

# 1. Secret scope (idempotent) — ready for `make link` to populate AWS creds into.
if db secrets list-scopes -o json | grep -q "\"name\":\"${SECRET_SCOPE}\""; then
  echo "==> Secret scope '${SECRET_SCOPE}' already exists"
else
  echo "==> Creating secret scope '${SECRET_SCOPE}'"
  db secrets create-scope "${SECRET_SCOPE}"
fi

# 2. Service principal used by the AWS side to call this workspace (idempotent).
SP_APP_ID="$(db service-principals list --filter "displayName eq ${SP_NAME}" -o json \
  | jval 'd[0]["applicationId"] if d else ""')"
if [[ -z "${SP_APP_ID}" ]]; then
  echo "==> Creating service principal '${SP_NAME}'"
  SP_JSON="$(db service-principals create --display-name "${SP_NAME}" -o json)"
  SP_APP_ID="$(echo "${SP_JSON}" | jval 'd["applicationId"]')"
  SP_ID="$(echo "${SP_JSON}" | jval 'd["id"]')"
else
  echo "==> Service principal '${SP_NAME}' already exists (application id ${SP_APP_ID})"
  SP_ID="$(db service-principals list --filter "displayName eq ${SP_NAME}" -o json | jval 'd[0]["id"]')"
fi

# 3. OAuth secret for the SP. The value is never echoed to stdout/log — it is
#    captured straight into a shell variable and appended to a local .env line.
echo "==> Creating OAuth secret for '${SP_NAME}' (value is not logged)"
SP_SECRET_JSON="$(db service-principal-secrets-proxy create "${SP_ID}" --lifetime 15768000 -o json)"
{
  echo "DATABRICKS_SP_CLIENT_ID=${SP_APP_ID}"
  echo "DATABRICKS_SP_CLIENT_SECRET=$(echo "${SP_SECRET_JSON}" | jval 'd["secret"]')"
} >>"${ENV_FILE}"
unset SP_SECRET_JSON
echo "==> Wrote SP credentials to ${ENV_FILE} (values not printed)"

# 4. Catalog must pre-exist; the bundle only manages the schema below it.
if db catalogs get "${CATALOG}" >/dev/null 2>&1; then
  echo "==> Catalog '${CATALOG}' already exists"
else
  echo "==> Creating catalog '${CATALOG}'"
  db catalogs create "${CATALOG}"
fi

# 5. Deploy the bundle: creates the schema, volume, job, and app. The app's own
#    startup path runs sql/setup.sql's idempotent DDL to create document_results.
echo "==> Running bundle deploy"
(cd "${BUNDLE_DIR}" && databricks bundle deploy -t "${TARGET}" --profile "${PROFILE}" --auto-approve)

# 6. Grant the SP the Unity Catalog privileges it needs to read/write results.
echo "==> Granting Unity Catalog privileges to '${SP_NAME}'"
db grants update catalog "${CATALOG}" \
  --json "{\"changes\": [{\"principal\": \"${SP_APP_ID}\", \"add\": [\"USE_CATALOG\"]}]}"
db grants update schema "${CATALOG}.${SCHEMA}" \
  --json "{\"changes\": [{\"principal\": \"${SP_APP_ID}\", \"add\": [\"USE_SCHEMA\", \"SELECT\", \"MODIFY\"]}]}"
db grants update volume "${CATALOG}.${SCHEMA}.inbox" \
  --json "{\"changes\": [{\"principal\": \"${SP_APP_ID}\", \"add\": [\"READ_VOLUME\", \"WRITE_VOLUME\"]}]}"

# 7. Grant the SP access to call the app's MCP endpoint and trigger the job.
echo "==> Granting '${SP_NAME}' CAN_USE on app '${APP_NAME}'"
db apps update-permissions "${APP_NAME}" \
  --json "{\"access_control_list\": [{\"service_principal_name\": \"${SP_APP_ID}\", \"permission_level\": \"CAN_USE\"}]}"

JOB_ID="$(db jobs list --name "${JOB_NAME}" -o json | jval 'd[0]["job_id"] if d else ""')"
if [[ -z "${JOB_ID}" ]]; then
  echo "!! could not find job '${JOB_NAME}' after bundle deploy" >&2
  exit 1
fi
echo "==> Granting '${SP_NAME}' CAN_MANAGE_RUN on job ${JOB_ID}"
db jobs update-permissions "${JOB_ID}" \
  --json "{\"access_control_list\": [{\"service_principal_name\": \"${SP_APP_ID}\", \"permission_level\": \"CAN_MANAGE_RUN\"}]}"

# 8. Start the app (bundle deploy does not start it automatically).
echo "==> Starting app '${APP_NAME}'"
db apps start "${APP_NAME}" || echo "!! app start failed or already running, continuing"

# 9. Outputs for the later `make link` cross-cloud wiring step (PLAN.md §5) to consume.
APP_URL="$(db apps get "${APP_NAME}" -o json | jval 'd.get("url", "")')"
echo "DATABRICKS_MCP_URL=${APP_URL%/}/mcp"
echo "DATABRICKS_JOB_ID=${JOB_ID}"
echo "==> Done. Run \`make link\` to write AWS credentials into secret scope '${SECRET_SCOPE}'."
