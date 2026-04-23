# One-off script: resend new race day email to the 5 users who missed it.
# Uses Resend + Supabase directly — no app login required.
# Run from the horse-racing-app folder: .\scripts\resend_new_day_email.ps1

# ── Load .env.local ────────────────────────────────────────────────────────────
$envFile = Join-Path $PSScriptRoot '..\.env.local'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#\s=]+)\s*=(.*)$') {
      $k = $matches[1].Trim(); $v = $matches[2].Trim()
      [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
    }
  }
} else {
  Write-Warning ".env.local not found at $envFile — env vars must already be set."
}

$supabaseUrl   = ($env:NEXT_PUBLIC_SUPABASE_URL -replace '/$', '')
$serviceKey    = $env:SUPABASE_SERVICE_ROLE_KEY
$resendApiKey  = $env:RESEND_API_KEY
$fromEmail     = $env:RESEND_FROM_EMAIL

if (-not $supabaseUrl -or -not $serviceKey) { Write-Error "Missing Supabase env vars."; exit 1 }
if (-not $resendApiKey -or -not $fromEmail) { Write-Error "Missing Resend env vars."; exit 1 }

$authHeaders = @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey" }

# ── Fetch global meets from Supabase ──────────────────────────────────────────
Write-Host "Fetching global meets..."
$settingsResp = Invoke-RestMethod `
  -Uri "$supabaseUrl/rest/v1/app_settings?key=eq.global_meets&select=value" `
  -Headers $authHeaders

$meets = $settingsResp[0].value
if (-not $meets -or $meets.Count -eq 0) { Write-Error "No global meets found in app_settings."; exit 1 }

$meetDate = $meets[0].date
$meetListHtml = ($meets | ForEach-Object {
  $course   = [System.Web.HttpUtility]::HtmlEncode($_.course)
  $raceType = if ($_.raceType -eq 'Harness') { 'Harness' } else { 'Thoroughbred' }
  $date     = [System.Web.HttpUtility]::HtmlEncode($_.date)
  "<li><strong>$course</strong> ($raceType) - $date</li>"
}) -join ''

# ── Build email HTML ──────────────────────────────────────────────────────────
$html = @"
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 680px; margin: 0 auto; color: #0f172a;">
  <h2 style="margin-bottom: 8px;">New Race Day Is Live</h2>
  <p style="margin-top: 0; color: #475569;">A new set of race meets has been published for today.</p>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Race Meets</h3>
  <ul style="padding-left: 20px; margin-top: 0;">$meetListHtml</ul>
  <p style="margin-top: 18px; margin-bottom: 0;">
    <a href="https://thetoppunter.com" style="color: #2563eb; text-decoration: none;">Open The Top Punter</a>
  </p>
  <p style="margin-top: 20px; color: #64748b; font-size: 12px;">Sent from The Top Punter admin panel.</p>
</div>
"@

$subject = "New Race Day Meets - $meetDate"

# ── Target recipients ─────────────────────────────────────────────────────────
$missingEmails = @(
  'nickbell2287@hotmail.com'
  'fieldo241@hotmail.com'
  'daniellefielding12@gmail.com'
  'tujnuv@gmail.com'
  'duck231287@gmail.com'
)

# ── Send via Resend ───────────────────────────────────────────────────────────
Add-Type -AssemblyName System.Web

$sent = 0; $failed = 0
foreach ($email in $missingEmails) {
  $payload = @{ from = $fromEmail; to = $email; subject = $subject; html = $html } | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod `
      -Uri 'https://api.resend.com/emails' `
      -Method Post `
      -ContentType 'application/json' `
      -Headers @{ Authorization = "Bearer $resendApiKey" } `
      -Body $payload
    Write-Host "  Sent -> $email (id: $($r.id))"
    $sent++
  } catch {
    $raw = $_.ErrorDetails?.Message
    Write-Warning "  Failed -> $email : $raw"
    $failed++
  }
}

Write-Host ""
Write-Host "Done. Sent: $sent  Failed: $failed"
