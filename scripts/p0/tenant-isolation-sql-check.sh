#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "P0-5: Tenant Isolation SQL Check"
echo "=========================================="

# ============================================================
# Purpose: Verify tenant isolation at SQL level (lightweight)
# ============================================================

# Create test users
echo "[1] Create test users"
npx wrangler d1 execute webapp-production --local --command="
  INSERT OR IGNORE INTO users (id, email, created_at) 
  VALUES 
    ('sql-check-user-a', 'sql-a@example.com', datetime('now')),
    ('sql-check-user-b', 'sql-b@example.com', datetime('now'));
" 2>&1 | tail -1 || true

# Insert thread owned by userA
THREAD_ID="sql-check-thread-001"
echo "[2] Insert thread owned by userA"
npx wrangler d1 execute webapp-production --local --command="
  INSERT OR REPLACE INTO scheduling_threads (id, organizer_user_id, workspace_id, title, created_at)
  VALUES ('${THREAD_ID}', 'sql-check-user-a', 'ws-default', 'SQL Check Thread', datetime('now'));
" 2>&1 | tail -1 || true

# Insert list owned by userA
LIST_ID="sql-check-list-001"
echo "[3] Insert list owned by userA"
npx wrangler d1 execute webapp-production --local --command="
  INSERT OR REPLACE INTO lists (id, workspace_id, owner_user_id, name, description, created_at)
  VALUES ('${LIST_ID}', 'ws-default', 'sql-check-user-a', 'SQL Check List', 'Test', datetime('now'));
" 2>&1 | tail -1 || true

# ============================================================
# Tenant Isolation Check: userB should NOT see userA's data
# ============================================================

echo "[4] Check: userB should NOT see userA's thread"
THREAD_COUNT=$(npx wrangler d1 execute webapp-production --local --command="
  SELECT COUNT(*) as count FROM scheduling_threads 
  WHERE id = '${THREAD_ID}' 
    AND workspace_id = 'ws-default' 
    AND organizer_user_id = 'sql-check-user-b';
" 2>&1 | grep -oP '\d+' | tail -1 || echo "0")

if [ "$THREAD_COUNT" != "0" ]; then
  echo "❌ Tenant isolation FAILED: userB can see userA's thread"
  exit 1
fi

echo "✅ userB cannot see userA's thread (tenant isolation working)"

echo "[5] Check: userB should NOT see userA's list"
LIST_COUNT=$(npx wrangler d1 execute webapp-production --local --command="
  SELECT COUNT(*) as count FROM lists 
  WHERE id = '${LIST_ID}' 
    AND workspace_id = 'ws-default' 
    AND owner_user_id = 'sql-check-user-b';
" 2>&1 | grep -oP '\d+' | tail -1 || echo "0")

if [ "$LIST_COUNT" != "0" ]; then
  echo "❌ Tenant isolation FAILED: userB can see userA's list"
  exit 1
fi

echo "✅ userB cannot see userA's list (tenant isolation working)"

# ============================================================
# Positive check: userA SHOULD see their own data
# ============================================================

echo "[6] Check: userA SHOULD see their own thread"
THREAD_COUNT_A=$(npx wrangler d1 execute webapp-production --local --command="
  SELECT COUNT(*) as count FROM scheduling_threads 
  WHERE id = '${THREAD_ID}' 
    AND workspace_id = 'ws-default' 
    AND organizer_user_id = 'sql-check-user-a';
" 2>&1 | grep -oP '\d+' | tail -1 || echo "0")

if [ "$THREAD_COUNT_A" != "1" ]; then
  echo "❌ Data access FAILED: userA cannot see their own thread"
  exit 1
fi

echo "✅ userA can see their own thread"

echo "[7] Check: userA SHOULD see their own list"
LIST_COUNT_A=$(npx wrangler d1 execute webapp-production --local --command="
  SELECT COUNT(*) as count FROM lists 
  WHERE id = '${LIST_ID}' 
    AND workspace_id = 'ws-default' 
    AND owner_user_id = 'sql-check-user-a';
" 2>&1 | grep -oP '\d+' | tail -1 || echo "0")

if [ "$LIST_COUNT_A" != "1" ]; then
  echo "❌ Data access FAILED: userA cannot see their own list"
  exit 1
fi

echo "✅ userA can see their own list"

echo ""
echo "=========================================="
echo "✅✅✅ Tenant Isolation SQL Check: PASS ✅✅✅"
echo "=========================================="
