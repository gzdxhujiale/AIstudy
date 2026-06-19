$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$releaseRoot = Join-Path $projectRoot "release"
$releasePrefix = (Join-Path $projectRoot "release-").ToLowerInvariant()
$cacheRoot = Join-Path $projectRoot ".tmp\build-cache"
$portableDataDir = Join-Path $releaseRoot "win-unpacked\AIstudyPublicData"
$preservedDataDir = Join-Path $projectRoot ".tmp\packaging-preserve\AIstudyPublicData"
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
  return $normalized.StartsWith((Join-Path $releaseRoot "win-unpacked\AIstudy.exe").ToLowerInvariant()) -or
    $normalized.StartsWith($releasePrefix)
}

function Stop-ProjectRuntimeProcesses {
  param([string] $RuntimePath)

  $runtimeFullPath = [System.IO.Path]::GetFullPath($RuntimePath).ToLowerInvariant()
  $currentProcessId = $PID
  $runtimeProcesses = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = [string] $_.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
      return $false
    }
    if ([int] $_.ProcessId -eq $currentProcessId) {
      return $false
    }
    return $commandLine.ToLowerInvariant().Contains($runtimeFullPath)
  }

  if (-not $runtimeProcesses) {
    return
  }

  foreach ($runtimeProcess in $runtimeProcesses) {
    Write-Host ("[AIstudy] Stop runtime PID {0}: {1}" -f $runtimeProcess.ProcessId, $runtimeProcess.Name)
    try {
      Stop-Process -Id $runtimeProcess.ProcessId -Force -ErrorAction Stop
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
      Write-Host ("[AIstudy] Runtime PID {0} already exited." -f $runtimeProcess.ProcessId)
    }
  }
  Start-Sleep -Milliseconds 800
}

function Save-PortableRuntimeData {
  $portableFullPath = [System.IO.Path]::GetFullPath($portableDataDir)
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)
  if (-not $portableFullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to preserve path outside release: $portableFullPath"
  }

  if (-not (Test-Path -LiteralPath $portableFullPath)) {
    return
  }

  $preservedFullPath = [System.IO.Path]::GetFullPath($preservedDataDir)
  $tmpRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".tmp"))
  if (-not $preservedFullPath.StartsWith($tmpRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to preserve data outside project .tmp: $preservedFullPath"
  }

  if (Test-Path -LiteralPath $preservedFullPath) {
    Remove-Item -LiteralPath $preservedFullPath -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $preservedFullPath) | Out-Null
  Move-Item -LiteralPath $portableFullPath -Destination $preservedFullPath
  Write-Host "[AIstudy] Preserved portable runtime data."
}

function Restore-PortableRuntimeData {
  $preservedFullPath = [System.IO.Path]::GetFullPath($preservedDataDir)
  if (-not (Test-Path -LiteralPath $preservedFullPath)) {
    return
  }

  $portableFullPath = [System.IO.Path]::GetFullPath($portableDataDir)
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)
  if (-not $portableFullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to restore path outside release: $portableFullPath"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $portableFullPath) | Out-Null
  if (Test-Path -LiteralPath $portableFullPath) {
    Remove-Item -LiteralPath $portableFullPath -Recurse -Force
  }
  Move-Item -LiteralPath $preservedFullPath -Destination $portableFullPath
  Write-Host "[AIstudy] Restored portable runtime data."
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

Write-Host "[AIstudy] Closing old packaged app instances..."
$oldProcesses = Get-Process -Name "AIstudy" -ErrorAction SilentlyContinue | Where-Object { Test-IsProjectBuildProcess $_ }

if ($oldProcesses) {
  foreach ($process in $oldProcesses) {
    Write-Host ("[AIstudy] Stop PID {0}: {1}" -f $process.Id, $process.Path)
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
      Write-Host ("[AIstudy] PID {0} already exited." -f $process.Id)
    }
  }
  Start-Sleep -Milliseconds 800
} else {
  Write-Host "[AIstudy] No old packaged app instance found."
}

try {
  Write-Host "[AIstudy] Cleaning stale packaging artifacts..."
  Stop-ProjectRuntimeProcesses $portableDataDir
  Save-PortableRuntimeData
  Remove-BuildArtifact (Join-Path $releaseRoot "win-unpacked")
  Remove-BuildArtifact (Join-Path $releaseRoot ("aistudy-{0}-x64.nsis.7z" -f $appVersion))

  Write-Host "[AIstudy] Recording update index..."
  & npm.cmd run update:record
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[AIstudy] Update index failed with exit code $LASTEXITCODE."
    $exitCode = $LASTEXITCODE
  } else {
    Write-Host "[AIstudy] Building installer..."
    & npm.cmd run dist
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
      $prepackagedDir = Join-Path $releaseRoot "win-unpacked"
      $prepackagedExe = Join-Path $prepackagedDir "AIstudy.exe"

      if (Test-Path -LiteralPath $prepackagedExe) {
        Write-Host "[AIstudy] Standard packaging failed after win-unpacked was created."
        Write-Host "[AIstudy] Retrying installer build from prepackaged app..."
        & npx.cmd electron-builder --win nsis --prepackaged $prepackagedDir
        $exitCode = $LASTEXITCODE
      }
    }
  }
} finally {
  Stop-ProjectRuntimeProcesses $portableDataDir
  Restore-PortableRuntimeData
}

if ($exitCode -ne 0) {
  Write-Host "[AIstudy] Packaging failed with exit code $exitCode."
  exit $exitCode
}

Write-Host ("[AIstudy] Done: release\AIstudy-Setup-{0}.exe" -f $appVersion)
