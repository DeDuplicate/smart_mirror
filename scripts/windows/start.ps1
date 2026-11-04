# Smart Mirror on Windows: starts the backend and the frontend (each one is relaunched if it ever
# exits, the way systemd does on the Pi) and then the fullscreen kiosk browser.
# Runs at logon through the "SmartMirror" scheduled task that install.ps1 creates.
# ASCII only and Windows PowerShell 5.1 safe, like the rest of scripts\windows.
#
#   start.ps1                    start everything (what the scheduled task runs)
#   start.ps1 -Service backend   internal: keep the backend running (also: frontend)
#
# Test overrides: SM_FRONTEND_PORT, SM_BACKEND_PORT, SM_NO_KIOSK=1 (servers only, no browser).
param([string]$Service = '')

$ErrorActionPreference = 'Continue'
# winget installs (Node, FFmpeg, yt-dlp) change PATH in the registry; a task started at logon may
# still hold the old one, so read it fresh.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$FrontendPort = if ($env:SM_FRONTEND_PORT) { [int]$env:SM_FRONTEND_PORT } else { 3000 }
$BackendPort = if ($env:SM_BACKEND_PORT) { [int]$env:SM_BACKEND_PORT } else { 3001 }
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

function Write-Log([string]$Name, [string]$Message) {
  Add-Content -Path (Join-Path $LogDir "$Name.log") -Value ("[{0}] {1}" -f (Get-Date -Format 's'), $Message)
}

# ---------------------------------------------------------------------------------------------
# Service mode: run one server forever. The output goes to logs\<service>.log; the log is rotated
# when it passes 5 MB so a kiosk left running for years does not fill the disk.
# ---------------------------------------------------------------------------------------------
if ($Service) {
  $env:NODE_ENV = 'production'
  $env:PORT = "$BackendPort"
  $env:BACKEND_URL = "http://localhost:$BackendPort"
  # Tells the in-app updater that exiting is how this backend gets restarted (see detectSupervisor).
  $env:SMART_MIRROR_SUPERVISED = 'loop'

  if ($Service -eq 'backend') {
    Set-Location (Join-Path $Root 'backend')
    $command = 'node server.js >> ..\logs\backend.log 2>&1'
  } elseif ($Service -eq 'frontend') {
    Set-Location (Join-Path $Root 'frontend')
    $command = "node node_modules\vite\bin\vite.js preview --port $FrontendPort --host >> ..\logs\frontend.log 2>&1"
  } else {
    exit 2
  }

  while ($true) {
    $log = Join-Path $LogDir "$Service.log"
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Move-Item $log "$log.old" -Force }
    Write-Log $Service 'starting'
    cmd.exe /d /c $command
    Write-Log $Service ("exited with code {0}, restarting in 3 s" -f $LASTEXITCODE)
    Start-Sleep -Seconds 3
  }
}

# ---------------------------------------------------------------------------------------------
# Start both servers (skipping one that is already listening, so running this twice is harmless).
# ---------------------------------------------------------------------------------------------
function Test-Port([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $client.Close() }
}

foreach ($name in 'backend', 'frontend') {
  $port = if ($name -eq 'backend') { $BackendPort } else { $FrontendPort }
  if (Test-Port $port) { Write-Log 'kiosk' "$name already listening on $port"; continue }
  Write-Log 'kiosk' "starting $name"
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Service $name"
}

# Wait for the page. A cold start can take a while on a slow disk, so give it three minutes.
$Url = "http://localhost:$FrontendPort"
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) {
  try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null; $up = $true } catch { Start-Sleep -Seconds 2 }
}
if (-not $up) { Write-Log 'kiosk' "$Url did not come up in 3 minutes, see backend.log and frontend.log"; exit 1 }
Write-Log 'kiosk' "$Url is up"
if ($env:SM_NO_KIOSK) { exit 0 }

# ---------------------------------------------------------------------------------------------
# Fullscreen kiosk browser, relaunched if it is closed (the same watchdog as scripts\start-kiosk.sh).
# Edge ships with Windows 10 and 11, so it is preferred; Chrome works too. The browser gets its own
# profile folder so it never joins (or disturbs) a normal browsing window.
# ---------------------------------------------------------------------------------------------
$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { Write-Log 'kiosk' 'no Edge or Chrome found, install one of them'; exit 1 }

$profileDir = Join-Path $Root 'browser-profile'
$flags = @(
  "--kiosk $Url",
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--noerrdialogs',
  '--disable-infobars',
  '--disable-session-crashed-bubble',
  '--disable-features=Translate,TranslateUI',
  '--overscroll-history-navigation=0',
  '--disable-pinch'
)
if ($browser -like '*msedge.exe') { $flags += '--edge-kiosk-type=fullscreen' }

while ($true) {
  Write-Log 'kiosk' "launching $browser"
  Start-Process -FilePath $browser -ArgumentList ($flags -join ' ') -Wait
  Write-Log 'kiosk' 'browser exited, relaunching in 3 s'
  Start-Sleep -Seconds 3
}
