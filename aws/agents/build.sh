#!/usr/bin/env bash
# T4.3: package the two AgentCore agents (docx_agent, orchestrator) as arm64 zips
# using uv (PLAN.md §3 step 2: "uv pip install --python-platform aarch64-manylinux2014
# --target ... for the two agent zips (AgentCore requires arm64)"; verified against
# `uv pip install --help` (uv 0.10.6): --python-platform accepts "aarch64-manylinux2014",
# --python-version sets the target interpreter, -t/--target installs into a plain
# directory rather than a venv).
#
# AgentCore's direct code-zip deploy layout is flat at the zip root: `main.py` and
# its sibling modules sit next to each other (not inside a subpackage), with
# `docintel_common/` copied in as a normal nested package alongside them and
# third-party dependencies installed at the same top level. This was confirmed
# empirically while building docx_agent/main.py and orchestrator/main.py: relative
# imports (`from .prompts import ...`) fail at import time under this layout, so
# both agents use flat sibling imports (`from prompts import ...`) instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS_DIR="$ROOT/aws/agents"
COMMON_PKG="$ROOT/aws/common/docintel_common"
DIST_DIR="$AGENTS_DIR/dist"
PLATFORM="aarch64-manylinux2014"
PY_VERSION="3.12"
MAX_UNZIPPED_BYTES=$((250 * 1024 * 1024))
AGENTS=(docx_agent orchestrator)

build_agent() {
  local agent="$1" src_dir build_dir zip_path unzipped_bytes
  src_dir="$AGENTS_DIR/$agent"
  build_dir="$(mktemp -d)"

  echo "==> $agent: installing deps for $PLATFORM / py$PY_VERSION"
  uv pip install \
    --python-platform "$PLATFORM" \
    --python-version "$PY_VERSION" \
    --target "$build_dir" \
    -r "$src_dir/requirements.txt" \
    --quiet

  echo "==> $agent: copying app code (flat AgentCore zip-root layout)"
  cp "$src_dir"/*.py "$build_dir/"
  cp -r "$COMMON_PKG" "$build_dir/docintel_common"
  find "$build_dir" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

  unzipped_bytes=$(du -sb "$build_dir" | cut -f1)
  if ((unzipped_bytes > MAX_UNZIPPED_BYTES)); then
    echo "✘ $agent: unzipped size $(numfmt --to=iec "$unzipped_bytes") exceeds 250MB limit" >&2
    rm -rf "$build_dir"
    exit 1
  fi

  zip_path="$DIST_DIR/$agent.zip"
  rm -f "$zip_path"
  (cd "$build_dir" && zip -rq "$zip_path" .)

  echo "✔ $agent: $(du -h "$zip_path" | cut -f1) zipped," \
    "$(numfmt --to=iec "$unzipped_bytes") unzipped -> ${zip_path#"$ROOT"/}"
  rm -rf "$build_dir"
}

mkdir -p "$DIST_DIR"
for agent in "${AGENTS[@]}"; do
  build_agent "$agent"
done

echo "✔ build.sh complete: $(ls "$DIST_DIR")"
