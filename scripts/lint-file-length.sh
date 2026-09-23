#!/usr/bin/env bash
# G1: source files ≤ 300 lines, test files ≤ 400. Generated/vendored files are excluded.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAX_SRC=300; MAX_TEST=400; FAIL=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  if [[ "$f" == *"/tests/"* || "$f" == *.test.ts || "$f" == *.test.tsx || "$f" == *_test.py ]]; then limit=$MAX_TEST; else limit=$MAX_SRC; fi
  if (( n > limit )); then echo "✘ $f: $n lines (limit $limit)"; FAIL=1; fi
done < <(cd "$ROOT" && find aws databricks frontend/src scripts samples -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.sh' \) \
          -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/cdk.out/*' -not -path '*/build/*' 2>/dev/null)
[[ $FAIL -eq 0 ]] && echo "✔ file-length check passed"
exit $FAIL
