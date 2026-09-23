#!/usr/bin/env bash
# Verifies which Bedrock models this account can invoke WITH tool calling in $AWS_REGION and
# prints the best available one as BEDROCK_MODEL_ID=... (first working entry wins).
# Usage: scripts/pick-model.sh [region]   |  eval "$(scripts/pick-model.sh)"
set -euo pipefail
REGION="${1:-${AWS_REGION:-us-east-1}}"
CANDIDATES=(
  "${BEDROCK_MODEL_ID:-}"
  "openai.gpt-oss-120b-1:0"
  "us.amazon.nova-2-lite-v1:0"
  "mistral.mistral-large-3-675b-instruct"
  "openai.gpt-oss-20b-1:0"
)
TOOL_CFG='{"tools":[{"toolSpec":{"name":"get_job","description":"Fetch a job","inputSchema":{"json":{"type":"object","properties":{"job_id":{"type":"string"}},"required":["job_id"]}}}}]}'
MSG='[{"role":"user","content":[{"text":"Call get_job for job 123 then stop."}]}]'

probe() {
  local model="$1"
  aws bedrock-runtime converse --region "$REGION" --model-id "$model" --messages "$MSG" \
    --tool-config "$TOOL_CFG" --inference-config '{"maxTokens":64}' \
    --query 'stopReason' --output text 2>/dev/null
}

for m in "${CANDIDATES[@]}"; do
  [[ -z "$m" ]] && continue
  if [[ "$(probe "$m" || true)" == "tool_use" ]]; then
    echo "# $m: tool calling OK in $REGION" >&2
    echo "BEDROCK_MODEL_ID=$m"
    exit 0
  fi
  echo "# $m: not usable in $REGION" >&2
done
echo "# no candidate model is invocable with tool calling in $REGION" >&2
exit 1
