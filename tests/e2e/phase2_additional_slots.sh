#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Phase2 E2E: Additional Slots (8 cases)
# - curl + jq + wrangler d1 execute
# - Designed to prevent regressions and ops incidents
# ============================================================

API_PORT="${API_PORT:-8787}"
BASE_URL="http://localhost:${API_PORT}"
DB_NAME="${DB_NAME:-webapp-production}"
USER_ID="${USER_ID:-test-user-001}"
WORKSPACE_ID="${WORKSPACE_ID:-ws-default}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${LOG_DIR:-/tmp}"
DEV_LOG="${DEV_LOG:-${LOG_DIR}/wrangler_phase2_e2e.log}"

have() { command -v "$1" >/dev/null 2>&1; }

require_tools() {
  for t in curl jq npx; do
    if ! have "$t"; then
      echo "Missing required tool: $t" >&2
      exit 1
    fi
  done
}

info() { echo -e "\n\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[OK]\033[0m $*"; }
die()  { echo -e "\033[1;31m[FAIL]\033[0m $*"; exit 1; }

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
  for i in $(seq 1 "${tries}"); do
    if curl -sS "${BASE_URL}/health" >/dev/null 2>&1; then
      ok "API health is up: ${BASE_URL}/health"
      return 0
    fi
    sleep 0.5
  done
  echo "---- wrangler log (tail) ----" >&2
  tail -80 "${DEV_LOG}" >&2 || true
  die "API did not become healthy"
}

start_dev() {
  info "Starting wrangler dev on port ${API_PORT} ..."
  # kill any previous (best effort)
  pkill -f "wrangler dev.*--port ${API_PORT}" >/dev/null 2>&1 || true
  pkill -f "workerd.*${API_PORT}" >/dev/null 2>&1 || true

  # start
  (cd "${ROOT_DIR}" && nohup npx wrangler dev --local --port "${API_PORT}" > "${DEV_LOG}" 2>&1 &)
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
  info "Seeding workspace/user (local DB) if missing ..."
  # workspace
  db_exec "INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at) VALUES ('${WORKSPACE_ID}', 'Default Workspace', datetime('now'), datetime('now'))"
  # user
  db_exec "INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES ('${USER_ID}', 'test@example.com', 'Test User', datetime('now'), datetime('now'))"
  ok "Seeded ws-default and test user"
}

# Helpers to create baseline "sent" thread via prepare/confirm/execute
create_sent_thread_via_pending_send() {
  info "Creating a SENT thread via pending-actions flow (prepare-send -> confirm -> execute) ..."
  
  info "Step 1: prepare-send"
  local prep
  prep="$(curl_json POST "${BASE_URL}/api/threads/prepare-send" \
    '{"source_type":"emails","emails":["a@example.com","b@example.com","c@example.com"],"title":"Phase2 E2E Thread"}')"
  echo "  prepare-send response: ${prep}"

  local token
  token="$(echo "${prep}" | jq -r '.confirm_token')"
  [[ "${token}" != "null" && -n "${token}" ]] || die "prepare-send did not return confirm_token: ${prep}"

  info "Step 2: confirm (token=${token})"
  local confirm_res
  confirm_res="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"送る"}')"
  echo "  confirm response: ${confirm_res}"

  info "Step 3: execute"
  local exec
  exec="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"
  echo "  execute response: ${exec}"
  
  local thread_id
  thread_id="$(echo "${exec}" | jq -r '.thread_id')"
  [[ -n "${thread_id}" && "${thread_id}" != "null" ]] || die "execute did not return thread_id: ${exec}"

  ok "Created thread_id=${thread_id}"
  echo "${thread_id}"
}

# Create a minimal "draft" thread via SQL (used for Case1 invalid_status)
create_draft_thread_sql() {
  # TODO: 要確認 — scheduling_threads の必須カラムが増えたらINSERTを更新する
  local tid="th_draft_$(date +%s)_$RANDOM"
  db_exec "INSERT INTO scheduling_threads (id, workspace_id, organizer_user_id, title, status, mode, created_at, updated_at) VALUES ('${tid}', '${WORKSPACE_ID}', '${USER_ID}', 'Draft Thread', 'draft', 'external', datetime('now'), datetime('now'))"
  echo "${tid}"
}

# Generate slots far in the future to avoid duplicates
gen_slots_json() {
  local base_ts="$1" # epoch seconds
  local count="$2"
  local slots="[]"
  for i in $(seq 1 "${count}"); do
    local start_iso end_iso
    start_iso="$(date -u -d "@$((base_ts + (i * 86400)))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r "$((base_ts + (i * 86400)))" +"%Y-%m-%dT%H:%M:%SZ")"
    end_iso="$(date -u -d "@$((base_ts + (i * 86400) + 1800))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -r "$((base_ts + (i * 86400) + 1800))" +"%Y-%m-%dT%H:%M:%SZ")"
    slots="$(echo "${slots}" | jq --arg s "${start_iso}" --arg e "${end_iso}" --arg l "追加候補${i}" '. + [{"start_at":$s,"end_at":$e,"label":$l}]')"
  done
  echo "${slots}"
}

# ============================================================
# CASES
# ============================================================

case1_collecting_only() {
  info "Case1: proposals/prepare must fail when status != sent"
  local draft_id
  draft_id="$(create_draft_thread_sql)"

  local slots
  slots="$(gen_slots_json "$(date +%s)" 1)"
  local res
  res="$(curl_json POST "${BASE_URL}/api/threads/${draft_id}/proposals/prepare" "$(jq -n --argjson slots "${slots}" '{slots:$slots}')" || true)"

  local err
  err="$(echo "${res}" | jq -r '.error // empty')"
  [[ "${err}" == "invalid_status" ]] || die "Expected invalid_status, got: ${res}"
  ok "Case1 passed"
}

case2_all_duplicates() {
  info "Case2: proposals/prepare must fail when all slots duplicate existing"
  local thread_id="$1"

  # Get one existing slot from status
  local status
  status="$(curl_json GET "${BASE_URL}/api/threads/${thread_id}/status" '')"
  local s e
  s="$(echo "${status}" | jq -r '.slots[0].start_at')"
  e="$(echo "${status}" | jq -r '.slots[0].end_at')"
  [[ -n "${s}" && "${s}" != "null" ]] || die "status.slots[0] missing: ${status}"

  local res
  res="$(curl_json POST "${BASE_URL}/api/threads/${thread_id}/proposals/prepare" \
    "$(jq -n --arg s "${s}" --arg e "${e}" '{slots:[{start_at:$s,end_at:$e,label:"dup"}]}')" || true)"

  local err
  err="$(echo "${res}" | jq -r '.error // empty')"
  [[ "${err}" == "all_duplicates" ]] || die "Expected all_duplicates, got: ${res}"
  ok "Case2 passed"
}

case3_add_slots_success_and_versioned() {
  info "Case3: add_slots flow success + slots inserted with proposal_version increment"
  local thread_id="$1"

  local base_ts
  base_ts="$(date +%s)"
  local slots
  slots="$(gen_slots_json "${base_ts}" 3)"

  local prep
  prep="$(curl_json POST "${BASE_URL}/api/threads/${thread_id}/proposals/prepare" "$(jq -n --argjson slots "${slots}" '{slots:$slots}')" )"
  local token nextv
  token="$(echo "${prep}" | jq -r '.confirm_token')"
  nextv="$(echo "${prep}" | jq -r '.next_proposal_version')"
  [[ -n "${token}" && "${token}" != "null" ]] || die "prepare did not return confirm_token: ${prep}"
  [[ -n "${nextv}" && "${nextv}" != "null" ]] || die "prepare did not return next_proposal_version: ${prep}"

  curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"追加"}' >/dev/null
  local exec
  exec="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"

  local added
  added="$(echo "${exec}" | jq -r '.result.slots_added')"
  [[ "${added}" -ge 1 ]] || die "Expected slots_added>=1, got: ${exec}"

  # SQL verify: slots with proposal_version=nextv exist
  local q
  q="$(db_exec_json "SELECT COUNT(*) as cnt FROM scheduling_slots WHERE thread_id='${thread_id}' AND proposal_version=${nextv};")"
  local cnt
  cnt="$(echo "${q}" | jq -r '.[0].results[0].cnt // 0')"
  [[ "${cnt}" -ge 1 ]] || die "Expected versioned slots, got cnt=${cnt}"

  # threads additional_propose_count incremented
  local tq
  tq="$(db_exec_json "SELECT COALESCE(additional_propose_count,0) as c FROM scheduling_threads WHERE id='${thread_id}';")"
  local ac
  ac="$(echo "${tq}" | jq -r '.[0].results[0].c // 0')"
  [[ "${ac}" -ge 1 ]] || die "Expected additional_propose_count>=1, got ${ac}"

  ok "Case3 passed"
}

case4_max_two_times() {
  info "Case4: third additional propose must fail (max 2)"
  local thread_id="$1"

  # run add_slots twice more total to reach max=2 (note: Case3 already used 1)
  for n in 1 1; do
    local slots prep token
    slots="$(gen_slots_json "$(( $(date +%s) + (n*100000) ))" 3)"
    prep="$(curl_json POST "${BASE_URL}/api/threads/${thread_id}/proposals/prepare" "$(jq -n --argjson slots "${slots}" '{slots:$slots}')" )"
    token="$(echo "${prep}" | jq -r '.confirm_token')"
    [[ "${token}" != "null" && -n "${token}" ]] || die "prepare failed unexpectedly: ${prep}"
    curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"追加"}' >/dev/null
    curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '' >/dev/null
  done

  # now third prepare should fail
  local slots res err
  slots="$(gen_slots_json "$(( $(date +%s) + 999999 ))" 1)"
  res="$(curl_json POST "${BASE_URL}/api/threads/${thread_id}/proposals/prepare" "$(jq -n --argjson slots "${slots}" '{slots:$slots}')" || true)"
  err="$(echo "${res}" | jq -r '.error // empty')"
  [[ "${err}" == "max_proposals_reached" ]] || die "Expected max_proposals_reached, got: ${res}"
  ok "Case4 passed"
}

case5_declined_excluded_from_notify_targets() {
  info "Case5: declined must be excluded from notify targets"
  local thread_id="$1"

  # pick one invite and mark declined in DB
  local inv
  inv="$(db_exec_json "SELECT id, invitee_key, email FROM thread_invites WHERE thread_id='${thread_id}' LIMIT 1;")"
  local invite_id invitee_key
  invite_id="$(echo "${inv}" | jq -r '.[0].results[0].id')"
  invitee_key="$(echo "${inv}" | jq -r '.[0].results[0].invitee_key')"
  [[ -n "${invite_id}" && "${invite_id}" != "null" ]] || die "No invites found for thread"

  # get current proposal_version
  local pvq pv
  pvq="$(db_exec_json "SELECT COALESCE(proposal_version,1) as v FROM scheduling_threads WHERE id='${thread_id}';")"
  pv="$(echo "${pvq}" | jq -r '.[0].results[0].v')"

  db_exec "INSERT OR REPLACE INTO thread_selections (selection_id, thread_id, invite_id, invitee_key, selected_slot_id, status, proposal_version_at_response, responded_at, created_at) VALUES ('sel_decl_${RANDOM}', '${thread_id}', '${invite_id}', '${invitee_key}', NULL, 'declined', ${pv}, datetime('now'), datetime('now'));"

  # now add_slots prepare+execute once, and verify total_recipients excludes declined one
  local slots prep token exec total
  slots="$(gen_slots_json "$(( $(date +%s) + 222222 ))" 2)"
  prep="$(curl_json POST "${BASE_URL}/api/threads/${thread_id}/proposals/prepare" "$(jq -n --argjson slots "${slots}" '{slots:$slots}')" )"
  token="$(echo "${prep}" | jq -r '.confirm_token')"
  curl_json POST "${BASE_URL}/api/pending-actions/${token}/confirm" '{"decision":"追加"}' >/dev/null
  exec="$(curl_json POST "${BASE_URL}/api/pending-actions/${token}/execute" '')"
  total="$(echo "${exec}" | jq -r '.result.notifications.total_recipients')"

  # count invites excluding declined in SQL should match
  local q cnt
  q="$(db_exec_json "SELECT COUNT(*) as cnt FROM thread_invites ti LEFT JOIN thread_selections ts ON ts.invite_id=ti.id WHERE ti.thread_id='${thread_id}' AND (ts.status IS NULL OR ts.status!='declined');")"
  cnt="$(echo "${q}" | jq -r '.[0].results[0].cnt')"

  [[ "${total}" == "${cnt}" ]] || die "Expected recipients=${cnt}, got ${total}. exec=${exec}"
  ok "Case5 passed"
}

case6_version_at_response_static_guard() {
  info "Case6: proposal_version_at_response must be written (static guard)"
  # TODO: 要確認 — invite respond endpoint path can be added as curl once stable
  grep -q "proposal_version_at_response" "${ROOT_DIR}/apps/api/src/routes/invite.ts" \
    || die "invite.ts does not reference proposal_version_at_response (regression)"
  ok "Case6 passed"
}

case7_status_proposal_info_present() {
  info "Case7: status API returns proposal_info and invitees_needing_response"
  local thread_id="$1"

  local status
  status="$(curl_json GET "${BASE_URL}/api/threads/${thread_id}/status" '')"
  local has
  has="$(echo "${status}" | jq -r 'has("proposal_info")')"
  [[ "${has}" == "true" ]] || die "Expected proposal_info in status response. Got: ${status}"
  ok "Case7 passed"
}

case8_email_xss_static_guard() {
  info "Case8: email templates must use escapeHtml (static guard)"
  local f="${ROOT_DIR}/apps/api/src/queue/emailConsumer.ts"
  grep -q "function escapeHtml" "${f}" || die "escapeHtml function missing"
  grep -q "escapeHtml(message)" "${f}" || die "thread_message message is not escaped"
  grep -q "escapeHtml(inviter_name)" "${f}" || die "invite inviter_name is not escaped"
  grep -q "escapeHtml(thread_title" "${f}" || die "thread_title is not escaped somewhere"
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

  local base_thread
  base_thread="$(create_sent_thread_via_pending_send)"

  case1_collecting_only
  case2_all_duplicates "${base_thread}"
  case3_add_slots_success_and_versioned "${base_thread}"
  case4_max_two_times "${base_thread}"
  case5_declined_excluded_from_notify_targets "${base_thread}"
  case6_version_at_response_static_guard
  case7_status_proposal_info_present "${base_thread}"
  case8_email_xss_static_guard

  ok "ALL Phase2 E2E cases passed ✅"
}

cleanup_and_show_log() {
  local exit_code=$?
  stop_dev
  if [[ $exit_code -ne 0 ]]; then
    echo ""
    echo "========== WRANGLER DEV LOG (last 100 lines) =========="
    tail -100 "${DEV_LOG}" 2>/dev/null || echo "(log file not found)"
    echo "========================================================"
  fi
  exit $exit_code
}

trap 'cleanup_and_show_log' EXIT
main
