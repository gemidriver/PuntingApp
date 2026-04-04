param(
  [string]$RaceId
)

# Usage examples:
# .\check_and_trigger.ps1            <-- runs table verify and (optionally) cron trigger
# .\check_and_trigger.ps1 -RaceId "demo-race-1"   <-- also queries notifications for that race

if (-not $env:NEXT_PUBLIC_SUPABASE_URL) { Write-Error "NEXT_PUBLIC_SUPABASE_URL not set in env"; exit 1 }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { Write-Error "SUPABASE_SERVICE_ROLE_KEY not set in env"; exit 1 }

$supabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/')
$serviceKey = $env:SUPABASE_SERVICE_ROLE_KEY

Write-Host "1) Verifying race_reminders table via PostgREST..."
try {
  $tbl = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/race_reminders?select=*" -Headers @{ "apikey" = $serviceKey; "Authorization" = "Bearer $serviceKey" }
  Write-Host "-> OK: returned" ($tbl.Count) "rows (0 means table exists but empty)."
} catch {
  Write-Error "Verify request failed: $($_.Exception.Message)"
  exit 2
}

# Trigger cron endpoint locally (requires dev server running)
if ($env:CRON_SECRET) {
  Write-Host "\n2) Triggering local /api/race-reminders (http://localhost:3000) ..."
  try {
    $resp = Invoke-RestMethod -Uri "http://localhost:3000/api/race-reminders" -Method Post -Headers @{ "Authorization" = "Bearer $env:CRON_SECRET" }
    Write-Host "-> Trigger response:" (ConvertTo-Json $resp -Depth 3)
  } catch {
    Write-Warning "Local trigger failed (is dev server running?): $($_.Exception.Message)"
  }
} else {
  Write-Warning "CRON_SECRET not found in environment; skipping local trigger."
}

if ($RaceId) {
  Write-Host "\n3) Querying notifications for race_id = $RaceId"
  try {
    $notes = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/notifications?race_id=eq.$RaceId&order=created_at.desc" -Headers @{ "apikey" = $serviceKey; "Authorization" = "Bearer $serviceKey" }
    Write-Host "-> Found" ($notes.Count) "notifications for race" $RaceId
    if ($notes.Count -gt 0) { $notes | ConvertTo-Json -Depth 4 }
  } catch {
    Write-Error "Notifications query failed: $($_.Exception.Message)"
  }

  Write-Host "\n4) Querying race_reminders for race_id = $RaceId"
  try {
    $rem = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/race_reminders?race_id=eq.$RaceId" -Headers @{ "apikey" = $serviceKey; "Authorization" = "Bearer $serviceKey" }
    Write-Host "-> Found" ($rem.Count) "race_reminders rows for race" $RaceId
    if ($rem.Count -gt 0) { $rem | ConvertTo-Json -Depth 4 }
  } catch {
    Write-Error "race_reminders query failed: $($_.Exception.Message)"
  }
}
