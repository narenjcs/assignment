#!/usr/bin/env bash
# Lock or unlock public access to the DocIntel demo, with no redeploy and nothing torn down.
#
# The API sits behind an unauthenticated Lambda Function URL (PLAN.md §2.5), so anyone holding
# the CloudFront link can spend Bedrock/Databricks money via POST /chat and /jobs/{id}/process,
# write into the uploads bucket via POST /uploads, and read every job in the table via GET /jobs.
# `lock` sets the API function's reserved concurrency to 0, which means AWS refuses to start a
# single invocation: every one of those routes fails at the throttle, before any handler code,
# any model call, or any DynamoDB read. `unlock` puts the cap back.
#
# Why this lever and not CloudFront: disabling the distribution takes several minutes to
# propagate each way, while a concurrency change takes effect in seconds and reverses just as
# fast. The static SPA stays reachable while locked, which is harmless -- it is public HTML and
# does nothing at all without the API behind it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
FUNCTION="${DOCINTEL_API_FUNCTION:-docintel-api}"
# Must match API_RESERVED_CONCURRENCY in aws/infra/lib/constructs/lambdas.ts, so that unlocking
# restores exactly what `cdk deploy` would set rather than silently widening the cap.
UNLOCKED_CONCURRENCY="${DOCINTEL_API_CONCURRENCY:-20}"

die() { echo "!! $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: scripts/access.sh <lock|unlock|status>

  lock     Block all API traffic (reserved concurrency -> 0). Takes effect in seconds.
  unlock   Restore normal service (reserved concurrency -> 20).
  status   Report whether the API is currently locked, and probe the live endpoint.

Env overrides: AWS_REGION, DOCINTEL_API_FUNCTION, DOCINTEL_API_CONCURRENCY
USAGE
}

current_concurrency() {
  # Absent reserved concurrency means "unreserved", which is wide open, not locked. Report it as
  # a distinct value so `status` never mistakes an un-capped function for a locked one.
  aws lambda get-function-concurrency --function-name "${FUNCTION}" --region "${REGION}" \
    --query 'ReservedConcurrentExecutions' --output text 2>/dev/null || echo "None"
}

web_url() {
  local outputs="${ROOT}/cdk-outputs.json"
  [[ -f "${outputs}" ]] || return 1
  python3 -c "import json;print(json.load(open('${outputs}'))['DocIntelStack']['WebUrl'])" 2>/dev/null
}

probe() {
  local url
  url="$(web_url)" || return 0
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "${url}/health" || echo "000")"
  echo "    probe  GET ${url}/health -> HTTP ${code}"
}

set_concurrency() {
  aws lambda put-function-concurrency --function-name "${FUNCTION}" --region "${REGION}" \
    --reserved-concurrent-executions "$1" --query 'ReservedConcurrentExecutions' --output text >/dev/null
}

case "${1:-}" in
  lock)
    set_concurrency 0
    echo "==> LOCKED: ${FUNCTION} reserved concurrency = 0"
    echo "    Every API route now throttles. No Bedrock or Databricks spend is reachable."
    echo "    The SPA still loads and will show errors until you unlock. Reverse: $0 unlock"
    ;;
  unlock)
    set_concurrency "${UNLOCKED_CONCURRENCY}"
    echo "==> UNLOCKED: ${FUNCTION} reserved concurrency = ${UNLOCKED_CONCURRENCY}"
    echo "    The API is public and unauthenticated again. Lock it when you are done demoing."
    ;;
  status)
    CURRENT="$(current_concurrency)"
    case "${CURRENT}" in
      0)    echo "==> LOCKED (reserved concurrency = 0)" ;;
      None) echo "==> UNLOCKED and UNCAPPED (no reserved concurrency set)" ;;
      *)    echo "==> UNLOCKED (reserved concurrency = ${CURRENT})" ;;
    esac
    probe
    ;;
  ''|-h|--help|help) usage ;;
  *) usage; die "unknown command: $1" ;;
esac
