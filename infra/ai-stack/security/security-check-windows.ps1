[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$fail = $false
$warn = $false

Write-Host 'XFreedom Agent Security Check (Windows)' -ForegroundColor Cyan

if (Get-Command openclaw -ErrorAction SilentlyContinue) {
  try {
    $doctor = (& openclaw doctor 2>&1 | Out-String)
    if ($doctor -match 'browser\.extensionRelay\.allowLegacyAuth=true') {
      Write-Host '[FAIL] OpenClaw legacy Browser Relay authentication is enabled.' -ForegroundColor Red
      Write-Host '       Update relay clients to Auth v2, then set allowLegacyAuth=false.' -ForegroundColor Yellow
      $fail = $true
    } else {
      Write-Host '[ OK ] No explicit legacy Browser Relay auth warning detected by doctor.' -ForegroundColor Green
    }
  } catch {
    Write-Warning 'OpenClaw doctor could not be executed.'
    $warn = $true
  }
} else {
  Write-Warning 'openclaw command not found; relay auth could not be checked.'
  $warn = $true
}

try {
  $listeners = Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in @(18789, 8402) }
  foreach ($item in $listeners) {
    if ($item.LocalAddress -in @('127.0.0.1', '::1')) {
      Write-Host "[ OK ] Port $($item.LocalPort) is loopback-bound: $($item.LocalAddress)" -ForegroundColor Green
    } else {
      Write-Host "[WARN] Port $($item.LocalPort) is non-loopback: $($item.LocalAddress)" -ForegroundColor Yellow
      Write-Host '       Confirm it is reachable only through an authenticated private network.' -ForegroundColor Yellow
      $warn = $true
    }
  }
} catch {
  Write-Warning 'TCP listener exposure could not be checked with Get-NetTCPConnection.'
  $warn = $true
}

if ($fail) { exit 2 }
if ($warn) { exit 1 }
exit 0
