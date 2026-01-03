#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "P0-1: Migration Immutability Check"
echo "=========================================="

# 過去のmigrationファイルに対する変更を検知
# D = deleted, R = renamed, M = modified

CHANGED=$(git diff --name-status origin/main...HEAD -- db/migrations/*.sql | grep -E '^[DRM]' || true)

if [ -n "$CHANGED" ]; then
  echo "❌ ERROR: Migration files were deleted/renamed/modified!"
  echo ""
  echo "$CHANGED"
  echo ""
  echo "Rule: NEVER modify/delete/rename past migrations."
  echo "If you need to fix a migration, create a NEW migration with a higher number."
  echo "Example: 0062_fix_previous_migration.sql"
  exit 1
fi

echo "✅ PASS: No past migrations were modified/deleted/renamed"
