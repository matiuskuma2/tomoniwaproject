#!/bin/bash
# ============================================================
# OAuth Consent Screen Verification Test Script
# ============================================================
# Purpose: Automate the verification steps for OAuth review
# Usage: 
#   1. Login via browser: https://webapp.snsrilarc.workers.dev/auth/google/start
#   2. Get token via Console: fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json())
#   3. Export token: export TOKEN="your_access_token_here"
#   4. Run this script: bash scripts/oauth-verification-test.sh
# ============================================================

set -e

BASE_URL="https://webapp.snsrilarc.workers.dev"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}OAuth Consent Screen Verification Test${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

# Check if TOKEN is set
if [ -z "$TOKEN" ]; then
  echo -e "${RED}ERROR: TOKEN environment variable is not set${NC}"
  echo "Please follow these steps:"
  echo "1. Login: ${BASE_URL}/auth/google/start"
  echo "2. Open Console (F12) and run:"
  echo "   fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json()).then(d=>console.log('TOKEN:', d.access_token))"
  echo "3. Export token: export TOKEN=\"your_token_here\""
  echo "4. Run this script again"
  exit 1
fi

echo -e "${GREEN}✓ TOKEN found${NC}"
echo ""

# Step 1: Create thread
echo -e "${BLUE}Step 1: Creating thread...${NC}"
THREAD_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/threads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"OAuth審査用テスト","description":"Google Meet生成の動作確認"}')

echo "$THREAD_RESPONSE" | jq '.'
THREAD_ID=$(echo "$THREAD_RESPONSE" | jq -r '.thread.id')

if [ "$THREAD_ID" == "null" ] || [ -z "$THREAD_ID" ]; then
  echo -e "${RED}ERROR: Failed to create thread${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Thread created: $THREAD_ID${NC}"
echo ""

# Step 2: Get slot
echo -e "${BLUE}Step 2: Getting slot information...${NC}"
sleep 1
STATUS_RESPONSE=$(curl -s "${BASE_URL}/api/threads/${THREAD_ID}/status" \
  -H "Authorization: Bearer $TOKEN")

echo "$STATUS_RESPONSE" | jq '.'
SLOT_ID=$(echo "$STATUS_RESPONSE" | jq -r '.slots[0].slot_id')

if [ "$SLOT_ID" == "null" ] || [ -z "$SLOT_ID" ]; then
  echo -e "${RED}ERROR: No slots found${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Slot found: $SLOT_ID${NC}"
echo ""

# Step 3: Finalize (Generate Google Meet)
echo -e "${BLUE}Step 3: Finalizing thread (Generating Google Meet)...${NC}"
sleep 1
FINALIZE_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/threads/${THREAD_ID}/finalize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"selected_slot_id\":\"${SLOT_ID}\"}")

echo "$FINALIZE_RESPONSE" | jq '.'
MEET_URL=$(echo "$FINALIZE_RESPONSE" | jq -r '.meeting.url')
CALENDAR_EVENT_ID=$(echo "$FINALIZE_RESPONSE" | jq -r '.meeting.calendar_event_id')
PROVIDER=$(echo "$FINALIZE_RESPONSE" | jq -r '.meeting.provider')

if [ "$MEET_URL" == "null" ] || [ -z "$MEET_URL" ]; then
  echo -e "${RED}ERROR: Google Meet URL not generated${NC}"
  echo "Please check:"
  echo "1. Google account is connected (/auth/google/start)"
  echo "2. calendar.events scope is granted"
  echo "3. Token is not expired"
  exit 1
fi

echo -e "${GREEN}✓ Google Meet generated successfully!${NC}"
echo ""

# Summary
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}✓ Verification Complete${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""
echo "Thread ID:         $THREAD_ID"
echo "Slot ID:           $SLOT_ID"
echo "Provider:          $PROVIDER"
echo "Meet URL:          $MEET_URL"
echo "Calendar Event ID: $CALENDAR_EVENT_ID"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Open Google Calendar: https://calendar.google.com"
echo "2. Find event with ID: $CALENDAR_EVENT_ID"
echo "3. Verify:"
echo "   - Meet link is embedded: $MEET_URL"
echo "   - You are listed as attendee (organizer)"
echo "   - Reminders are set: 24h (email) + 1h (popup)"
echo ""
echo -e "${GREEN}For OAuth review, take screenshots of:${NC}"
echo "1. OAuth consent screen (calendar.events visible)"
echo "2. This script output"
echo "3. Google Calendar event details"
