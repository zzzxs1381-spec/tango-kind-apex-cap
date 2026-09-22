[CmdletBinding()]
param(
    [switch]$SkipOpenClaw,
    [switch]$SkipHermes,
    [switch]$SkipGoose,
    [switch]$SkipOllama,
    [switch]$SkipGooseModel,
    [switch]$SkipGooseLink,
    [switch]$InstallBlockRunClawRouter,
    [switch]$SkipBlockRunClawRouter,
    [switch]$InstallGatewayService,
    [string]$GooseModel = '',
    [string]$OllamaHost = '',
    [string]$GooseWorkspace = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $localBin = Join-Path $HOME '.local\bin'
    $env:Path = "$localBin;$machine;$user"
}

function Has-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-RemotePowerShell([string]$Uri, [string[]]$Arguments = @()) {
    $source = Invoke-RestMethod -Uri $Uri
    $script = [scriptblock]::Create($source)
    & $script @Arguments
}

function Test-OllamaReady([string]$HostUrl) {
    try {
        Invoke-RestMethod -Uri "$($HostUrl.TrimEnd('/'))/api/tags" -TimeoutSec 3 | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

if ([string]::IsNullOrWhiteSpace($GooseModel)) {
    $GooseModel = if ($env:GOOSE_MODEL) { $env:GOOSE_MODEL } else { 'qwen3:8b' }
}
if ([string]::IsNullOrWhiteSpace($OllamaHost)) {
    $OllamaHost = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { 'http://127.0.0.1:11434' }
}
if ([string]::IsNullOrWhiteSpace($GooseWorkspace)) {
    $GooseWorkspace = if ($env:XF_GOOSE_WORKSPACE_ROOT) {
        $env:XF_GOOSE_WORKSPACE_ROOT
    }
    else {
        Join-Path $HOME 'xfreedom-agent-workspace'
    }
}

$env:GOOSE_MODEL = $GooseModel
$env:OLLAMA_HOST = $OllamaHost
$env:XF_GOOSE_WORKSPACE_ROOT = $GooseWorkspace

Write-Host 'XFreedom AI Agent Stack - Windows bootstrap' -ForegroundColor Green
Write-Host 'Installs official runtimes; it never writes provider keys, bot tokens or wallet secrets.'

if (-not $SkipOpenClaw) {
    Write-Step 'OpenClaw'
    if (-not (Has-Command 'openclaw')) {
        $installer = 'https://openclaw.ai/install.ps1'
        $source = Invoke-WebRequest -UseBasicParsing $installer | Select-Object -ExpandProperty Content
        & ([scriptblock]::Create($source)) -NoOnboard
        Refresh-Path
    }

    if (-not (Has-Command 'openclaw')) {
        throw 'OpenClaw install completed but openclaw is not on PATH. Open a new PowerShell window and rerun this script.'
    }

    openclaw --version
}

if (-not $SkipHermes) {
    Write-Step 'Hermes Agent'
    if (-not (Has-Command 'hermes')) {
        $hermesInstaller = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1'
        $source = Invoke-RestMethod -Uri $hermesInstaller
        & ([scriptblock]::Create($source)) -SkipSetup
        Refresh-Path
    }

    if (-not (Has-Command 'hermes')) {
        throw 'Hermes install completed but hermes is not on PATH. Open a new PowerShell window and rerun this script.'
    }

    hermes --help | Select-Object -First 4
}

if (-not $SkipGoose) {
    Write-Step 'Goose local worker'
    if (-not (Has-Command 'goose')) {
        $installerRoot = Join-Path ([IO.Path]::GetTempPath()) "xfreedom-goose-$PID"
        $installerPath = Join-Path $installerRoot 'download_cli.ps1'
        New-Item -ItemType Directory -Path $installerRoot -Force | Out-Null
        Invoke-WebRequest `
            -UseBasicParsing `
            -Uri 'https://github.com/aaif-goose/goose/releases/download/stable/download_cli.ps1' `
            -OutFile $installerPath

        $env:CONFIGURE = 'false'
        Push-Location $installerRoot
        try {
            & $installerPath
        }
        finally {
            Pop-Location
            Remove-Item -Path $installerRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
        Refresh-Path
    }

    if (-not (Has-Command 'goose')) {
        throw 'Goose install completed but goose is not on PATH. Open a new PowerShell window and rerun this script.'
    }
    goose --version
}

if (-not $SkipOllama) {
    Write-Step 'Ollama local inference runtime'
    if (-not (Has-Command 'ollama')) {
        if (-not (Has-Command 'winget')) {
            throw 'winget is required for automatic Ollama installation. Install Ollama manually or rerun with -SkipOllama and a reachable -OllamaHost.'
        }
        winget install --id Ollama.Ollama --exact --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "Ollama winget installation failed with exit code $LASTEXITCODE."
        }
        Refresh-Path
    }

    if (-not (Has-Command 'ollama')) {
        throw 'Ollama install completed but ollama is not on PATH. Open a new PowerShell window and rerun this script.'
    }

    $ollamaUri = [Uri]$OllamaHost
    $isLocalOllama = $ollamaUri.Host -in @('127.0.0.1', 'localhost', '::1')
    if (-not (Test-OllamaReady $OllamaHost) -and $isLocalOllama) {
        Start-Process -FilePath (Get-Command ollama).Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            if (Test-OllamaReady $OllamaHost) { break }
            Start-Sleep -Seconds 1
        }
    }

    if (-not (Test-OllamaReady $OllamaHost)) {
        Write-Warning "Ollama is installed but $OllamaHost is not reachable. Start it before using Goose."
    }
    elseif (-not $SkipGooseModel) {
        ollama pull $GooseModel
        if ($LASTEXITCODE -ne 0) {
            throw "Could not pull Ollama model '$GooseModel'."
        }
    }
}

if (-not $SkipGooseLink) {
    Write-Step 'Goose MCP bridge for OpenClaw and Hermes'
    if (-not (Has-Command 'node') -or -not (Has-Command 'npm')) {
        throw 'Node.js 22+ and npm are required for the Goose MCP bridge.'
    }
    $nodeMajor = [int]((& node -p "Number(process.versions.node.split('.')[0])").Trim())
    if ($nodeMajor -lt 22) {
        throw "Node.js 22+ is required for the Goose MCP bridge; found $(& node --version)."
    }

    $gooseWorkerDir = Join-Path $PSScriptRoot 'goose-worker'
    npm --prefix $gooseWorkerDir ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not install Goose MCP bridge dependencies.'
    }

    & node (Join-Path $gooseWorkerDir 'link.mjs') `
        --target all `
        --workspace $GooseWorkspace `
        --no-probe
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not register the Goose MCP bridge.'
    }
}

if ($InstallBlockRunClawRouter -and -not $SkipBlockRunClawRouter) {
    Write-Step 'Optional BlockRun ClawRouter package'
    if (-not (Has-Command 'npm')) {
        Write-Warning 'npm is not on PATH. OpenClaw normally provisions Node.js; open a new shell and rerun to install ClawRouter.'
    }
    else {
        npm install -g '@blockrun/clawrouter'
        Refresh-Path
        if (Has-Command 'clawrouter') {
            clawrouter --help | Select-Object -First 6
        }
        else {
            Write-Warning 'ClawRouter npm package was installed but its executable is not yet on PATH.'
        }
    }
}

if ($InstallGatewayService -and (Has-Command 'openclaw')) {
    Write-Step 'OpenClaw managed gateway startup'
    $configCandidates = @(
        (Join-Path $HOME '.openclaw\openclaw.json'),
        (Join-Path $HOME '.openclaw\config.json')
    )
    $configured = $configCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($configured) {
        openclaw gateway install
        openclaw gateway status --json
    }
    else {
        Write-Warning 'OpenClaw is not onboarded yet. Run "openclaw onboard" first, then rerun with -InstallGatewayService.'
    }
}

Write-Step 'Final verification'
if (Has-Command 'openclaw') {
    try { openclaw doctor } catch { Write-Warning "openclaw doctor reported: $($_.Exception.Message)" }
}
if (Has-Command 'hermes') {
    try { hermes doctor } catch { Write-Warning "hermes doctor reported: $($_.Exception.Message)" }
}
if (-not $SkipGooseLink) {
    if (Has-Command 'openclaw') {
        try { openclaw mcp doctor xfreedom-goose --probe } catch { Write-Warning 'OpenClaw could not probe the Goose MCP bridge.' }
    }
    if (Has-Command 'hermes') {
        try { hermes mcp test xfreedom_goose } catch { Write-Warning 'Hermes could not probe the Goose MCP bridge.' }
    }
}

Write-Host "`nBootstrap complete." -ForegroundColor Green
Write-Host 'Next: run "openclaw onboard" and "hermes setup" once to add your own provider/channel credentials.'
Write-Host "Goose worker: local Ollama model '$GooseModel', workspace '$GooseWorkspace'."
Write-Host 'Optional BlockRun routing: rerun with -InstallBlockRunClawRouter, then run "clawrouter setup" yourself.'
