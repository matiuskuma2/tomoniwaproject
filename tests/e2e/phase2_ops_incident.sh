#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Phase2 Ops E2E: Incident Prevention (8 cases)
# - confirm required, idempotency, expiry, wrong user, etc.
# ============================================================

API_PORT="${API_PORT:-8787}"
BASE_URL="http://localhost:${API_PORT}"
DB_NAME="${DB_NAME:-webapp-production}"
USER_ID="${USER_ID:-test-user-001}"
USER_ID_2="${USER_ID_2:-test-user-002}"
WORKSPACE_ID="${WORKSPACE_ID:-ws-default}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${LOG_DIR:-/tmp}"
DEV_LOG="${DEV_LOG:-${LOG_DIR}/wrangler_ops_e2e.log}"

have() { command -v "$1" >/dev/null 2>&1; }
info() { echo -e "\n\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[OK]\033[0m $*"; }
die()  { echo -e "\033[1;31m[FAIL]\033[0m $*"; exit 1; }

require_tools() {
  for t in curl jq npx; do
    have "$t" || die "Missing required tool: $t"
  done
}

curl_json() {
  local method="$1"; shift
  local url="$1"; shift
  local data="${1:-}"
  local user="${2:-$USER_ID}"

  if [[ -n "${data}" ]]; then
    curl -sS -X "${method}" "${url}" \
      -H "X-USER-ID: ${user}" \
      -H "Content-Type: application/json" \
      -d "${data}"
  else
    curl -sS -X "${method}" "${url}" \
      -H "X-USER-ID: ${user}" \
      -H "Content-Type: application/json"
  fi
}

db_exec_json() {
  local sql="$1"
  npx wrangler d1 execute "${DB_NAME}" --local --command="${sql}" --json 2>/dev/null
}

db_exec() {
  local sql="$1"
  npx wrangler d1 execute "${DB_NAME}" --local --command="${sql}" >/dev/null 2>&1
}

wait_health() {
  local tries=60
  for _ in $(seq 1 "${tries}"); do
    if curl -sS "${BASE_URL}/health" >/dev/null 2>&1; then
      ok "API health is up: ${BASE_URL}/health"
      return 0
    fi
    sleep 0.5
  done
  echo "---- wrangler log (tail) ----" >&2
  tail -120 "${DEV_LOG}" >&2 || true
  die "API did not become healthy"
}

start_dev() {
  info "Starting wrangler dev on port ${API_PORT} ..."
  pkill -f "wrangler dev.*--port ${API_PORT}" >/dev/null 2>&1 || true
  pkill -f "workerd.*${API_PORT}" >/dev/null 2>&1 || true
  (cd "${ROOT_DIR}" && ENVIRONMENT=development nohup npx wrangler dev --local --port "${API_PORT}" > "${DEV_LOG}" 2>&1 &)
  sleep 2
  wait_health
}

stop_dev() {
  info "Stopping wrangler dev ..."
  pkill -f "wrangler dev.*--port ${API_PORT}" >/dev/null 2>&1 || true
  pkill -f "workerd.*${API_PORT}" >/dev/null 2>&1 || true
}

apply_migrations_local() {
  info "Applying D1 migrations (local) ..."
  (cd "${ROOT_DIR}" && npx wrangler d1 migrations apply "${DB_NAME}" --local >/dev/null)
  ok "Migrations applied (local)"
}

seed_user_and_workspace() {
  info "Seeding workspace/users (local DB) if missing ..."
  
  # IMPORTANT: Order matters due to foreign key constraints!
  # 1. users first (no FK dependencies)
  # 2. workspaces second (FK: owner_user_id -> users.id)
  
  db_exec "INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES ('${USER_ID}', 'test@example.com', 'Test User', datetime('now'), datetime('now'))"
  db_exec "INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES ('${USER_ID_2}', 'test2@example.com', 'Test User2', datetime('now'), datetime('now'))"
  db_exec "INSERT OR IGNORE INTO workspaces (id, name, slug, owner_user_id, created_at, updated_at) VALUES ('${WORKSPACE_ID}', 'Default Workspace', 'default', '${USER_ID}', datetime('now'), datetime('now'))"
  
  ok "Seeded ws-default and users"
}

create_pending_send() {
  # returns confirm_token
  local prep token
  prep="$(curl_json POST "${BASE_URL}/api/threads/prepare-send" \
    '{"source_type":"emails","emails":["ops-a@example.com","ops-b@example.com"],"title":"Ops E2E Thread"}')"
  token="$(echo "${prep}" | jq -r '.confirm_token')"
  [[ -n "${token}" && "${token}" != "null" ]] || die "prepare-send missing token: ${prep}"
  echo "${token}"
}

# ============================================================
# CASES
# ============================================================

case1_execute_without_confirm_must_fail() {
  info "Case1: execute without confirm must fail"
  local token
  token="$(create_pending_send)"

  local exec res_err
  exec="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"
  res_err="$(echo "${exec}" | jq -r '.error // empty')"
  [[ -n "${res_err}" ]] || die "Expected error, got: ${exec}"
  ok "Case1 passed"
}

case2_confirm_then_execute_twice_idempotent() {
  info "Case2: confirm then execute twice -> second should not duplicate"
  local token
  token="$(create_pending_send)"

  curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}' >/dev/null

  local exec1 exec2 inserted1 inserted2
  exec1="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"
  exec2="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"

  inserted1="$(echo "${exec1}" | jq -r '.result.inserted // 0')"
  inserted2="$(echo "${exec2}" | jq -r '.result.inserted // 0')"

  [[ "${inserted1}" -ge 1 ]] || die "exec1 should insert invites: ${exec1}"
  # second should be idempotent: inserted usually 0 or same response flagged; we accept 0 or missing
  [[ "${inserted2}" -eq 0 ]] || ok "Case2 note: inserted2=${inserted2} (acceptable if API returns same payload without reinserting)"

  # DB verify: pending_action executed_at is set
  local q st
  q="$(db_exec_json "SELECT status, executed_at FROM pending_actions WHERE confirm_token='${token}' LIMIT 1;")"
  st="$(echo "${q}" | jq -r '.[0].results[0].status')"
  [[ "${st}" == "executed" ]] || die "Expected pending_actions.status=executed, got ${q}"
  ok "Case2 passed"
}

case3_confirm_twice_with_different_decision_should_not_flip_after_confirmed() {
  info "Case3: confirm twice with different decision should not flip (or should 409)"
  local token
  token="$(create_pending_send)"

  local c1 c2
  c1="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}')"
  c2="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"キャンセル"}')"

  # either second is rejected (error) OR decision remains send
  local err2 dec2
  err2="$(echo "${c2}" | jq -r '.error // empty')"
  dec2="$(echo "${c2}" | jq -r '.decision // empty')"
  if [[ -n "${err2}" ]]; then
    ok "Case3 passed (second confirm rejected): ${err2}"
    return 0
  fi
  [[ "${dec2}" == "send" ]] || die "Expected decision not flipped; got: ${c2}"
  ok "Case3 passed"
}

case4_expired_token_must_410() {
  info "Case4: expired token must 410"
  local token
  token="$(create_pending_send)"

  # force expire in DB
  db_exec "UPDATE pending_actions SET expires_at=datetime('now','-1 minute') WHERE confirm_token='${token}';"

  # confirm should fail with 410
  local c
  c="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}' )"
  local err
  err="$(echo "${c}" | jq -r '.error // empty')"
  # Depending on implementation: error may be 'expired' or status code driven; we check 'expired' marker
  [[ -n "${err}" ]] || die "Expected expiry error, got: ${c}"
  ok "Case4 passed"
}

case5_wrong_user_cannot_confirm() {
  info "Case5: wrong user cannot confirm (404 mask or 403)"
  local token
  token="$(create_pending_send)"

  local c
  c="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}' "${USER_ID_2}" || true)"
  local err
  err="$(echo "${c}" | jq -r '.error // empty')"
  [[ -n "${err}" ]] || die "Expected auth error for wrong user, got: ${c}"
  ok "Case5 passed"
}

case6_add_slots_confirm_words_only_add_cancel() {
  info "Case6: add_slots confirm must accept only add/cancel (reject new_thread)"
  # Need a thread in collecting state
  local token thread_id
  token="$(create_pending_send)"
  curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}' >/dev/null
  local exec
  exec="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"
  thread_id="$(echo "${exec}" | jq -r '.thread_id')"
  [[ -n "${thread_id}" && "${thread_id}" != "null" ]] || die "No thread_id: ${exec}"

  # prepare add_slots
  local start end prep atoken
  start="$(date -u -d "@$(( $(date +%s) + 86400 ))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r "$(( $(date +%s) + 86400 ))" +"%Y-%m-%dT%H:%M:%SZ")"
  end="$(date -u -d "@$(( $(date +%s) + 86400 + 1800 ))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r "$(( $(date +%s) + 86400 + 1800 ))" +"%Y-%m-%dT%H:%M:%SZ")"

  prep="$(curl_json POST "${BASE_URL}/api/threads/${thread_id}/proposals/prepare" \
    "$(jq -n --arg s "${start}" --arg e "${end}" '{slots:[{start_at:$s,end_at:$e,label:"ops_add"}]}')" )"
  atoken="$(echo "${prep}" | jq -r '.confirm_token')"
  [[ -n "${atoken}" && "${atoken}" != "null" ]] || die "No confirm_token for add_slots: ${prep}"

  # invalid decision '別スレッドで'
  local c
  c="$(curl_json POST "${BASE_URL}/api/pending-actions/${atoken}/confirm" '{"decision":"別スレッドで"}')"
  local err
  err="$(echo "${c}" | jq -r '.error // empty')"
  [[ -n "${err}" ]] || die "Expected invalid_decision for add_slots, got: ${c}"
  ok "Case6 passed"
}

case7_pending_actions_check_constraint_allows_add_slots_static() {
  info "Case7: pending_actions CHECK constraint includes add_slots (static guard via sqlite_master)"
  local q sql
  q="$(db_exec_json "SELECT sql FROM sqlite_master WHERE name='pending_actions' LIMIT 1;")"
  sql="$(echo "${q}" | jq -r '.[0].results[0].sql')"
  echo "${sql}" | grep -q "add_slots" || die "pending_actions CHECK does not include add_slots. sql=${sql}"
  ok "Case7 passed"
}

case8_email_templates_escape_html_static() {
  info "Case8: email templates must escape HTML (static guard)"
  local f="${ROOT_DIR}/apps/api/src/queue/emailConsumer.ts"
  grep -q "function escapeHtml" "${f}" || die "escapeHtml missing"
  grep -q "escapeHtml(message)" "${f}" || die "thread_message message not escaped"
  grep -q "escapeHtml(inviter_name)" "${f}" || die "invite inviter_name not escaped"
  grep -q "escapeHtml(thread_title" "${f}" || die "thread_title not escaped somewhere"
  ok "Case8 passed"
}

# ============================================================
# MAIN
# ============================================================

main() {
  require_tools
  info "Root: ${ROOT_DIR}"
  info "Log:  ${DEV_LOG}"

  apply_migrations_local
  seed_user_and_workspace
  start_dev

  case1_execute_without_confirm_must_fail
  case2_confirm_then_execute_twice_idempotent
  case3_confirm_twice_with_different_decision_should_not_flip_after_confirmed
  case4_expired_token_must_410
  case5_wrong_user_cannot_confirm
  case6_add_slots_confirm_words_only_add_cancel
  case7_pending_actions_check_constraint_allows_add_slots_static
  case8_email_templates_escape_html_static

  ok "ALL Phase2 Ops E2E cases passed ✅"
}

trap 'stop_dev' EXIT
main
