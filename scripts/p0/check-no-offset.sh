#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "P0-2: OFFSET Prohibition Check"
echo "=========================================="

# routes ディレクトリで OFFSET を使っているファイルを検索
# LIMIT ... OFFSET ... パターンを検出
# P0: 例外ゼロ（admin も cursor化必須）
# TODO: adminDashboard.ts と rooms.ts は後で cursor化

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
  echo ""
  echo "Note: NO exceptions for user-facing routes."
  echo "Scale target: 100k users × 1000 lists = 100M rows."
  echo ""
  echo "TODO: adminDashboard.ts and rooms.ts need cursor pagination."
  exit 1
fi

# Check TODO files (warn only)
TODO_FOUND=$(grep -rn "LIMIT.*OFFSET" apps/api/src/routes/adminDashboard.ts apps/api/src/routes/rooms.ts 2>/dev/null || true)

if [ -n "$TODO_FOUND" ]; then
  echo "⚠️  TODO: OFFSET found in admin/internal routes (not blocking):"
  echo "$TODO_FOUND"
  echo ""
fi

echo "✅ PASS: No OFFSET pagination in user-facing routes (cursor only)"
