[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$gooseModel = if ($env:GOOSE_MODEL) { $env:GOOSE_MODEL } else { 'qwen3:8b' }
$ollamaHost = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { 'http://127.0.0.1:11434' }
$failCount = 0

function Test-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        Write-Host "[FAIL] $Name not found" -ForegroundColor Red
        $script:failCount++
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
$gooseOk = Test-Command 'goose'
$ollamaOk = Test-Command 'ollama'
$routerOk = $null -ne (Get-Command clawrouter -ErrorAction SilentlyContinue)

if ($openclawOk) {
    try { openclaw --version } catch { Write-Warning $_ }
    try { openclaw gateway status --json } catch { Write-Warning 'OpenClaw gateway is not configured/running yet.' }
}

if ($hermesOk) {
    try { hermes doctor } catch { Write-Warning 'Hermes doctor reported an issue or setup is incomplete.' }
}

if ($nodeOk) { node --version }
if ($npmOk) { npm --version }
if ($gooseOk) { goose --version }

if ($ollamaOk) {
    try {
        $models = & ollama list 2>$null | Out-String
        if ($LASTEXITCODE -ne 0) { throw "ollama list exited with $LASTEXITCODE" }
        if ($models -match "(?m)^$([regex]::Escape($gooseModel))\s") {
            Write-Host "[ OK ] Ollama model $gooseModel is available" -ForegroundColor Green
        }
        else {
            Write-Host "[FAIL] Ollama model $gooseModel is not installed" -ForegroundColor Red
            $failCount++
        }
    }
    catch {
        Write-Host "[FAIL] Ollama endpoint $ollamaHost is unreachable" -ForegroundColor Red
        $failCount++
    }
}

if ($routerOk) {
    Write-Host '[INFO] BlockRun ClawRouter CLI is installed. Wallet/login state is intentionally not printed.' -ForegroundColor Yellow
}

if ($openclawOk) {
    try {
        openclaw mcp doctor xfreedom-goose --probe
        if ($LASTEXITCODE -ne 0) { throw "probe exited with $LASTEXITCODE" }
    }
    catch {
        Write-Host '[FAIL] OpenClaw could not probe the Goose MCP bridge.' -ForegroundColor Red
        $failCount++
    }
}
if ($hermesOk) {
    try {
        hermes mcp test xfreedom_goose
        if ($LASTEXITCODE -ne 0) { throw "probe exited with $LASTEXITCODE" }
    }
    catch {
        Write-Host '[FAIL] Hermes could not probe the Goose MCP bridge.' -ForegroundColor Red
        $failCount++
    }
}

$portChecks = @(
    @{ Name = 'OpenClaw Gateway'; Port = 18789 },
    @{ Name = 'ClawRouter proxy'; Port = 8402 }
)
$ollamaUri = [Uri]$ollamaHost
if ($ollamaUri.Host -in @('127.0.0.1', 'localhost', '::1') -and $ollamaUri.Port -eq 11434) {
    $portChecks += @{ Name = 'Ollama API'; Port = 11434 }
}
else {
    Write-Host "[INFO] Ollama endpoint configured as $ollamaHost" -ForegroundColor Cyan
}

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

if ($failCount -gt 0) { exit 1 }
