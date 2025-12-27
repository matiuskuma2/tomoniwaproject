# ============================================================
# OAuth Consent Screen Verification Test Script (PowerShell)
# ============================================================
# Purpose: Automate the verification steps for OAuth review
# Usage: 
#   1. Login via browser: https://webapp.snsrilarc.workers.dev/auth/google/start
#   2. Get token via Console (F12): 
#      fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json()).then(d=>console.log('TOKEN:', d.access_token))
#   3. Set token: $env:TOKEN = "your_access_token_here"
#   4. Run this script: .\scripts\oauth-verification-test.ps1
# ============================================================

$BaseUrl = "https://webapp.snsrilarc.workers.dev"
$Token = $env:TOKEN

Write-Host "============================================================" -ForegroundColor Blue
Write-Host "OAuth Consent Screen Verification Test" -ForegroundColor Blue
Write-Host "============================================================" -ForegroundColor Blue
Write-Host ""

# Check if TOKEN is set
if ([string]::IsNullOrEmpty($Token)) {
    Write-Host "ERROR: TOKEN environment variable is not set" -ForegroundColor Red
    Write-Host "Please follow these steps:"
    Write-Host "1. Login: $BaseUrl/auth/google/start"
    Write-Host "2. Open Console (F12) and run:"
    Write-Host "   fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json()).then(d=>console.log('TOKEN:', d.access_token))"
    Write-Host "3. Set token: `$env:TOKEN = `"your_token_here`""
    Write-Host "4. Run this script again"
    exit 1
}

Write-Host "✓ TOKEN found" -ForegroundColor Green
Write-Host ""

# Step 1: Create thread
Write-Host "Step 1: Creating thread..." -ForegroundColor Blue
$ThreadBody = @{
    title = "OAuth審査用テスト"
    description = "Google Meet生成の動作確認"
} | ConvertTo-Json

$ThreadResponse = Invoke-RestMethod -Uri "$BaseUrl/api/threads" `
    -Method Post `
    -Headers @{
        "Authorization" = "Bearer $Token"
        "Content-Type" = "application/json"
    } `
    -Body $ThreadBody

$ThreadResponse | ConvertTo-Json -Depth 10
$ThreadId = $ThreadResponse.thread.id

if ([string]::IsNullOrEmpty($ThreadId)) {
    Write-Host "ERROR: Failed to create thread" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Thread created: $ThreadId" -ForegroundColor Green
Write-Host ""

# Step 2: Get slot
Write-Host "Step 2: Getting slot information..." -ForegroundColor Blue
Start-Sleep -Seconds 1

$StatusResponse = Invoke-RestMethod -Uri "$BaseUrl/api/threads/$ThreadId/status" `
    -Method Get `
    -Headers @{
        "Authorization" = "Bearer $Token"
    }

$StatusResponse | ConvertTo-Json -Depth 10
$SlotId = $StatusResponse.slots[0].slot_id

if ([string]::IsNullOrEmpty($SlotId)) {
    Write-Host "ERROR: No slots found" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Slot found: $SlotId" -ForegroundColor Green
Write-Host ""

# Step 3: Finalize (Generate Google Meet)
Write-Host "Step 3: Finalizing thread (Generating Google Meet)..." -ForegroundColor Blue
Start-Sleep -Seconds 1

$FinalizeBody = @{
    selected_slot_id = $SlotId
} | ConvertTo-Json

$FinalizeResponse = Invoke-RestMethod -Uri "$BaseUrl/api/threads/$ThreadId/finalize" `
    -Method Post `
    -Headers @{
        "Authorization" = "Bearer $Token"
        "Content-Type" = "application/json"
    } `
    -Body $FinalizeBody

$FinalizeResponse | ConvertTo-Json -Depth 10
$MeetUrl = $FinalizeResponse.meeting.url
$CalendarEventId = $FinalizeResponse.meeting.calendar_event_id
$Provider = $FinalizeResponse.meeting.provider

if ([string]::IsNullOrEmpty($MeetUrl)) {
    Write-Host "ERROR: Google Meet URL not generated" -ForegroundColor Red
    Write-Host "Please check:"
    Write-Host "1. Google account is connected (/auth/google/start)"
    Write-Host "2. calendar.events scope is granted"
    Write-Host "3. Token is not expired"
    exit 1
}

Write-Host "✓ Google Meet generated successfully!" -ForegroundColor Green
Write-Host ""

# Summary
Write-Host "============================================================" -ForegroundColor Blue
Write-Host "✓ Verification Complete" -ForegroundColor Blue
Write-Host "============================================================" -ForegroundColor Blue
Write-Host ""
Write-Host "Thread ID:         $ThreadId"
Write-Host "Slot ID:           $SlotId"
Write-Host "Provider:          $Provider"
Write-Host "Meet URL:          $MeetUrl"
Write-Host "Calendar Event ID: $CalendarEventId"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Green
Write-Host "1. Open Google Calendar: https://calendar.google.com"
Write-Host "2. Find event with ID: $CalendarEventId"
Write-Host "3. Verify:"
Write-Host "   - Meet link is embedded: $MeetUrl"
Write-Host "   - You are listed as attendee (organizer)"
Write-Host "   - Reminders are set: 24h (email) + 1h (popup)"
Write-Host ""
Write-Host "For OAuth review, take screenshots of:" -ForegroundColor Green
Write-Host "1. OAuth consent screen (calendar.events visible)"
Write-Host "2. This script output"
Write-Host "3. Google Calendar event details"
