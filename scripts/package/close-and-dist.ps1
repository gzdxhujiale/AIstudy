$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$releaseRoot = Join-Path $projectRoot "release"
$releasePrefix = (Join-Path $projectRoot "release-").ToLowerInvariant()
$cacheRoot = Join-Path $projectRoot ".tmp\build-cache"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
try {
  & chcp.com 65001 | Out-Null
} catch {
}

function Remove-BuildArtifact {
  param([string] $Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)
  if (-not $fullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside release: $fullPath"
  }

  if (-not (Test-Path -LiteralPath $fullPath)) {
    return
  }

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 3) {
        throw
      }
      Start-Sleep -Milliseconds 700
    }
  }
}

function Test-IsProjectBuildProcess {
  param([System.Diagnostics.Process] $Process)

  $path = $null
  try {
    $path = $Process.Path
  } catch {
    return $false
  }

  if ([string]::IsNullOrWhiteSpace($path)) {
    return $false
  }

  $normalized = $path.ToLowerInvariant()
  return $normalized.StartsWith((Join-Path $releaseRoot "win-unpacked\AIstudyPublic.exe").ToLowerInvariant()) -or
    $normalized.StartsWith($releasePrefix)
}

Set-Location $projectRoot
$npmCache = Join-Path $cacheRoot "npm"
$electronCache = Join-Path $cacheRoot "electron"
$electronBuilderCache = Join-Path $cacheRoot "electron-builder"
New-Item -ItemType Directory -Force -Path $npmCache, $electronCache, $electronBuilderCache | Out-Null
$env:npm_config_cache = $npmCache
$env:electron_config_cache = $electronCache
$env:ELECTRON_BUILDER_CACHE = $electronBuilderCache

$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$appVersion = [string] $packageJson.version

Write-Host "[AIstudy Public] Closing old packaged app instances..."
$oldProcesses = Get-Process -Name "AIstudyPublic" -ErrorAction SilentlyContinue | Where-Object { Test-IsProjectBuildProcess $_ }

if ($oldProcesses) {
  foreach ($process in $oldProcesses) {
    Write-Host ("[AIstudy Public] Stop PID {0}: {1}" -f $process.Id, $process.Path)
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
      Write-Host ("[AIstudy Public] PID {0} already exited." -f $process.Id)
    }
  }
  Start-Sleep -Milliseconds 800
} else {
  Write-Host "[AIstudy Public] No old packaged app instance found."
}

Write-Host "[AIstudy Public] Cleaning stale packaging artifacts..."
Remove-BuildArtifact (Join-Path $releaseRoot "win-unpacked")
Remove-BuildArtifact (Join-Path $releaseRoot ("aistudy-public-{0}-x64.nsis.7z" -f $appVersion))

Write-Host "[AIstudy Public] Recording update index..."
& npm.cmd run update:record
if ($LASTEXITCODE -ne 0) {
  Write-Host "[AIstudy Public] Update index failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

Write-Host "[AIstudy Public] Building installer..."
& npm.cmd run dist
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  $prepackagedDir = Join-Path $releaseRoot "win-unpacked"
  $prepackagedExe = Join-Path $prepackagedDir "AIstudyPublic.exe"

  if (Test-Path -LiteralPath $prepackagedExe) {
    Write-Host "[AIstudy Public] Standard packaging failed after win-unpacked was created."
    Write-Host "[AIstudy Public] Retrying installer build from prepackaged app..."
    & npx.cmd electron-builder --win nsis --prepackaged $prepackagedDir
    $exitCode = $LASTEXITCODE
  }

  if ($exitCode -ne 0) {
    Write-Host "[AIstudy Public] Packaging failed with exit code $exitCode."
    exit $exitCode
  }
}

Write-Host ("[AIstudy Public] Done: release\AIstudy Public-Setup-{0}.exe" -f $appVersion)
