$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$releaseRoot = Join-Path $projectRoot "release"
$shortcutRefreshScript = Join-Path $scriptDir "refresh-shortcuts.ps1"
$releasePrefix = (Join-Path $projectRoot "release-").ToLowerInvariant()
$cacheRoot = Join-Path $projectRoot ".tmp\build-cache"
$portableDataDirs = @(
  (Join-Path $releaseRoot "win-unpacked\AIstudyPublicData"),
  (Join-Path $releaseRoot "win-unpacked\AIstudyUserData")
)
$preservedDataRoot = Join-Path $projectRoot ".tmp\packaging-preserve"
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
  param([string[]] $RuntimePaths)

  $runtimeFullPaths = @($RuntimePaths | ForEach-Object {
    [System.IO.Path]::GetFullPath($_).ToLowerInvariant()
  })
  $currentProcessId = $PID
  $runtimeProcesses = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = [string] $_.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
      return $false
    }
    if ([int] $_.ProcessId -eq $currentProcessId) {
      return $false
    }
    $normalizedCommandLine = $commandLine.ToLowerInvariant()
    foreach ($runtimeFullPath in $runtimeFullPaths) {
      if ($normalizedCommandLine.Contains($runtimeFullPath)) {
        return $true
      }
    }
    return $false
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
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)
  $tmpRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".tmp"))

  foreach ($portableDataDir in $portableDataDirs) {
    $portableFullPath = [System.IO.Path]::GetFullPath($portableDataDir)
    if (-not $portableFullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to preserve path outside release: $portableFullPath"
    }

    if (-not (Test-Path -LiteralPath $portableFullPath)) {
      continue
    }

    $preservedFullPath = [System.IO.Path]::GetFullPath((Join-Path $preservedDataRoot (Split-Path -Leaf $portableFullPath)))
    if (-not $preservedFullPath.StartsWith($tmpRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to preserve data outside project .tmp: $preservedFullPath"
    }

    if (Test-Path -LiteralPath $preservedFullPath) {
      Remove-Item -LiteralPath $preservedFullPath -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $preservedFullPath) | Out-Null
    Move-Item -LiteralPath $portableFullPath -Destination $preservedFullPath
    Write-Host ("[AIstudy] Preserved portable runtime data: {0}" -f (Split-Path -Leaf $portableFullPath))
  }
}

function Restore-PortableRuntimeData {
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)

  foreach ($portableDataDir in $portableDataDirs) {
    $portableFullPath = [System.IO.Path]::GetFullPath($portableDataDir)
    $preservedFullPath = [System.IO.Path]::GetFullPath((Join-Path $preservedDataRoot (Split-Path -Leaf $portableFullPath)))
    if (-not (Test-Path -LiteralPath $preservedFullPath)) {
      continue
    }

    if (-not $portableFullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to restore path outside release: $portableFullPath"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $portableFullPath) | Out-Null
    if (Test-Path -LiteralPath $portableFullPath) {
      Remove-Item -LiteralPath $portableFullPath -Recurse -Force
    }
    Move-Item -LiteralPath $preservedFullPath -Destination $portableFullPath
    Write-Host ("[AIstudy] Restored portable runtime data: {0}" -f (Split-Path -Leaf $portableFullPath))
  }
}

function Remove-PortableRuntimeDataFromAppOutDir {
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)

  foreach ($portableDataDir in $portableDataDirs) {
    $portableFullPath = [System.IO.Path]::GetFullPath($portableDataDir)
    if (-not $portableFullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove runtime data outside release: $portableFullPath"
    }

    if (-not (Test-Path -LiteralPath $portableFullPath)) {
      continue
    }

    Remove-Item -LiteralPath $portableFullPath -Recurse -Force
    Write-Host ("[AIstudy] Removed runtime data from installer source: {0}" -f (Split-Path -Leaf $portableFullPath))
  }
}

function Assert-CleanInstallerSource {
  param([string] $AppOutDir)

  $appOutFullPath = [System.IO.Path]::GetFullPath($AppOutDir)
  $releaseFullPath = [System.IO.Path]::GetFullPath($releaseRoot)
  if (-not $appOutFullPath.StartsWith($releaseFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to inspect installer source outside release: $appOutFullPath"
  }

  $forbiddenRelativePaths = @(
    "AIstudyPublicData",
    "AIstudyUserData",
    "mysql.config.json"
  )

  $violations = @()
  foreach ($relativePath in $forbiddenRelativePaths) {
    $candidate = Join-Path $appOutFullPath $relativePath
    if (Test-Path -LiteralPath $candidate) {
      $violations += $candidate
    }
  }

  $forbiddenFileNames = @(
    "courses.json",
    "course-pending-operations.json",
    "textbook-pending-scopes.json",
    "textbook-database-backed-scopes.json",
    "chrome-ports.json",
    "bilibili-cookies.txt",
    "mysql.config.json"
  )

  $forbiddenFiles = Get-ChildItem -LiteralPath $appOutFullPath -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $forbiddenFileNames -contains $_.Name
  }
  foreach ($file in $forbiddenFiles) {
    $violations += $file.FullName
  }

  if ($violations.Count -gt 0) {
    $message = "Installer source contains runtime data and must not be packaged:`n" + (($violations | Sort-Object -Unique) -join "`n")
    throw $message
  }

  Write-Host "[AIstudy] Clean installer source guard passed."
}

Set-Location $projectRoot
$npmCache = Join-Path $cacheRoot "npm"
$electronCache = Join-Path $cacheRoot "electron"
$electronBuilderCache = Join-Path $cacheRoot "electron-builder"
New-Item -ItemType Directory -Force -Path $npmCache, $electronCache, $electronBuilderCache | Out-Null
$env:npm_config_cache = $npmCache
$env:electron_config_cache = $electronCache
$env:ELECTRON_BUILDER_CACHE = $electronBuilderCache

$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
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
  Stop-ProjectRuntimeProcesses $portableDataDirs
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

    if ($exitCode -eq 0) {
      $prepackagedDir = Join-Path $releaseRoot "win-unpacked"
      $prepackagedExe = Join-Path $prepackagedDir "AIstudy.exe"

      if (-not (Test-Path -LiteralPath $prepackagedExe)) {
        throw "Cannot rebuild clean installer because prepackaged app is missing: $prepackagedExe"
      }

      Remove-PortableRuntimeDataFromAppOutDir
      Assert-CleanInstallerSource $prepackagedDir
      Write-Host "[AIstudy] Rebuilding installer from cleaned app directory..."
      & npx.cmd electron-builder --win nsis --prepackaged $prepackagedDir
      $exitCode = $LASTEXITCODE
    }
  }
} finally {
  Stop-ProjectRuntimeProcesses $portableDataDirs
  Restore-PortableRuntimeData
}

if ($exitCode -ne 0) {
  Write-Host "[AIstudy] Packaging failed with exit code $exitCode."
  exit $exitCode
}

$runtimeExe = Join-Path $releaseRoot "win-unpacked\AIstudy.exe"
Write-Host "[AIstudy] Refreshing desktop and start-menu shortcuts..."
& $shortcutRefreshScript -RuntimeExe $runtimeExe
if ($LASTEXITCODE -ne 0) {
  Write-Host "[AIstudy] Shortcut refresh failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

Write-Host "[AIstudy] Writing build manifest..."
& node (Join-Path $projectRoot "scripts\package\write-build-manifest.mjs")
if ($LASTEXITCODE -ne 0) {
  Write-Host "[AIstudy] Build manifest failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

Write-Host ("[AIstudy] Done: release\AIstudy-Setup-{0}.exe" -f $appVersion)
