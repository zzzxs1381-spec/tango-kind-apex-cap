param(
  [Parameter(Mandatory = $true, Position = 0)][string]$PluginDir,
  [Parameter(Mandatory = $true, Position = 1, ValueFromRemainingArguments = $true)][string[]]$Command
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop / docker CLI is required for quarantine execution.'
}

$resolved = (Resolve-Path -LiteralPath $PluginDir).Path
$image = if ($env:XF_SANDBOX_IMAGE) { $env:XF_SANDBOX_IMAGE } else { 'node:22-alpine' }
$memory = if ($env:XF_SANDBOX_MEMORY) { $env:XF_SANDBOX_MEMORY } else { '512m' }
$cpus = if ($env:XF_SANDBOX_CPUS) { $env:XF_SANDBOX_CPUS } else { '1' }
$pids = if ($env:XF_SANDBOX_PIDS) { $env:XF_SANDBOX_PIDS } else { '128' }

$dockerArgs = @(
  'run', '--rm',
  '--network', 'none',
  '--read-only',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--pids-limit', $pids,
  '--memory', $memory,
  '--cpus', $cpus,
  '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
  '--mount', "type=bind,source=$resolved,target=/workspace,readonly",
  '--workdir', '/workspace',
  '--env', 'HOME=/tmp/home',
  '--env', 'CI=1',
  $image
) + $Command

& docker @dockerArgs
exit $LASTEXITCODE
