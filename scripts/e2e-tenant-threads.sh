#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"

# 前提: dev環境では x-user-id が使える
USER_A="tenant-user-a"
USER_B="tenant-user-b"
WS="ws-default"

echo "[1] create users (if not exist)"
npx wrangler d1 execute webapp-production --local --command="INSERT OR IGNORE INTO users (id, email, created_at) VALUES ('${USER_A}', 'a@example.com', datetime('now'))" 2>&1 | grep -v "wrangler" | tail -1 || true
npx wrangler d1 execute webapp-production --local --command="INSERT OR IGNORE INTO users (id, email, created_at) VALUES ('${USER_B}', 'b@example.com', datetime('now'))" 2>&1 | grep -v "wrangler" | tail -1 || true

THREAD_ID="th-tenant-e2e-001"

echo "[2] insert thread owned by userA"
npx wrangler d1 execute webapp-production --local --command="
INSERT OR REPLACE INTO scheduling_threads (id, organizer_user_id, workspace_id, title, created_at)
VALUES ('${THREAD_ID}', '${USER_A}', '${WS}', 'Tenant E2E', datetime('now'));
" 2>&1 | grep -v "wrangler" | tail -1 || true

echo "[3] userA can access (expect 200 or non-404)"
CODE_A=$(curl -s -o /tmp/a.json -w "%{http_code}" \
  -H "x-user-id: ${USER_A}" \
  "${BASE}/api/threads/${THREAD_ID}/status")

if [ "${CODE_A}" == "404" ]; then
  echo "❌ userA should access own thread but got 404"
  cat /tmp/a.json
  exit 1
fi

echo "✅ userA can access: ${CODE_A}"

echo "[4] userB cannot access (expect 404)"
CODE_B=$(curl -s -o /tmp/b.json -w "%{http_code}" \
  -H "x-user-id: ${USER_B}" \
  "${BASE}/api/threads/${THREAD_ID}/status")

if [ "${CODE_B}" != "404" ]; then
  echo "❌ expected 404 but got ${CODE_B}"
  cat /tmp/b.json
  exit 1
fi

echo "✅ userB blocked with 404 (tenant isolation working)"

echo ""
echo "✅✅✅ tenant isolation threads: PASS ✅✅✅"
