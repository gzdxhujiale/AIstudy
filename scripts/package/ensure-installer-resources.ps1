param(
  [string] $InstallerDir
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
if ([string]::IsNullOrWhiteSpace($InstallerDir)) {
  $InstallerDir = Join-Path $projectRoot "build\installer"
}

$installerFullPath = [System.IO.Path]::GetFullPath($InstallerDir)
$projectFullPath = [System.IO.Path]::GetFullPath($projectRoot)
if (-not $installerFullPath.StartsWith($projectFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Installer resource directory must stay inside project: $installerFullPath"
}

$downloadRoot = Join-Path $projectRoot ".tmp\installer-downloads"
New-Item -ItemType Directory -Force -Path $installerFullPath, $downloadRoot | Out-Null
$env:TEMP = $downloadRoot
$env:TMP = $downloadRoot

$resources = @(
  @{
    Name = "mysql-8.4.7-winx64.zip"
    Url = "https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.7-winx64.zip"
    Sha256 = "FD9BDBD4B5A878D31C8E4067078BD60665B1B3C4677FA1F099416D194B458AFF"
  },
  @{
    Name = "vc_redist.x64.exe"
    Url = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    Sha256 = ""
  }
)

function Test-ResourceHash {
  param(
    [string] $Path,
    [string] $ExpectedSha256
  )

  if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
    return $true
  }

  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
  return $actual.Equals($ExpectedSha256, [System.StringComparison]::OrdinalIgnoreCase)
}

foreach ($resource in $resources) {
  $target = Join-Path $installerFullPath $resource.Name
  if (Test-Path -LiteralPath $target) {
    if (-not (Test-ResourceHash -Path $target -ExpectedSha256 $resource.Sha256)) {
      throw "Installer resource hash mismatch: $target"
    }
    Write-Host ("[AIstudy] Installer resource ready: {0}" -f $resource.Name)
    continue
  }

  $downloadPath = Join-Path $downloadRoot ($resource.Name + ".download")
  if (Test-Path -LiteralPath $downloadPath) {
    Remove-Item -LiteralPath $downloadPath -Force
  }

  Write-Host ("[AIstudy] Downloading installer resource: {0}" -f $resource.Name)
  Invoke-WebRequest -Uri $resource.Url -OutFile $downloadPath -UseBasicParsing

  if (-not (Test-ResourceHash -Path $downloadPath -ExpectedSha256 $resource.Sha256)) {
    Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
    throw "Downloaded installer resource hash mismatch: $($resource.Name)"
  }

  Move-Item -LiteralPath $downloadPath -Destination $target -Force
  Write-Host ("[AIstudy] Installer resource downloaded: {0}" -f $resource.Name)
}
