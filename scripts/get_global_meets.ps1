$envFile = Join-Path $PSScriptRoot '..\.env.local'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#\s=]+)\s*=(.*)$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim()
      [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
    }
  }
} else {
  Write-Error "No .env.local found at $envFile"
  exit 1
}

$supabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/')
$serviceKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $supabaseUrl -or -not $serviceKey) { Write-Error "Missing supabase env vars"; exit 2 }

$uri = "$supabaseUrl/rest/v1/app_settings?select=key,value&key=eq.global_meets"
try {
  $resp = Invoke-RestMethod -Uri $uri -Headers @{ "apikey" = $serviceKey; "Authorization" = "Bearer $serviceKey" }
  $resp | ConvertTo-Json -Depth 5
} catch {
  Write-Error "Request failed: $($_.Exception.Message)"
  exit 3
}