#!/bin/bash
# Auth Test Script - Protected routes authentication check
# Usage: ./scripts/test-auth.sh [production|local]

set -e

# Configuration
ENV=${1:-production}

if [ "$ENV" = "production" ]; then
  BASE_URL="https://app.tomoniwao.jp"
elif [ "$ENV" = "local" ]; then
  BASE_URL="http://localhost:3000"
else
  echo "❌ Invalid environment: $ENV (use 'production' or 'local')"
  exit 1
fi

echo "🧪 Testing authentication on $ENV ($BASE_URL)"
echo ""

# Test endpoints
ENDPOINTS=(
  "/api/threads"
  "/api/calendar/today"
  "/api/inbox"
)

PASSED=0
FAILED=0

# Test each endpoint
for endpoint in "${ENDPOINTS[@]}"; do
  echo "Testing: $endpoint"
  
  # Test 1: Unauthenticated request should return 401
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")
  
  if [ "$status" = "401" ]; then
    echo "  ✅ Unauthenticated: 401 (correct)"
    PASSED=$((PASSED + 1))
  else
    echo "  ❌ Unauthenticated: $status (expected 401)"
    FAILED=$((FAILED + 1))
  fi
  
  echo ""
done

# Summary
echo "================================================"
echo "Test Results:"
echo "  ✅ Passed: $PASSED"
echo "  ❌ Failed: $FAILED"
echo "================================================"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "⚠️  Some tests failed. Please check authentication middleware."
  exit 1
else
  echo ""
  echo "🎉 All tests passed!"
  exit 0
fi
