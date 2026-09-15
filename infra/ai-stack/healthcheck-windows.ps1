[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

function Test-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        Write-Host "[FAIL] $Name not found" -ForegroundColor Red
        return $false
    }
    Write-Host "[ OK ] $Name -> $($cmd.Source)" -ForegroundColor Green
    return $true
}

Write-Host 'XFreedom AI Agent Stack health check' -ForegroundColor Cyan

$openclawOk = Test-Command 'openclaw'
$hermesOk = Test-Command 'hermes'
$nodeOk = Test-Command 'node'
$npmOk = Test-Command 'npm'
$routerOk = Test-Command 'clawrouter'

if ($openclawOk) {
    try { openclaw --version } catch { Write-Warning $_ }
    try { openclaw gateway status --json } catch { Write-Warning 'OpenClaw gateway is not configured/running yet.' }
}

if ($hermesOk) {
    try { hermes doctor } catch { Write-Warning 'Hermes doctor reported an issue or setup is incomplete.' }
}

if ($nodeOk) { node --version }
if ($npmOk) { npm --version }

if ($routerOk) {
    Write-Host '[INFO] BlockRun ClawRouter CLI is installed. Wallet/login state is intentionally not printed.' -ForegroundColor Yellow
}

$portChecks = @(
    @{ Name = 'OpenClaw Gateway'; Port = 18789 },
    @{ Name = 'ClawRouter proxy'; Port = 8402 }
)

foreach ($item in $portChecks) {
    try {
        $r = Test-NetConnection -ComputerName '127.0.0.1' -Port $item.Port -WarningAction SilentlyContinue
        if ($r.TcpTestSucceeded) {
            Write-Host "[LISTEN] $($item.Name) on 127.0.0.1:$($item.Port)" -ForegroundColor Green
        }
        else {
            Write-Host "[DOWN ] $($item.Name) on 127.0.0.1:$($item.Port)" -ForegroundColor DarkYellow
        }
    }
    catch {
        Write-Warning "Could not probe $($item.Name): $($_.Exception.Message)"
    }
}
