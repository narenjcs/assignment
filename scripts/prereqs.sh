#!/usr/bin/env bash
# Checks tools + cloud sessions needed to deploy DocIntel.
set -uo pipefail
ok(){ printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad(){ printf "  \033[31m✘\033[0m %s\n" "$1"; FAIL=1; }
FAIL=0
for t in aws databricks node npm uv jq; do command -v "$t" >/dev/null && ok "$t $($t --version 2>&1 | head -1)" || bad "$t missing"; done
# Databricks Asset Bundles drive Terraform internally, and this CLI's own download of it fails
# on HashiCorp's expired signing key, so a local binary is required for `make deploy-databricks`.
if command -v terraform >/dev/null; then
  ok "terraform $(terraform version 2>&1 | head -1) (used by databricks bundle)"
else
  bad "terraform missing - needed by \`databricks bundle\`; install with:
       curl -sL -o /tmp/tf.zip https://releases.hashicorp.com/terraform/1.5.5/terraform_1.5.5_linux_amd64.zip
       unzip -o /tmp/tf.zip -d \"\$HOME/.local/bin\" && chmod +x \"\$HOME/.local/bin/terraform\""
fi
if aws sts get-caller-identity >/dev/null 2>&1; then ok "AWS session ($(aws sts get-caller-identity --query Arn --output text))"; else bad "AWS session expired → run: aws login"; fi
P="${DATABRICKS_CONFIG_PROFILE:-docintel}"
if databricks current-user me -p "$P" >/dev/null 2>&1; then ok "Databricks profile '$P' ($(databricks current-user me -p "$P" | jq -r .userName))"; else bad "Databricks profile '$P' not valid → run: databricks auth login --host https://<workspace> --profile $P"; fi
exit $FAIL
