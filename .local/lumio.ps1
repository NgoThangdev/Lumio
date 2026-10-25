param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('api', 'web', 'funnel')]
  [string]$Service
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
Set-Location -LiteralPath $repo

function Get-TailscaleHostname {
  if (-not (Test-Path -LiteralPath $tailscale)) {
    throw 'Tailscale CLI is not installed at the expected path.'
  }
  $status = & $tailscale status --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $status.BackendState -ne 'Running' -or -not $status.Self.Online) {
    throw 'Tailscale is not online.'
  }
  $hostname = [string]$status.Self.DNSName
  $hostname = $hostname.TrimEnd('.')
  if ($hostname -notmatch '^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$') {
    throw 'Tailscale did not provide a valid DNS hostname.'
  }
  return $hostname
}

function Assert-LocalDatabase {
  $envPath = Join-Path $repo '.env'
  if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Root .env is missing; local Docker database target cannot be verified.'
  }
  $line = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' }) | Select-Object -Last 1
  if (-not $line) {
    throw 'DATABASE_URL is missing from root .env.'
  }
  try {
    $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    $dbUri = [uri]$value
  } catch {
    throw 'DATABASE_URL in root .env could not be parsed.'
  }
  if ($dbUri.Scheme -notin @('postgresql', 'postgres') -or $dbUri.Host -notin @('127.0.0.1', 'localhost')) {
    throw 'DATABASE_URL must target local PostgreSQL on loopback.'
  }

  $containers = @(& docker compose ps --format json | ForEach-Object { $_ | ConvertFrom-Json })
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect local Docker Compose PostgreSQL.'
  }
  $db = @($containers | Where-Object { $_.Service -eq 'db' -and $_.State -eq 'running' -and $_.Health -eq 'healthy' })
  if ($db.Count -ne 1) {
    throw 'Local Docker PostgreSQL is not healthy.'
  }
  $ports = @($db[0].Publishers | Where-Object { $_.URL -eq '127.0.0.1' -and $_.TargetPort -eq 5432 -and $_.Protocol -eq 'tcp' })
  if ($ports.Count -ne 1 -or $dbUri.Port -ne $ports[0].PublishedPort) {
    throw 'DATABASE_URL port does not match the local Docker PostgreSQL port.'
  }
}

function Test-FunnelRouteMap {
  param([object]$RouteMap)
  if ($null -eq $RouteMap) { return $false }
  if ($RouteMap -isnot [pscustomobject]) {
    throw 'Unexpected Funnel route status structure.'
  }
  foreach ($kind in @('Web', 'TCP')) {
    $entry = $RouteMap.PSObject.Properties[$kind]
    if ($null -eq $entry -or $null -eq $entry.Value) { continue }
    if ($entry.Value -isnot [pscustomobject]) {
      throw 'Unexpected Funnel route status structure.'
    }
    if ($entry.Value.PSObject.Properties.Count -gt 0) { return $true }
  }
  return $false
}

function Assert-NoExistingFunnelRoute {
  param([string]$StatusJson)
  try {
    if ([string]::IsNullOrWhiteSpace($StatusJson)) {
      throw 'Empty status.'
    }
    $status = ConvertFrom-Json -InputObject $StatusJson -ErrorAction Stop
    if ($status -isnot [pscustomobject] -or
        -not @($status.PSObject.Properties.Name | Where-Object { $_ -in @('Web', 'TCP', 'Foreground', 'Background') }).Count) {
      throw 'Unexpected status structure.'
    }
    $hasRoute = Test-FunnelRouteMap $status
    foreach ($groupName in @('Foreground', 'Background')) {
      $group = $status.$groupName
      if ($null -eq $group) { continue }
      if ($group -isnot [pscustomobject]) {
        throw 'Unexpected status structure.'
      }
      if (Test-FunnelRouteMap $group) { $hasRoute = $true }
      foreach ($node in $group.PSObject.Properties) {
        if ($node.Name -in @('Web', 'TCP', 'AllowFunnel')) { continue }
        if (Test-FunnelRouteMap $node.Value) { $hasRoute = $true }
      }
    }
  } catch {
    throw 'Could not read or parse Tailscale Funnel status; refusing to start.'
  }
  if ($hasRoute) {
    throw 'A Tailscale Funnel route already exists; refusing to create another.'
  }
}

switch ($Service) {
  'api' {
    $source = Get-Content -LiteralPath (Join-Path $repo 'apps/api/src/main.ts') -Raw
    if ($source -notmatch "process\.env\.NODE_ENV\s*===\s*'production'\s*\?\s*'0\.0\.0\.0'\s*:\s*'127\.0\.0\.1'" -or
        $source -notmatch 'app\.listen\(port,\s*host\)' -or
        $source -notmatch 'process\.env\.PORT\s*\?\?\s*3000') {
      throw 'API source no longer guarantees the local 127.0.0.1 bind; refusing to start.'
    }
    Assert-LocalDatabase
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $env:NODE_ENV = 'development'
    $env:PORT = '3000'
    Write-Host 'Starting Lumio API on 127.0.0.1:3000. Press Ctrl+C to stop.'
    & npm.cmd run start:dev -w @lumio/api
    exit $LASTEXITCODE
  }
  'web' {
    $hostname = Get-TailscaleHostname
    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $hostname
    Write-Host 'Starting Lumio Vite on 127.0.0.1:5174. Press Ctrl+C to stop.'
    & npm.cmd run dev -w @lumio/web -- --host 127.0.0.1 --port 5174 --strictPort
    exit $LASTEXITCODE
  }
  'funnel' {
    $null = Get-TailscaleHostname
    $rawStatus = & $tailscale funnel status --json 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not read Tailscale Funnel status; refusing to start.'
    }
    Assert-NoExistingFunnelRoute ($rawStatus -join [Environment]::NewLine)
    try {
      $web = Invoke-WebRequest -Uri 'http://127.0.0.1:5174/' -UseBasicParsing -TimeoutSec 5
      $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/api/ready' -TimeoutSec 5
      if ($web.StatusCode -ne 200 -or $web.Headers['Content-Type'] -notmatch 'text/html' -or $ready.status -ne 'ok') {
        throw 'Unexpected web or API readiness response.'
      }
    } catch {
      throw 'Local Vite page or proxied API readiness check failed; Funnel was not started.'
    }
    Write-Host 'Starting foreground Tailscale Funnel HTTPS 443 -> 127.0.0.1:5174. Press Ctrl+C to stop.'
    & $tailscale funnel --https=443 http://127.0.0.1:5174
    exit $LASTEXITCODE
  }
}
