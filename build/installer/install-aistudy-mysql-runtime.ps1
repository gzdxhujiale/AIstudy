param(
  [string]$MysqlZipPath = "",
  [string]$VcRedistPath = "",
  [string]$AistudyInstallDir = ""
)

$ErrorActionPreference = "Stop"

if ([Console]::OutputEncoding) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

$serviceName = "AIstudyMySQL"
$mysqlVersionDir = "mysql-8.4.7-winx64"
$installRoot = Join-Path $env:ProgramData "AIstudy\mysql"
$mysqlBaseDir = Join-Path $installRoot $mysqlVersionDir
$mysqlDataDir = Join-Path $installRoot "data"
$mysqlLogDir = Join-Path $installRoot "logs"
$mysqlIniPath = Join-Path $installRoot "my.ini"
$installLogPath = Join-Path $env:ProgramData "AIstudy\install-aistudy-public.log"
$aistudyDataRoot = Join-Path $env:ProgramData "AIstudy\AIstudyPublicData"
$aistudyUserDataRoot = Join-Path $env:ProgramData "AIstudy\AIstudyUserData"

function Write-Step([string]$message) {
  $line = "[AIstudy] $message"
  Write-Host $line
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installLogPath) | Out-Null
  Add-Content -Path $installLogPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $line) -Encoding UTF8
}

function Write-Failure([string]$message) {
  Write-Step ("Failed: " + $message)
  $mysqlErrorLog = Join-Path $mysqlLogDir "mysql-error.log"
  if (Test-Path -Path $mysqlErrorLog) {
    Write-Step "MySQL error log tail:"
    Get-Content -Path $mysqlErrorLog -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object {
      Add-Content -Path $installLogPath -Value $_ -Encoding UTF8
    }
  }
}

function Install-VcRedist {
  if ([string]::IsNullOrWhiteSpace($VcRedistPath) -or -not (Test-Path -Path $VcRedistPath)) {
    Write-Step "VC++ Redistributable package not bundled; continuing."
    return
  }

  Write-Step "Installing Microsoft Visual C++ runtime."
  $process = Start-Process -FilePath $VcRedistPath -ArgumentList "/install", "/quiet", "/norestart" -Wait -PassThru
  if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 3010 -or $process.ExitCode -eq 1638) {
    Write-Step "Microsoft Visual C++ runtime is ready."
    return
  }
  throw "Microsoft Visual C++ runtime installation failed with exit code $($process.ExitCode)."
}

function Test-LocalTcpPort([int]$port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(350)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Find-AistudyMysqlPort {
  if (-not (Test-LocalTcpPort 3306)) {
    return 3306
  }
  for ($port = 3307; $port -le 3316; $port += 1) {
    if (-not (Test-LocalTcpPort $port)) {
      return $port
    }
  }
  throw "No free port found in 3306-3316 for AIstudy MySQL."
}

function ConvertTo-SingleMysqlPort([object]$value, [string]$source) {
  $ports = @()
  foreach ($item in @($value)) {
    if ($null -eq $item) {
      continue
    }
    $text = ([string]$item).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
      continue
    }
    $parsed = 0
    if ([int]::TryParse($text, [ref]$parsed)) {
      $ports += $parsed
    }
  }

  if ($ports.Count -eq 0) {
    throw "Could not parse AIstudy MySQL port from $source."
  }

  $uniquePorts = @($ports | Select-Object -Unique)
  if ($uniquePorts.Count -gt 1) {
    throw ("Multiple AIstudy MySQL ports parsed from {0}: {1}" -f $source, ($uniquePorts -join ", "))
  }

  return [int]$uniquePorts[0]
}

function Get-ConfiguredMysqlPort {
  if (Test-Path -Path $mysqlIniPath) {
    $ports = @()
    $currentSection = ""
    $lineNumber = 0
    foreach ($line in Get-Content -Path $mysqlIniPath -ErrorAction SilentlyContinue) {
      $lineNumber += 1
      $sectionMatch = [regex]::Match($line, "^\s*\[([^\]]+)\]\s*$")
      if ($sectionMatch.Success) {
        $currentSection = $sectionMatch.Groups[1].Value.Trim().ToLowerInvariant()
        continue
      }

      $portMatch = [regex]::Match($line, "^\s*port\s*=\s*(\d+)\s*(?:[#;].*)?$")
      if ($portMatch.Success) {
        $ports += [pscustomobject]@{
          Section = $currentSection
          Port = [int]$portMatch.Groups[1].Value
          Line = $lineNumber
        }
      }
    }

    $mysqldPorts = @($ports | Where-Object { $_.Section -eq "mysqld" })
    if ($mysqldPorts.Count -gt 0) {
      if ($mysqldPorts.Count -gt 1) {
        Write-Step ("Multiple [mysqld] port values found in my.ini; using line {0}." -f $mysqldPorts[0].Line)
      }
      return [int]$mysqldPorts[0].Port
    }

    if ($ports.Count -gt 0) {
      Write-Step ("No [mysqld] port found in my.ini; using first port from section [{0}] line {1}." -f $ports[0].Section, $ports[0].Line)
      return [int]$ports[0].Port
    }
  }
  return 3306
}

function Wait-ForMysql([int]$port) {
  $mysqlAdmin = Join-Path $mysqlBaseDir "bin\mysqladmin.exe"
  for ($attempt = 1; $attempt -le 45; $attempt += 1) {
    try {
      if (Test-Path -Path $mysqlAdmin) {
        & $mysqlAdmin "--protocol=tcp" "-h127.0.0.1" "-P$port" "-uroot" "ping" "--silent" *> $null
        if ($LASTEXITCODE -eq 0) {
          return
        }
      } elseif (Test-LocalTcpPort $port) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }
  throw "AIstudy MySQL service did not start in time."
}

function Remove-AistudyMysqlService {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) {
    return
  }

  Write-Step "Repairing existing AIstudy MySQL service."
  try {
    if ($service.Status -ne "Stopped") {
      Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    }
  } catch {
  }

  $mysqld = Join-Path $mysqlBaseDir "bin\mysqld.exe"
  if (Test-Path -Path $mysqld) {
    & $mysqld "--remove" $serviceName *> $null
  }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    & sc.exe delete $serviceName | Out-Null
  }

  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "AIstudy MySQL service could not be repaired."
}

function Set-AistudyMysqlEnvironment([int]$port) {
  $pairs = @{
    "AISTUDY_PUBLIC_DATA_ROOT" = $aistudyDataRoot
    "AISTUDY_PUBLIC_USER_DATA_ROOT" = $aistudyUserDataRoot
    "AISTUDY_PUBLIC_MYSQL_HOST" = "127.0.0.1"
    "AISTUDY_PUBLIC_MYSQL_PORT" = [string]$port
    "AISTUDY_PUBLIC_MYSQL_USER" = "root"
  }
  foreach ($name in $pairs.Keys) {
    [Environment]::SetEnvironmentVariable($name, $pairs[$name], "Machine")
    [Environment]::SetEnvironmentVariable($name, $pairs[$name], "User")
    Set-Item -Path "Env:$name" -Value $pairs[$name]
  }
  [Environment]::SetEnvironmentVariable("AISTUDY_PUBLIC_MYSQL_PASSWORD", $null, "Machine")
  [Environment]::SetEnvironmentVariable("AISTUDY_PUBLIC_MYSQL_PASSWORD", $null, "User")
  Remove-Item Env:AISTUDY_PUBLIC_MYSQL_PASSWORD -ErrorAction SilentlyContinue
}

function New-AistudyMysqlConfigJson([int]$port) {
  return @{
    host = "127.0.0.1"
    port = $port
    user = "root"
    password = ""
  } | ConvertTo-Json -Depth 3
}

function Write-AistudyMysqlConfigFile([string]$configRoot, [int]$port) {
  if ([string]::IsNullOrWhiteSpace($configRoot)) {
    return
  }
  New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
  $configPath = Join-Path $configRoot "mysql.config.json"
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($configPath, ((New-AistudyMysqlConfigJson $port) + [Environment]::NewLine), $utf8NoBom)
}

function Write-AistudyMysqlConfig([int]$port) {
  Write-AistudyMysqlConfigFile (Join-Path $env:ProgramData "AIstudy") $port
  Write-AistudyMysqlConfigFile (Join-Path $aistudyDataRoot "config") $port
  Write-AistudyMysqlConfigFile $aistudyUserDataRoot $port

  if (-not [string]::IsNullOrWhiteSpace($AistudyInstallDir)) {
    Write-AistudyMysqlConfigFile $AistudyInstallDir $port
    Write-AistudyMysqlConfigFile (Join-Path $AistudyInstallDir "AIstudyPublicData\config") $port
    Write-AistudyMysqlConfigFile (Join-Path $AistudyInstallDir "AIstudyUserData") $port
  }
}

function Publish-AistudyEnvironmentChange {
  $signature = @"
using System;
using System.Runtime.InteropServices;

public static class NativeMethods {
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    int Msg,
    UIntPtr wParam,
    string lParam,
    int fuFlags,
    int uTimeout,
    out UIntPtr lpdwResult);
}
"@
  try {
    Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null
    $result = [UIntPtr]::Zero
    [void][NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, "Environment", 0x2, 5000, [ref]$result)
  } catch {
    Write-Step "Environment broadcast did not complete; settings will still apply after sign-in."
  }
}

function Ensure-AistudyDatabase([int]$port) {
  $mysql = Join-Path $mysqlBaseDir "bin\mysql.exe"
  if (-not (Test-Path -Path $mysql)) {
    return
  }
  & $mysql "--protocol=tcp" "-h127.0.0.1" "-P$port" "-uroot" "-e" "CREATE DATABASE IF NOT EXISTS ``aistudy_public`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "AIstudy database could not be created."
  }
}

function Install-AistudyMysql {
  if ([string]::IsNullOrWhiteSpace($MysqlZipPath) -or -not (Test-Path -Path $MysqlZipPath)) {
    throw "MySQL offline package is missing."
  }

  New-Item -ItemType Directory -Force -Path $installRoot, $mysqlLogDir | Out-Null

  if (-not (Test-Path -Path (Join-Path $mysqlBaseDir "bin\mysqld.exe"))) {
    Write-Step "Extracting MySQL runtime."
    Expand-Archive -Path $MysqlZipPath -DestinationPath $installRoot -Force
  }

  $mysqld = Join-Path $mysqlBaseDir "bin\mysqld.exe"
  if (-not (Test-Path -Path $mysqld)) {
    throw "MySQL runtime is incomplete."
  }

  $port = Find-AistudyMysqlPort
  $mysqlErrorLog = Join-Path $mysqlLogDir "mysql-error.log"
  $ini = @"
[mysqld]
basedir=$($mysqlBaseDir.Replace("\", "/"))
datadir=$($mysqlDataDir.Replace("\", "/"))
port=$port
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
log-error=$($mysqlErrorLog.Replace("\", "/"))

[client]
port=$port
default-character-set=utf8mb4
"@
  Set-Content -Path $mysqlIniPath -Value $ini -Encoding ASCII

  if (-not (Test-Path -Path (Join-Path $mysqlDataDir "mysql"))) {
    Write-Step "Initializing AIstudy MySQL data directory."
    New-Item -ItemType Directory -Force -Path $mysqlDataDir | Out-Null
    & $mysqld "--defaults-file=$mysqlIniPath" "--initialize-insecure" *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "MySQL initialization failed."
    }
  }

  Write-Step "Installing AIstudy MySQL service."
  & $mysqld "--install" $serviceName "--defaults-file=$mysqlIniPath" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "MySQL service installation failed."
  }
  & sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/60000/""/60000 | Out-Null
  Set-Service -Name $serviceName -StartupType Automatic | Out-Null
  Start-Service -Name $serviceName | Out-Null
  Wait-ForMysql $port
  return $port
}

function Ensure-MysqlReady {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($service) {
    $port = ConvertTo-SingleMysqlPort (Get-ConfiguredMysqlPort) "my.ini"
    Write-Step "Found AIstudy MySQL service."
    try {
      if ($service.Status -ne "Running") {
        Start-Service -Name $serviceName | Out-Null
      }
      Wait-ForMysql $port
      return $port
    } catch {
      Write-Step "Existing AIstudy MySQL service could not start; rebuilding it."
      Remove-AistudyMysqlService
      return Install-AistudyMysql
    }
  }

  return Install-AistudyMysql
}

try {
  Write-Step "Preparing AIstudy runtime dependencies."
  Install-VcRedist
  $port = ConvertTo-SingleMysqlPort (Ensure-MysqlReady) "installer runtime"
  Set-AistudyMysqlEnvironment $port
  Write-AistudyMysqlConfig $port
  Ensure-AistudyDatabase $port
  Publish-AistudyEnvironmentChange
  Write-Step "AIstudy MySQL is ready at 127.0.0.1:$port."
} catch {
  Write-Failure $_.Exception.Message
  exit 1
}
