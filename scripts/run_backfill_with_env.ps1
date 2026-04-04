$envFile = Join-Path $PWD 'horse-racing-app\.env.local'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#\s=]+)\s*=(.*)$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim()
      [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
    }
  }
} else { Write-Error "No .env.local found"; exit 1 }

$uri = "http://localhost:3000/api/admin/backfill-race-results"
try {
  $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ 'Authorization' = "Bearer $env:CRON_SECRET" }
  $resp | ConvertTo-Json -Depth 5
} catch {
  Write-Error "Backfill request failed: $($_.Exception.Message)"
  exit 2
}