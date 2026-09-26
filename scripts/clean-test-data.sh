#!/usr/bin/env bash
set -euo pipefail

# Wipes DocIntel's *data*, not its infrastructure: every job record, every uploaded/result file,
# every Unity Catalog row and every file dropped in the PDF inbox volume by test/demo runs.
# Leaves the CDK stack, the Databricks bundle, the tables/buckets/volume themselves and the
# Cognito/secret setup untouched -- for that, use `make destroy`.
#
# Safe by default: with no flags this only COUNTS what each store would delete and exits. Nothing
# is removed until you pass --yes.
#
# Usage: scripts/clean-test-data.sh [--jobs] [--s3] [--uc] [--volume] [--yes]
#   (no store flag)   target all four stores
#   --jobs            DynamoDB docintel-jobs table items
#   --s3              S3 uploads/ and results/ objects in the uploads bucket
#   --uc              Unity Catalog document_results rows
#   --volume          Files under the PDF inbox volume
#   --yes             Actually delete (otherwise: dry run / count only)
#
# Requires: aws, databricks, jq on PATH; cdk-outputs.json (make deploy-aws) for the table/bucket
# names; a working `docintel` Databricks CLI profile and DATABRICKS_WAREHOUSE_ID in .env for the
# UC delete. AWS_PROFILE/AWS_REGION/DATABRICKS_CONFIG_PROFILE env overrides all respected.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
OUTPUTS_FILE="${ROOT}/cdk-outputs.json"
REGION="${AWS_REGION:-us-east-1}"
DBX_PROFILE="${DATABRICKS_CONFIG_PROFILE:-docintel}"
CATALOG="${DATABRICKS_CATALOG:-workspace}"
SCHEMA="${DATABRICKS_SCHEMA:-docs}"
VOLUME_PATH="${DATABRICKS_VOLUME_PATH:-/Volumes/${CATALOG}/${SCHEMA}/inbox}"

die() { echo "!! $*" >&2; exit 1; }
db() { databricks --profile "$DBX_PROFILE" "$@"; }
out() { jq -r --arg k "$1" '(.DocIntelStack // (to_entries[0].value // {}))[$k] // empty' "$OUTPUTS_FILE"; }

DO_JOBS=0 DO_S3=0 DO_UC=0 DO_VOLUME=0 APPLY=0 ANY_STORE=0
for arg in "$@"; do
  case "$arg" in
    --jobs) DO_JOBS=1; ANY_STORE=1 ;;
    --s3) DO_S3=1; ANY_STORE=1 ;;
    --uc) DO_UC=1; ANY_STORE=1 ;;
    --volume) DO_VOLUME=1; ANY_STORE=1 ;;
    --yes) APPLY=1 ;;
    -h|--help)
      sed -n '4,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown flag: $arg (see --help)" ;;
  esac
done
if [[ "$ANY_STORE" -eq 0 ]]; then DO_JOBS=1 DO_S3=1 DO_UC=1 DO_VOLUME=1; fi

for t in aws jq; do command -v "$t" >/dev/null || die "'$t' not on PATH"; done
[[ -f "$OUTPUTS_FILE" ]] || die "missing ${OUTPUTS_FILE} (run \`make deploy-aws\` first)"
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

if [[ "$APPLY" -eq 1 ]]; then
  echo "==> LIVE RUN: matched data will be permanently deleted."
else
  echo "==> DRY RUN (pass --yes to actually delete anything)"
fi

clean_jobs() {
  local table
  table="$(out JobsTableName)"
  [[ -n "$table" ]] || { echo "-- jobs: no JobsTableName in ${OUTPUTS_FILE}, skipping"; return; }
  local ids
  ids="$(aws dynamodb scan --table-name "$table" --region "$REGION" \
    --projection-expression jobId --query 'Items[].jobId.S' --output json | jq -r '.[]')"
  local count=0
  [[ -n "$ids" ]] && count="$(wc -l <<<"$ids")"
  echo "-- jobs: ${count} item(s) in ${table}"
  [[ "$APPLY" -eq 1 && "$count" -gt 0 ]] || return 0
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    aws dynamodb delete-item --table-name "$table" --region "$REGION" \
      --key "{\"jobId\":{\"S\":\"${id}\"}}" >/dev/null
  done <<<"$ids"
  echo "   deleted ${count} item(s)"
}

clean_s3() {
  local bucket
  bucket="$(out UploadsBucket)"
  [[ -n "$bucket" ]] || { echo "-- s3: no UploadsBucket in ${OUTPUTS_FILE}, skipping"; return; }
  local count
  count="$(aws s3api list-objects-v2 --bucket "$bucket" --region "$REGION" \
    --query 'length(Contents[])' --output text 2>/dev/null || echo 0)"
  [[ "$count" == "None" ]] && count=0
  echo "-- s3: ${count} object(s) under uploads/ and results/ in ${bucket}"
  [[ "$APPLY" -eq 1 && "$count" -gt 0 ]] || return 0
  aws s3 rm "s3://${bucket}/uploads/" --recursive --region "$REGION" >/dev/null
  aws s3 rm "s3://${bucket}/results/" --recursive --region "$REGION" >/dev/null
  echo "   deleted (uploads/ and results/ emptied)"
}

clean_uc() {
  command -v databricks >/dev/null || { echo "-- uc: databricks CLI not on PATH, skipping"; return; }
  local wid="${DATABRICKS_WAREHOUSE_ID:-}"
  [[ -n "$wid" ]] || { echo "-- uc: DATABRICKS_WAREHOUSE_ID not set in .env, skipping"; return; }
  local table="${CATALOG}.${SCHEMA}.document_results"
  local count
  count="$(db api post /api/2.0/sql/statements --json "$(jq -n --arg wid "$wid" --arg t "$table" \
    '{warehouse_id:$wid, wait_timeout:"30s", statement:("SELECT COUNT(*) FROM " + $t)}')" \
    | jq -r '.result.data_array[0][0] // 0')"
  echo "-- uc: ${count} row(s) in ${table}"
  [[ "$APPLY" -eq 1 && "$count" -gt 0 ]] || return 0
  db api post /api/2.0/sql/statements --json "$(jq -n --arg wid "$wid" --arg t "$table" \
    '{warehouse_id:$wid, wait_timeout:"30s", statement:("DELETE FROM " + $t)}')" >/dev/null
  echo "   deleted ${count} row(s)"
}

clean_volume() {
  command -v databricks >/dev/null || { echo "-- volume: databricks CLI not on PATH, skipping"; return; }
  # `databricks fs` needs the dbfs: scheme even for a UC Volumes path, and `ls -o json` reports
  # each entry's bare filename as "name", not a full "path" -- both silently produce zero matches
  # if you use `path` or omit the scheme (ls itself fails with "no such directory" on the latter).
  local dbfs_path="dbfs:${VOLUME_PATH}"
  local names
  names="$(db fs ls "$dbfs_path" -o json 2>/dev/null | jq -r '.[].name' || true)"
  local count=0
  [[ -n "$names" ]] && count="$(wc -l <<<"$names")"
  echo "-- volume: ${count} entr(y/ies) under ${VOLUME_PATH}"
  [[ "$APPLY" -eq 1 && "$count" -gt 0 ]] || return 0
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    db fs rm -r "${dbfs_path}/${name}"
  done <<<"$names"
  echo "   deleted ${count} entr(y/ies)"
}

[[ "$DO_JOBS" -eq 1 ]] && clean_jobs
[[ "$DO_S3" -eq 1 ]] && clean_s3
[[ "$DO_UC" -eq 1 ]] && clean_uc
[[ "$DO_VOLUME" -eq 1 ]] && clean_volume

if [[ "$APPLY" -eq 0 ]]; then
  echo "==> Dry run only. Re-run with --yes (and optionally --jobs/--s3/--uc/--volume) to delete."
fi
