#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "P0-2: OFFSET Prohibition Check"
echo "=========================================="

# routes ディレクトリで OFFSET を使っているファイルを検索
# LIMIT ... OFFSET ... パターンを検出
# Note: adminDashboard.ts と rooms.ts は admin用なので除外

OFFSET_FOUND=$(grep -rn "LIMIT.*OFFSET" apps/api/src/routes/ \
  | grep -v "adminDashboard.ts" \
  | grep -v "rooms.ts" \
  || true)

if [ -n "$OFFSET_FOUND" ]; then
  echo "❌ ERROR: OFFSET pagination found in routes!"
  echo ""
  echo "$OFFSET_FOUND"
  echo ""
  echo "Rule: Use cursor pagination only (created_at + id)."
  echo "Example:"
  echo "  WHERE (created_at < ? OR (created_at = ? AND id < ?))"
  echo "  ORDER BY created_at DESC, id DESC"
  echo "  LIMIT ?"
  exit 1
fi

echo "✅ PASS: No OFFSET pagination found (cursor only)"
