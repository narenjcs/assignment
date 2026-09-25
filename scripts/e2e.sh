#!/usr/bin/env bash
set -euo pipefail

# End-to-end demo runner against the deployed stack's public HTTP API only (PLAN.md §6, T8.1).
# Runs the 4 demo scenarios (docx/pdf x async/sync) using samples/sample-contract.docx and
# samples/sample-report.pdf, then a chat follow-up on the last COMPLETED job. Prints a results
# table and exits non-zero if any scenario or the chat check failed. Per-run logs (raw HTTP/SSE
# bodies) go under /tmp/docintel-e2e-<run-id>/, path printed per scenario.
#
# Requires: `cdk-outputs.json` (run `make deploy-aws` first, and `make link` so the async PDF
# path can reach Databricks); `curl`, `jq` on PATH. Usage: scripts/e2e.sh [poll-timeout-seconds]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS_FILE="${ROOT}/cdk-outputs.json"
POLL_TIMEOUT="${1:-600}"
POLL_INTERVAL=3
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="/tmp/docintel-e2e-${RUN_ID}"
OVERALL=0
declare -a ROWS=()

for t in curl jq; do
  command -v "$t" >/dev/null || { echo "!! '$t' not on PATH" >&2; exit 1; }
done
[[ -f "$OUTPUTS_FILE" ]] || { echo "!! missing ${OUTPUTS_FILE} (run \`make deploy-aws\` first)" >&2; exit 1; }
API="$(jq -r '(.DocIntelStack // (to_entries[0].value // {})).ApiUrl // empty' "$OUTPUTS_FILE")"
[[ -n "$API" ]] || { echo "!! cdk-outputs.json has no 'ApiUrl'" >&2; exit 1; }
API="${API%/}"
mkdir -p "$LOG_DIR"

if ! curl -sS --max-time 10 "${API}/health" | jq -e '.ok == true' >/dev/null 2>&1; then
  echo "!! GET ${API}/health did not return ok:true — is the stack deployed?" >&2
  exit 1
fi
echo "==> API: ${API}"
echo "==> Logs: ${LOG_DIR}"

# The Databricks App can be stopped out from under us (seen 2026-09-25: "App compute was stopped
# due to workspace or account status"); every PDF run then fails with an opaque MCP connect
# error. Fail fast here with the fix instead of four minutes of FAILED scenarios.
DBX_APP="${DOCINTEL_APP_NAME:-mcp-docintel}"
DBX_PROFILE="${DATABRICKS_CONFIG_PROFILE:-docintel}"
if command -v databricks >/dev/null; then
  app_state="$(databricks --profile "$DBX_PROFILE" apps get "$DBX_APP" -o json 2>/dev/null \
    | jq -r '"\(.app_status.state // "UNKNOWN")/\(.compute_status.state // "UNKNOWN")"')" \
    || app_state="UNKNOWN/UNKNOWN"
  if [[ "$app_state" != "RUNNING/ACTIVE" ]]; then
    echo "!! Databricks App ${DBX_APP} is ${app_state} (app/compute), so PDF scenarios would fail." >&2
    echo "   Start it: databricks --profile ${DBX_PROFILE} apps start ${DBX_APP}" >&2
    exit 1
  fi
  echo "==> Databricks App: ${DBX_APP} ${app_state}"
else
  echo "==> databricks CLI not on PATH; skipping the Databricks App preflight"
fi

if [[ ! -f "${ROOT}/samples/sample-contract.docx" || ! -f "${ROOT}/samples/sample-report.pdf" ]]; then
  echo "==> Sample files missing; running \`make samples\`"
  (cd "$ROOT" && make samples)
fi

# upload_and_put FILE CONTENT_TYPE MODE -> echoes jobId on success, empty on failure.
upload_and_put() {
  local file="$1" content_type="$2" mode="$3" log="$4"
  local body jobId uploadUrl
  body="$(curl -sS --max-time 20 -X POST "${API}/uploads" -H 'content-type: application/json' \
    -d "$(jq -n --arg f "$(basename "$file")" --arg c "$content_type" --arg m "$mode" \
      '{fileName:$f, contentType:$c, mode:$m}')")" || return 1
  echo "POST /uploads -> ${body}" >>"$log"
  jobId="$(jq -r '.jobId // empty' <<<"$body")"
  uploadUrl="$(jq -r '.uploadUrl // empty' <<<"$body")"
  [[ -n "$jobId" && -n "$uploadUrl" ]] || return 1
  curl -sS --max-time 60 -X PUT "$uploadUrl" -H "content-type: ${content_type}" \
    --data-binary "@${file}" >>"$log" 2>&1 || return 1
  echo "$jobId"
}

# wait_terminal JOB_ID LOG -> echoes final status (COMPLETED/FAILED/TIMEOUT).
wait_terminal() {
  local jobId="$1" log="$2" waited=0 status body
  while ((waited < POLL_TIMEOUT)); do
    body="$(curl -sS --max-time 15 "${API}/jobs/${jobId}")" || body=""
    status="$(jq -r '.status // empty' <<<"$body")" || status=""
    if [[ "$status" == "COMPLETED" || "$status" == "FAILED" ]]; then
      echo "$body" >>"$log"
      echo "$status"
      return 0
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
  echo "TIMEOUT"
}

# run_scenario LABEL FILE CONTENT_TYPE MODE -> appends a row to ROWS, sets OVERALL=1 on failure.
run_scenario() {
  local label="$1" file="$2" content_type="$3" mode="$4"
  local log="${LOG_DIR}/${label}.log" start jobId status duration summary
  start=$(date +%s)
  echo "==> [${label}] uploading $(basename "$file") (mode=${mode})"
  jobId="$(upload_and_put "$file" "$content_type" "$mode" "$log")" || jobId=""
  if [[ -z "$jobId" ]]; then
    echo "    upload/PUT failed — see ${log}"
    ROWS+=("${label}|${mode}|-|FAILED(upload)|-|${log}")
    OVERALL=1
    return
  fi
  echo "    jobId=${jobId}"
  if [[ "$mode" == "sync" ]]; then
    curl -sS --max-time "$POLL_TIMEOUT" -X POST "${API}/jobs/${jobId}/process" >>"$log" 2>&1 || true
  fi
  status="$(wait_terminal "$jobId" "$log")"
  duration=$(( $(date +%s) - start ))
  summary="$(curl -sS --max-time 15 "${API}/jobs/${jobId}" | jq -r '.result.summary // empty')" || summary=""
  if [[ "$status" != "COMPLETED" || -z "$summary" ]]; then
    echo "    FAILED (status=${status}, summary empty=$([[ -z "$summary" ]] && echo yes || echo no))"
    OVERALL=1
  else
    echo "    COMPLETED in ${duration}s"
    LAST_COMPLETED_JOB_ID="$jobId"
  fi
  ROWS+=("${label}|${mode}|${jobId}|${status}|${duration}s|${log}")
}

run_scenario "docx-async" "${ROOT}/samples/sample-contract.docx" \
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" async
run_scenario "docx-sync" "${ROOT}/samples/sample-contract.docx" \
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" sync
run_scenario "pdf-async" "${ROOT}/samples/sample-report.pdf" "application/pdf" async
run_scenario "pdf-sync" "${ROOT}/samples/sample-report.pdf" "application/pdf" sync

echo "==> Chat follow-up"
if [[ -n "${LAST_COMPLETED_JOB_ID:-}" ]]; then
  CHAT_LOG="${LOG_DIR}/chat.log"
  curl -sS --max-time 60 -X POST "${API}/chat" -H 'content-type: application/json' \
    -d "$(jq -n --arg j "$LAST_COMPLETED_JOB_ID" '{jobId:$j, message:"Summarize this document in one sentence."}')" \
    >"$CHAT_LOG" 2>&1 || true
  # The chat stream serialises as `"type": "token"` (space after the colon); match either form.
  if grep -Eq '"type": ?"(token|result)"' "$CHAT_LOG"; then
    echo "    OK — see ${CHAT_LOG}"
  else
    echo "    FAILED — no token/result events, see ${CHAT_LOG}"
    OVERALL=1
  fi
else
  echo "    SKIPPED — no scenario completed successfully"
  OVERALL=1
fi

echo
echo "==> Results"
printf '%-12s %-6s %-36s %-10s %-8s %s\n' "SCENARIO" "MODE" "JOB ID" "STATUS" "TIME" "LOG"
for row in "${ROWS[@]}"; do
  IFS='|' read -r label mode jobId status duration log <<<"$row"
  printf '%-12s %-6s %-36s %-10s %-8s %s\n' "$label" "$mode" "$jobId" "$status" "$duration" "$log"
done

exit "$OVERALL"
