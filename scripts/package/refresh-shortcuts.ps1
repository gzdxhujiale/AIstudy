param(
  [string] $RuntimeExe = "",
  [switch] $VerifyOnly
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$defaultRuntimeExe = Join-Path $projectRoot "release\win-unpacked\AIstudy.exe"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
try {
  & chcp.com 65001 | Out-Null
} catch {
}

if ([string]::IsNullOrWhiteSpace($RuntimeExe)) {
  $RuntimeExe = $defaultRuntimeExe
}

$runtimeExeFullPath = [System.IO.Path]::GetFullPath($RuntimeExe)
if (-not (Test-Path -LiteralPath $runtimeExeFullPath)) {
  throw "AIstudy runtime exe is missing: $runtimeExeFullPath"
}

$runtimeDir = Split-Path -Parent $runtimeExeFullPath
$projectRootFullPath = [System.IO.Path]::GetFullPath($projectRoot)
$publicEditionName = -join @([char]0x516C, [char]0x5F00, [char]0x7248)
$canonicalShortcutName = "AIstudy$publicEditionName.lnk"

function Get-OptionalFolderPath {
  param([string] $Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $null
  }
  return $Path
}

function Get-KnownShortcutFolders {
  $folders = New-Object System.Collections.Generic.List[object]
  $userDesktop = [Environment]::GetFolderPath("Desktop")
  $commonDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
  $userPrograms = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $commonPrograms = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"
  $taskbarPinned = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

  $folders.Add([pscustomobject]@{ Kind = "desktop"; Path = (Get-OptionalFolderPath $userDesktop); CreateCanonical = $true }) | Out-Null
  $folders.Add([pscustomobject]@{ Kind = "common-desktop"; Path = (Get-OptionalFolderPath $commonDesktop); CreateCanonical = $false }) | Out-Null
  $folders.Add([pscustomobject]@{ Kind = "start-menu"; Path = (Get-OptionalFolderPath $userPrograms); CreateCanonical = $true }) | Out-Null
  $folders.Add([pscustomobject]@{ Kind = "common-start-menu"; Path = (Get-OptionalFolderPath $commonPrograms); CreateCanonical = $false }) | Out-Null
  $folders.Add([pscustomobject]@{ Kind = "taskbar"; Path = (Get-OptionalFolderPath $taskbarPinned); CreateCanonical = $false }) | Out-Null

  return $folders | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Path) }
}

function New-ShortcutShell {
  return New-Object -ComObject WScript.Shell
}

function Read-ShortcutInfo {
  param(
    [__ComObject] $Shell,
    [string] $Path
  )

  try {
    $shortcut = $Shell.CreateShortcut($Path)
    return [pscustomobject]@{
      Path = $Path
      Name = [System.IO.Path]::GetFileName($Path)
      TargetPath = [string] $shortcut.TargetPath
      WorkingDirectory = [string] $shortcut.WorkingDirectory
      Arguments = [string] $shortcut.Arguments
      IconLocation = [string] $shortcut.IconLocation
    }
  } catch {
    Write-Host ("[AIstudy] Skip unreadable shortcut: {0}" -f $Path)
    return $null
  }
}

function Test-IsProjectAIstudyShortcut {
  param([object] $ShortcutInfo)

  if ($null -eq $ShortcutInfo) {
    return $false
  }

  if ($ShortcutInfo.Name -eq $canonicalShortcutName) {
    return $true
  }

  if ([string]::IsNullOrWhiteSpace($ShortcutInfo.TargetPath)) {
    return $false
  }

  $targetName = [System.IO.Path]::GetFileName($ShortcutInfo.TargetPath)
  if (-not $targetName.Equals("AIstudy.exe", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }

  $targetFullPath = [System.IO.Path]::GetFullPath($ShortcutInfo.TargetPath)
  return $targetFullPath.StartsWith($projectRootFullPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Set-AIstudyShortcut {
  param(
    [__ComObject] $Shell,
    [string] $ShortcutPath
  )

  if ($VerifyOnly) {
    return
  }

  $parent = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  $shortcut = $Shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $runtimeExeFullPath
  $shortcut.Arguments = ""
  $shortcut.WorkingDirectory = $runtimeDir
  $shortcut.IconLocation = "$runtimeExeFullPath,0"
  $shortcut.Description = "AIstudy Public"
  $shortcut.WindowStyle = 1
  $shortcut.Save()
  Write-Host ("[AIstudy] Shortcut refreshed: {0}" -f $ShortcutPath)
}

function Assert-ShortcutTarget {
  param(
    [__ComObject] $Shell,
    [string] $ShortcutPath
  )

  if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    throw "Shortcut was not created: $ShortcutPath"
  }

  $info = Read-ShortcutInfo $Shell $ShortcutPath
  if ($null -eq $info) {
    throw "Shortcut cannot be read: $ShortcutPath"
  }

  $targetFullPath = [System.IO.Path]::GetFullPath($info.TargetPath)
  if (-not $targetFullPath.Equals($runtimeExeFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Shortcut target mismatch: $ShortcutPath -> $($info.TargetPath), expected $runtimeExeFullPath"
  }

  $workDirFullPath = [System.IO.Path]::GetFullPath($info.WorkingDirectory)
  if (-not $workDirFullPath.Equals($runtimeDir, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Shortcut working directory mismatch: $ShortcutPath -> $($info.WorkingDirectory), expected $runtimeDir"
  }
}

$shell = New-ShortcutShell
$folders = Get-KnownShortcutFolders
$touched = New-Object System.Collections.Generic.HashSet[string]

foreach ($folder in $folders) {
  if (-not (Test-Path -LiteralPath $folder.Path)) {
    if ($folder.CreateCanonical -and -not $VerifyOnly) {
      New-Item -ItemType Directory -Force -Path $folder.Path | Out-Null
    } else {
      continue
    }
  }

  if ($folder.CreateCanonical) {
    $canonicalPath = Join-Path $folder.Path $canonicalShortcutName
    try {
      Set-AIstudyShortcut $shell $canonicalPath
      $touched.Add(([System.IO.Path]::GetFullPath($canonicalPath)).ToLowerInvariant()) | Out-Null
    } catch {
      Write-Host ("[AIstudy] Unable to refresh canonical shortcut {0}: {1}" -f $canonicalPath, $_.Exception.Message)
      if ($folder.Kind -eq "desktop") {
        throw
      }
    }
  }

  Get-ChildItem -LiteralPath $folder.Path -Filter "AIstudy*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    $shortcutPath = [System.IO.Path]::GetFullPath($_.FullName)
    $shortcutKey = $shortcutPath.ToLowerInvariant()
    if ($touched.Contains($shortcutKey)) {
      return
    }

    $info = Read-ShortcutInfo $shell $shortcutPath
    if (-not (Test-IsProjectAIstudyShortcut $info)) {
      return
    }

    try {
      Set-AIstudyShortcut $shell $shortcutPath
      $touched.Add($shortcutKey) | Out-Null
    } catch {
      Write-Host ("[AIstudy] Unable to refresh shortcut {0}: {1}" -f $shortcutPath, $_.Exception.Message)
    }
  }
}

$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) $canonicalShortcutName
$startMenuShortcut = Join-Path (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs") $canonicalShortcutName
Assert-ShortcutTarget $shell $desktopShortcut
Assert-ShortcutTarget $shell $startMenuShortcut

Write-Host "[AIstudy] Shortcut verification passed."
