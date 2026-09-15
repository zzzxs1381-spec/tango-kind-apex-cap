[CmdletBinding()]
param(
    [switch]$SkipOpenClaw,
    [switch]$SkipHermes,
    [switch]$SkipBlockRunClawRouter,
    [switch]$InstallGatewayService
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
    $env:Path = "$machine;$user"
}

function Has-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-RemotePowerShell([string]$Uri, [string[]]$Arguments = @()) {
    $source = Invoke-RestMethod -Uri $Uri
    $script = [scriptblock]::Create($source)
    & $script @Arguments
}

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

if (-not $SkipBlockRunClawRouter) {
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

Write-Host "`nBootstrap complete." -ForegroundColor Green
Write-Host 'Next: run "openclaw onboard" and "hermes setup" once to add your own provider/channel credentials.'
Write-Host 'Optional BlockRun routing: run "clawrouter setup" yourself. That step may create/import wallet credentials and is intentionally not automated here.'
