#!/usr/bin/env bash
# Deploy the built SPA without a CloudFormation changeset: sync frontend/dist to the web bucket,
# rewrite config.json with the live API URL, and invalidate CloudFront. ~20s versus minutes for a
# full `cdk deploy`, and safe because it touches only bucket contents — no infrastructure.
# Use `make deploy-aws` when infrastructure itself changed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
OUTPUTS="${ROOT}/cdk-outputs.json"

die() { echo "!! $*" >&2; exit 1; }
[[ -d "${ROOT}/frontend/dist" ]] || die "frontend/dist missing — run: make build-frontend"
[[ -f "${OUTPUTS}" ]] || die "cdk-outputs.json missing — run: make deploy-aws"

API_URL="$(python3 -c "import json;print(json.load(open('${OUTPUTS}'))['DocIntelStack']['WebUrl'])")"
BUCKET="$(aws s3api list-buckets --region "${REGION}" \
  --query "Buckets[?starts_with(Name,'docintel-web-')].Name" --output text | head -n1)"
[[ -n "${BUCKET}" ]] || die "could not find the docintel-web-* bucket"
HOST="${API_URL#https://}"
DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?DomainName=='${HOST}'].Id" --output text | head -n1)"
[[ -n "${DIST_ID}" ]] || die "could not find the CloudFront distribution for ${HOST}"

# The SPA reads /config.json at startup, so the API URL is never baked into the bundle.
printf '{"apiUrl":"%s"}\n' "${API_URL}" >"${ROOT}/frontend/dist/config.json"

echo "==> Syncing frontend/dist to s3://${BUCKET}"
aws s3 sync "${ROOT}/frontend/dist" "s3://${BUCKET}" --delete --only-show-errors --region "${REGION}"
echo "==> Invalidating CloudFront ${DIST_ID}"
aws cloudfront create-invalidation --distribution-id "${DIST_ID}" --paths '/*' \
  --query 'Invalidation.Status' --output text
echo "==> Done: ${API_URL}"
