$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$devTemp = Join-Path $projectRoot ".tmp\dev-temp"
$npmCache = Join-Path $projectRoot ".tmp\npm-cache"

New-Item -ItemType Directory -Force -Path $devTemp, $npmCache | Out-Null

$env:TEMP = $devTemp
$env:TMP = $devTemp
$env:NPM_CONFIG_CACHE = $npmCache
$env:ELECTRON_CACHE = Join-Path $projectRoot ".tmp\electron-cache"
$env:ELECTRON_BUILDER_CACHE = Join-Path $projectRoot ".tmp\electron-builder-cache"

Set-Location $projectRoot

Write-Host "[AIstudy] Compiling Electron main/preload for dev..."
& npx tsc -p tsconfig.electron.json
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "[AIstudy] Starting Vite + Electron dev app..."
& npx concurrently -k "vite --host 127.0.0.1" "wait-on tcp:5173 && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron ."
