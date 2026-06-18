$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$cacheRoot = Join-Path $projectRoot ".tmp\build-cache"
$npmCache = Join-Path $cacheRoot "npm"
$electronCache = Join-Path $cacheRoot "electron"
$electronBuilderCache = Join-Path $cacheRoot "electron-builder"

$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
try {
  & chcp.com 65001 | Out-Null
} catch {
}

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path $npmCache, $electronCache, $electronBuilderCache | Out-Null

$env:npm_config_cache = $npmCache
$env:electron_config_cache = $electronCache
$env:ELECTRON_BUILDER_CACHE = $electronBuilderCache

if ([string]::IsNullOrWhiteSpace($env:ELECTRON_MIRROR)) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}

if ([string]::IsNullOrWhiteSpace($env:npm_config_registry)) {
  $env:npm_config_registry = "https://registry.npmmirror.com"
}

Write-Host "[AIstudy Public] Installing dependencies with project-local caches..."
Write-Host "[AIstudy Public] npm cache: $npmCache"
Write-Host "[AIstudy Public] Electron cache: $electronCache"
Write-Host "[AIstudy Public] electron-builder cache: $electronBuilderCache"
Write-Host "[AIstudy Public] Electron mirror: $env:ELECTRON_MIRROR"

& npm.cmd ci --prefer-offline --no-audit --fund=false
if ($LASTEXITCODE -ne 0) {
  Write-Host "[AIstudy Public] Dependency installation failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

& npm.cmd run setup:doctor
exit $LASTEXITCODE
