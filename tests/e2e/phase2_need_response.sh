#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Phase2 E2E: NeedResponse (再回答が必要な人の判定)
# - 追加候補後に「再回答必要」が正しく判定される
# - declined は再回答必要から除外
# ============================================================

API_PORT="${API_PORT:-8787}"
BASE_URL="http://localhost:${API_PORT}"
DB_NAME="${DB_NAME:-webapp-production}"
USER_ID="${USER_ID:-test-user-001}"
WORKSPACE_ID="${WORKSPACE_ID:-ws-default}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV_LOG="${DEV_LOG:-/tmp/wrangler_need_response_e2e.log}"

have() { command -v "$1" >/dev/null 2>&1; }
die()  { echo -e "\033[1;31m[FAIL]\033[0m $*" >&2; exit 1; }
ok()   { echo -e "\033[1;32m[OK]\033[0m $*" >&2; }
info() { echo -e "\n\033[1;34m[INFO]\033[0m $*" >&2; }

curl_json() {
  local method="$1"; shift
  local url="$1"; shift
  local data="${1:-}"
  if [[ -n "${data}" ]]; then
    curl -sS -X "${method}" "${url}" \
      -H "X-USER-ID: ${USER_ID}" \
      -H "Content-Type: application/json" \
      -d "${data}"
  else
    curl -sS -X "${method}" "${url}" \
      -H "X-USER-ID: ${USER_ID}" \
      -H "Content-Type: application/json"
  fi
}

db_exec() {
  local sql="$1"
  npx wrangler d1 execute "${DB_NAME}" --local --command="${sql}" >/dev/null 2>&1
}

db_exec_json() {
  local sql="$1"
  npx wrangler d1 execute "${DB_NAME}" --local --command="${sql}" --json 2>/dev/null
}

wait_health() {
  for _ in $(seq 1 60); do
    curl -sS "${BASE_URL}/health" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  tail -120 "${DEV_LOG}" >&2 || true
  die "API not healthy"
}

start_dev() {
  info "Starting wrangler dev on port ${API_PORT} ..."
  pkill -f "wrangler dev.*--port ${API_PORT}" >/dev/null 2>&1 || true
  pkill -f "workerd.*${API_PORT}" >/dev/null 2>&1 || true
  (cd "${ROOT_DIR}" && ENVIRONMENT=development nohup npx wrangler dev --local --port "${API_PORT}" > "${DEV_LOG}" 2>&1 &)
  sleep 2
  wait_health
  ok "dev up"
}

stop_dev() {
  info "Stopping wrangler dev ..."
  pkill -f "wrangler dev.*--port ${API_PORT}" >/dev/null 2>&1 || true
  pkill -f "workerd.*${API_PORT}" >/dev/null 2>&1 || true
}

seed() {
  info "Seeding workspace/user (local DB) if missing ..."
  
  # IMPORTANT: Order matters due to foreign key constraints!
  # 1. users first (no FK dependencies)
  # 2. workspaces second (FK: owner_user_id -> users.id)
  
  db_exec "INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES ('${USER_ID}', 'test@example.com', 'Test User', datetime('now'), datetime('now'))"
  db_exec "INSERT OR IGNORE INTO workspaces (id, name, slug, owner_user_id, created_at, updated_at) VALUES ('${WORKSPACE_ID}', 'Default Workspace', 'default', '${USER_ID}', datetime('now'), datetime('now'))"
  
  ok "Seeded"
}

create_sent_thread() {
  local prep token exec tid
  prep="$(curl_json POST "${BASE_URL}/api/threads/prepare-send" \
    '{"source_type":"emails","emails":["p2a@example.com","p2b@example.com","p2c@example.com"],"title":"NeedResponse E2E"}')"
  token="$(echo "${prep}" | jq -r '.confirm_token')"
  [[ -n "${token}" && "${token}" != "null" ]] || die "no token: ${prep}"
  curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}' >/dev/null
  exec="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"
  tid="$(echo "${exec}" | jq -r '.thread_id')"
  [[ -n "${tid}" && "${tid}" != "null" ]] || die "no thread_id: ${exec}"
  echo "${tid}"
}

# ============================================================
# CASES
# ============================================================

case1_need_response_after_add_slots() {
  info "Case1: After add_slots, invitees_needing_response increases"
  local tid="$1"

  # Get initial status
  local st1 need1
  st1="$(curl_json GET "${BASE_URL}/api/threads/${tid}/status" '')"
  need1="$(echo "${st1}" | jq -r '.proposal_info.invitees_needing_response_count // 0')"
  info "Initial need_response_count: ${need1}"

  # Add slots
  local start end prep atoken
  start="$(date -u -d "@$(( $(date +%s) + 90000 ))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r "$(( $(date +%s) + 90000 ))" +"%Y-%m-%dT%H:%M:%SZ")"
  end="$(date -u -d "@$(( $(date +%s) + 90000 + 1800 ))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r "$(( $(date +%s) + 90000 + 1800 ))" +"%Y-%m-%dT%H:%M:%SZ")"
  prep="$(curl_json POST "${BASE_URL}/api/threads/${tid}/proposals/prepare" \
    "$(jq -n --arg s "${start}" --arg e "${end}" '{slots:[{start_at:$s,end_at:$e,label:"nr_case1"}]}')" )"
  atoken="$(echo "${prep}" | jq -r '.confirm_token')"
  [[ -n "${atoken}" && "${atoken}" != "null" ]] || die "no add_slots token: ${prep}"

  curl_json POST "${BASE_URL}/api/pending-actions/${atoken}/confirm" '{"decision":"追加"}' >/dev/null
  curl_json POST "${BASE_URL}/api/pending-actions/${atoken}/execute" '' >/dev/null

  # Get status after add_slots
  local st2 need2
  st2="$(curl_json GET "${BASE_URL}/api/threads/${tid}/status" '')"
  need2="$(echo "${st2}" | jq -r '.proposal_info.invitees_needing_response_count // 0')"
  info "After add_slots need_response_count: ${need2}"

  # All invitees should need response (since no one has responded to v2 yet)
  [[ "${need2}" -ge 1 ]] || die "Expected need_response>=1 after add_slots, got: ${need2}"
  ok "Case1 passed"
}

case2_declined_excluded_from_need_response() {
  info "Case2: Declined invitee excluded from need_response"
  local tid="$1"

  # Mark one invite as declined
  local inv invite_id invitee_key
  inv="$(db_exec_json "SELECT id, invitee_key FROM thread_invites WHERE thread_id='${tid}' LIMIT 1;")"
  invite_id="$(echo "${inv}" | jq -r '.[0].results[0].id')"
  invitee_key="$(echo "${inv}" | jq -r '.[0].results[0].invitee_key')"
  [[ -n "${invite_id}" && "${invite_id}" != "null" ]] || die "No invite found"

  # Get current proposal_version
  local pvq pv
  pvq="$(db_exec_json "SELECT COALESCE(proposal_version,1) as v FROM scheduling_threads WHERE id='${tid}';")"
  pv="$(echo "${pvq}" | jq -r '.[0].results[0].v')"

  db_exec "INSERT OR REPLACE INTO thread_selections (selection_id, thread_id, invite_id, invitee_key, selected_slot_id, status, proposal_version_at_response, responded_at, created_at) VALUES ('sel-declined-nr', '${tid}', '${invite_id}', '${invitee_key}', NULL, 'declined', ${pv}, datetime('now'), datetime('now'));"

  # Get status
  local st need total_invites
  st="$(curl_json GET "${BASE_URL}/api/threads/${tid}/status" '')"
  need="$(echo "${st}" | jq -r '.proposal_info.invitees_needing_response_count // 0')"
  total_invites="$(echo "${st}" | jq -r '.invites | length')"

  # need should be less than total (declined excluded)
  info "Total invites: ${total_invites}, Need response: ${need}"
  [[ "${need}" -lt "${total_invites}" ]] || die "Expected need < total (declined excluded), got need=${need}, total=${total_invites}"
  ok "Case2 passed"
}

case3_proposal_info_structure() {
  info "Case3: proposal_info has required fields"
  local tid="$1"

  local st
  st="$(curl_json GET "${BASE_URL}/api/threads/${tid}/status" '')"

  # Check required fields
  local has_prop has_ver has_count
  has_prop="$(echo "${st}" | jq -r 'has("proposal_info")')"
  has_ver="$(echo "${st}" | jq -r '.proposal_info | has("current_proposal_version")')"
  has_count="$(echo "${st}" | jq -r '.proposal_info | has("invitees_needing_response_count")')"

  [[ "${has_prop}" == "true" ]] || die "Missing proposal_info: ${st}"
  [[ "${has_ver}" == "true" ]] || die "Missing current_proposal_version: ${st}"
  [[ "${has_count}" == "true" ]] || die "Missing invitees_needing_response_count: ${st}"
  ok "Case3 passed"
}

case4_slots_have_proposal_version() {
  info "Case4: All slots have proposal_version field"
  local tid="$1"

  local st slots_count slots_with_version
  st="$(curl_json GET "${BASE_URL}/api/threads/${tid}/status" '')"
  slots_count="$(echo "${st}" | jq -r '.slots | length')"
  slots_with_version="$(echo "${st}" | jq -r '[.slots[] | select(.proposal_version != null)] | length')"

  [[ "${slots_count}" -gt 0 ]] || die "No slots found"
  [[ "${slots_count}" == "${slots_with_version}" ]] || die "Some slots missing proposal_version: count=${slots_count}, with_version=${slots_with_version}"
  ok "Case4 passed"
}

# ============================================================
# MAIN
# ============================================================

main() {
  for t in curl jq npx; do have "$t" || die "missing $t"; done
  info "Root: ${ROOT_DIR}"
  info "Log:  ${DEV_LOG}"

  (cd "${ROOT_DIR}" && npx wrangler d1 migrations apply "${DB_NAME}" --local >/dev/null)
  seed
  start_dev

  info "Creating test thread..."
  local tid
  tid="$(create_sent_thread)"
  ok "thread=${tid}"

  case1_need_response_after_add_slots "${tid}"
  case2_declined_excluded_from_need_response "${tid}"
  case3_proposal_info_structure "${tid}"
  case4_slots_have_proposal_version "${tid}"

  ok "ALL Phase2 NeedResponse E2E cases passed ✅"
}

trap 'stop_dev' EXIT
main
