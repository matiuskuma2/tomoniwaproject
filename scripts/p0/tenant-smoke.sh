#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"

echo "=========================================="
echo "P0-5: Tenant Isolation Smoke Test"
echo "=========================================="

# 前提: dev環境では x-user-id が使える
USER_A="smoke-user-a"
USER_B="smoke-user-b"
WS="ws-default"

echo "[1] Create test users"
npx wrangler d1 execute webapp-production --local --command="
  INSERT OR IGNORE INTO users (id, email, created_at) 
  VALUES ('${USER_A}', 'smoke-a@example.com', datetime('now'))
" 2>&1 | tail -1 || true

npx wrangler d1 execute webapp-production --local --command="
  INSERT OR IGNORE INTO users (id, email, created_at) 
  VALUES ('${USER_B}', 'smoke-b@example.com', datetime('now'))
" 2>&1 | tail -1 || true

# ============================================================
# Test 1: Thread Tenant Isolation
# ============================================================
THREAD_ID="smoke-thread-001"

echo "[2] Insert thread owned by userA"
npx wrangler d1 execute webapp-production --local --command="
  INSERT OR REPLACE INTO scheduling_threads (id, organizer_user_id, workspace_id, title, created_at)
  VALUES ('${THREAD_ID}', '${USER_A}', '${WS}', 'Smoke Test Thread', datetime('now'));
" 2>&1 | tail -1 || true

echo "[3] UserA can access own thread (expect 200)"
CODE_A=$(curl -s -o /tmp/smoke-a.json -w "%{http_code}" \
  -H "x-user-id: ${USER_A}" \
  "${BASE}/api/threads/${THREAD_ID}/status")

if [ "${CODE_A}" == "404" ]; then
  echo "❌ UserA should access own thread but got 404"
  cat /tmp/smoke-a.json
  exit 1
fi

echo "✅ UserA can access: ${CODE_A}"

echo "[4] UserB CANNOT access userA's thread (expect 404)"
CODE_B=$(curl -s -o /tmp/smoke-b.json -w "%{http_code}" \
  -H "x-user-id: ${USER_B}" \
  "${BASE}/api/threads/${THREAD_ID}/status")

if [ "${CODE_B}" != "404" ]; then
  echo "❌ Expected 404 but got ${CODE_B}"
  cat /tmp/smoke-b.json
  exit 1
fi

echo "✅ UserB blocked with 404 (tenant isolation working)"

# ============================================================
# Test 2: List Tenant Isolation
# ============================================================
LIST_ID="smoke-list-001"

echo "[5] Insert list owned by userA"
npx wrangler d1 execute webapp-production --local --command="
  INSERT OR REPLACE INTO lists (id, workspace_id, owner_user_id, name, description, created_at)
  VALUES ('${LIST_ID}', '${WS}', '${USER_A}', 'Smoke Test List', 'Test', datetime('now'));
" 2>&1 | tail -1 || true

echo "[6] UserA can access own list (expect 200)"
CODE_LIST_A=$(curl -s -o /tmp/smoke-list-a.json -w "%{http_code}" \
  -H "x-user-id: ${USER_A}" \
  "${BASE}/api/lists/${LIST_ID}")

if [ "${CODE_LIST_A}" == "404" ]; then
  echo "❌ UserA should access own list but got 404"
  cat /tmp/smoke-list-a.json
  exit 1
fi

echo "✅ UserA can access list: ${CODE_LIST_A}"

echo "[7] UserB CANNOT access userA's list (expect 404)"
CODE_LIST_B=$(curl -s -o /tmp/smoke-list-b.json -w "%{http_code}" \
  -H "x-user-id: ${USER_B}" \
  "${BASE}/api/lists/${LIST_ID}")

if [ "${CODE_LIST_B}" != "404" ]; then
  echo "❌ Expected 404 but got ${CODE_LIST_B}"
  cat /tmp/smoke-list-b.json
  exit 1
fi

echo "✅ UserB blocked with 404 (list tenant isolation working)"

echo ""
echo "=========================================="
echo "✅✅✅ P0 Tenant Isolation: PASS ✅✅✅"
echo "=========================================="
