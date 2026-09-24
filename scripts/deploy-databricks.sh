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
PROFILE="${DATABRICKS_CONFIG_PROFILE:-${DATABRICKS_PROFILE:-docintel}}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../databricks" && pwd)"
ENV_FILE="${BUNDLE_DIR}/../.env"

# Load .env so running this script directly behaves the same as `make deploy-databricks`
# (the Makefile includes/exports .env; a bare `bash scripts/deploy-databricks.sh` did not, so
# settings written there were silently ignored).
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

# DATABRICKS_* are the names used in .env.example and the Makefile; DOCINTEL_* are accepted as
# aliases so either spelling works.
CATALOG="${DATABRICKS_CATALOG:-${DOCINTEL_CATALOG:-docintel}}"
SCHEMA="${DATABRICKS_SCHEMA:-${DOCINTEL_SCHEMA:-docs}}"
SECRET_SCOPE="${DATABRICKS_SECRET_SCOPE:-${DOCINTEL_SECRET_SCOPE:-docintel}}"
SP_NAME="docintel-aws"
APP_NAME="mcp-docintel"
JOB_NAME="docintel_pdf_agent"

db() { databricks --profile "$PROFILE" "$@"; }
jval() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "==> Deploying DocIntel bundle to target '${TARGET}' (profile '${PROFILE}')"

# 1. Secret scope (idempotent) — ready for `make link` to populate AWS creds into.
# Parse the JSON rather than grepping it: the CLI pretty-prints with spaces after the colon,
# so a "name":"scope" substring match silently misses and the create below then fails the whole
# script with `Scope docintel already exists!` on every re-run.
if db secrets list-scopes -o json \
  | jval "any(x.get('name') == '${SECRET_SCOPE}' for x in (d if isinstance(d, list) else d.get('scopes', [])))" \
  | grep -q True; then
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

# 3. OAuth secret for the SP. NOTE: --lifetime must carry a unit suffix ('15768000s');
#    the CLI help says "in seconds" but the API parses a Go Duration and a bare number
#    fails with "Could not parse request object: Error parsing Duration".
#    The value is never echoed to stdout/log — it is
#    captured straight into a shell variable and appended to a local .env line.
# Reuse the secret already in .env if there is one. A service principal is capped at 5 OAuth
# secrets, so minting a fresh one on every run exhausts the quota
# ("RESOURCE_EXHAUSTED: Cannot have more than 5 oauth secrets in one service principal")
# and makes the script unusable after a few re-runs.
EXISTING_SP_SECRET=""
if [[ -f "${ENV_FILE}" ]]; then
  EXISTING_SP_SECRET="$(grep -E '^DATABRICKS_SP_CLIENT_SECRET=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
fi
if [[ -n "${EXISTING_SP_SECRET}" ]]; then
  echo "==> Reusing existing OAuth secret for '${SP_NAME}' from ${ENV_FILE}"
  SP_SECRET_JSON="$(printf '{"secret":"%s"}' "${EXISTING_SP_SECRET}")"
else
  echo "==> Creating OAuth secret for '${SP_NAME}' (value is not logged)"
  SP_SECRET_JSON="$(db service-principal-secrets-proxy create "${SP_ID}" --lifetime 15768000s -o json)"
fi
unset EXISTING_SP_SECRET
# Replace rather than append, so re-running never leaves two conflicting values in .env
# (the last one wins when sourced, which silently masks a rotated secret).
SP_SECRET_VALUE="$(echo "${SP_SECRET_JSON}" | jval 'd["secret"]')"
touch "${ENV_FILE}"
grep -v -E '^DATABRICKS_SP_CLIENT_(ID|SECRET)=' "${ENV_FILE}" >"${ENV_FILE}.tmp" || true
{
  echo "DATABRICKS_SP_CLIENT_ID=${SP_APP_ID}"
  echo "DATABRICKS_SP_CLIENT_SECRET=${SP_SECRET_VALUE}"
} >>"${ENV_FILE}.tmp"
mv "${ENV_FILE}.tmp" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
unset SP_SECRET_VALUE
unset SP_SECRET_JSON
echo "==> Wrote SP credentials to ${ENV_FILE} (values not printed)"

# A freshly created service principal has NO entitlements, and without `workspace-access` it
# cannot call workspace resources: an OAuth token for it is valid and correctly scoped, yet every
# request to the Databricks App returns 401 with no hint as to why. Grant it explicitly.
echo "==> Ensuring '${SP_NAME}' has the workspace-access entitlement"
db service-principals patch "${SP_ID}" --json '{"Operations":[{"op":"add","path":"entitlements","value":[{"value":"workspace-access"}]}],"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"]}' >/dev/null 2>&1 \
  || echo "    (entitlement already present or patch not permitted)"

# 4. Catalog must pre-exist; the bundle only manages the schema below it.
if db catalogs get "${CATALOG}" >/dev/null 2>&1; then
  echo "==> Catalog '${CATALOG}' already exists"
else
  echo "==> Creating catalog '${CATALOG}'"
  # On a Default Storage workspace the API refuses a catalog with no MANAGED LOCATION
  # ("Metastore storage root URL does not exist"). Rather than fail the whole deploy, point the
  # operator at the workspace's built-in catalog, which already has managed storage.
  if ! db catalogs create "${CATALOG}"; then
    echo "!!  Could not create catalog '${CATALOG}'." >&2
    echo "    This workspace uses Default Storage, so a new catalog needs a MANAGED LOCATION" >&2
    echo "    (or must be created in the UI). Easiest fix: reuse the built-in catalog by" >&2
    echo "    setting DATABRICKS_CATALOG=workspace in .env and re-running this script." >&2
    exit 1
  fi
fi

# 5. Deploy the bundle: creates the schema, volume, job, and app. The app's own
#    startup path runs sql/setup.sql's idempotent DDL to create document_results.
# The app declares secret-backed env vars, so every key must already exist in the scope or the
# app resource fails to create ("Invalid secret resource ...: Secret with scope docintel and key
# aws_gateway_url does not exist"). `make link` runs *after* this (it needs the app URL), so seed
# placeholders here for any key that is missing; link.sh then overwrites them with real values.
echo "==> Ensuring AWS MCP secret keys exist (placeholders until \`make link\`)"
EXISTING_KEYS="$(db secrets list-secrets "${SECRET_SCOPE}" -o json \
  | jval "' '.join(x.get('key','') for x in (d if isinstance(d, list) else d.get('secrets', [])))")"
for KEY in aws_gateway_url aws_mcp_token_url aws_mcp_client_id aws_mcp_client_secret aws_mcp_scope; do
  if [[ " ${EXISTING_KEYS} " != *" ${KEY} "* ]]; then
    printf '%s' "PENDING_MAKE_LINK" | db secrets put-secret "${SECRET_SCOPE}" "${KEY}"
    echo "    seeded ${KEY}"
  fi
done
unset EXISTING_KEYS

echo "==> Running bundle deploy"
# Databricks Asset Bundles drive Terraform under the hood and, by default, download it at first
# use. On this CLI version that download fails with "unable to verify checksums signature:
# openpgp: key expired" (HashiCorp rotated their signing key). Point the CLI at a local terraform
# binary instead, which skips the download entirely.
if [[ -z "${DATABRICKS_TF_EXEC_PATH:-}" ]] && command -v terraform >/dev/null 2>&1; then
  DATABRICKS_TF_EXEC_PATH="$(command -v terraform)"
  export DATABRICKS_TF_EXEC_PATH
  # The CLI pins an expected Terraform version and refuses anything else ("... is 1.14.5 but
  # expected version is 1.5.5. Set DATABRICKS_TF_VERSION to 1.14.5 to continue"), so declare
  # whichever version is actually installed rather than forcing the operator to match the pin.
  if [[ -z "${DATABRICKS_TF_VERSION:-}" ]]; then
    DATABRICKS_TF_VERSION="$("${DATABRICKS_TF_EXEC_PATH}" version -json 2>/dev/null \
      | jval 'd["terraform_version"]' 2>/dev/null || true)"
    [[ -n "${DATABRICKS_TF_VERSION}" ]] && export DATABRICKS_TF_VERSION
  fi
  echo "==> Using local terraform ${DATABRICKS_TF_VERSION:-(unknown version)} at ${DATABRICKS_TF_EXEC_PATH}"
elif [[ -z "${DATABRICKS_TF_EXEC_PATH:-}" ]]; then
  echo "!! terraform not found on PATH." >&2
  echo "   Databricks Asset Bundles drive Terraform internally and this CLI's own download" >&2
  echo "   fails on HashiCorp's expired signing key, so a local binary is required:" >&2
  echo "     curl -sL -o /tmp/tf.zip https://releases.hashicorp.com/terraform/1.5.5/terraform_1.5.5_linux_amd64.zip" >&2
  echo "     unzip -o /tmp/tf.zip -d \"\$HOME/.local/bin\" && chmod +x \"\$HOME/.local/bin/terraform\"" >&2
  exit 1
fi

# Bundle variables are declared in databricks.yml; `warehouse_id` has no default, so it must be
# supplied here or the deploy stops with "no value assigned to required variable warehouse_id".
if [[ -z "${DATABRICKS_WAREHOUSE_ID:-}" ]]; then
  echo "!! DATABRICKS_WAREHOUSE_ID is not set (see .env.example)." >&2
  echo "   List them with: databricks warehouses list -p ${PROFILE}" >&2
  exit 1
fi
(
  cd "${BUNDLE_DIR}" && databricks bundle deploy -t "${TARGET}" --profile "${PROFILE}" \
    --auto-approve \
    --var "catalog=${CATALOG}" \
    --var "schema=${SCHEMA}" \
    --var "warehouse_id=${DATABRICKS_WAREHOUSE_ID}" \
    --var "llm_endpoint=${DATABRICKS_LLM_ENDPOINT:-databricks-gpt-oss-120b}" \
    --var "aws_secret_scope=${SECRET_SCOPE}"
)

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

# The App runs as its OWN service principal (distinct from ${SP_NAME}, which is only the
# AWS-side caller). Without these grants the app starts, connects to the warehouse, and then dies
# in startup with "User does not have USE SCHEMA on Schema" — so grant it too.
APP_SP_ID="$(db apps get "${APP_NAME}" -o json | jval 'd.get("service_principal_client_id", "")')"
if [[ -n "${APP_SP_ID}" ]]; then
  echo "==> Granting Unity Catalog privileges to the app's service principal"
  db grants update catalog "${CATALOG}" \
    --json "{\"changes\": [{\"principal\": \"${APP_SP_ID}\", \"add\": [\"USE_CATALOG\"]}]}" >/dev/null
  db grants update schema "${CATALOG}.${SCHEMA}" \
    --json "{\"changes\": [{\"principal\": \"${APP_SP_ID}\", \"add\": [\"USE_SCHEMA\", \"SELECT\", \"MODIFY\", \"CREATE_TABLE\"]}]}" >/dev/null
  db grants update volume "${CATALOG}.${SCHEMA}.inbox" \
    --json "{\"changes\": [{\"principal\": \"${APP_SP_ID}\", \"add\": [\"READ_VOLUME\", \"WRITE_VOLUME\"]}]}" >/dev/null
  # The app triggers the async PDF job as itself, so it needs run rights on that job too;
  # without them the job is invisible to it and run_pdf_agent fails with
  # "no Databricks job named 'docintel_pdf_agent'".
  # The app writes the short-lived AWS gateway token into the secret scope before triggering the
  # async job (job parameters are stored in run history, so a token must never be one).
  db secrets put-acl "${SECRET_SCOPE}" "${APP_SP_ID}" WRITE >/dev/null 2>&1 \
    || echo "    (scope WRITE acl already present)"
  APP_JOB_ID="$(db jobs list --name "${JOB_NAME}" -o json | jval 'd[0]["job_id"] if d else ""')"
  if [[ -n "${APP_JOB_ID}" ]]; then
    db jobs update-permissions "${APP_JOB_ID}" \
      --json "{\"access_control_list\": [{\"service_principal_name\": \"${APP_SP_ID}\", \"permission_level\": \"CAN_MANAGE_RUN\"}]}" >/dev/null
  fi
else
  echo "!! could not resolve the app's service principal; grant UC privileges manually" >&2
fi

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
