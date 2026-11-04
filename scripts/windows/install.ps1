# Smart Mirror installer for Windows. In an administrator PowerShell, paste ONE line:
#
#   irm https://raw.githubusercontent.com/DeDuplicate/smart_mirror/main/scripts/windows/install.ps1 | iex
#
# It installs Node.js, Git, FFmpeg and yt-dlp with winget, downloads the app to C:\SmartMirror,
# installs its dependencies, opens ports 3000-3001 to your home network (so a phone can use it),
# stops the screen from sleeping, and makes the app start in a FULLSCREEN kiosk browser every time
# this user logs in. Safe to run again: it updates the install in place and keeps your data.
# ASCII only so it survives any download encoding; Windows PowerShell 5.1 safe.
param(
  [string]$InstallDir = 'C:\SmartMirror',
  [string]$Repo = 'https://github.com/DeDuplicate/smart_mirror.git',
  [string]$Branch = 'main',
  [switch]$SkipPrerequisites,   # do not run winget (Node 20+ and Git must already be installed)
  [switch]$NoAutostart,         # do not create the logon task
  [switch]$NoPowerSettings,     # leave the screen/sleep timeouts alone
  [switch]$NoFirewall,          # do not open ports 3000-3001
  [switch]$NoStart              # install only, do not start it now
)

$ErrorActionPreference = 'Stop'
$RawUrl = "https://raw.githubusercontent.com/DeDuplicate/smart_mirror/$Branch/scripts/windows/install.ps1"
$FrontendPort = if ($env:SM_FRONTEND_PORT) { [int]$env:SM_FRONTEND_PORT } else { 3000 }
$BackendPort = if ($env:SM_BACKEND_PORT) { [int]$env:SM_BACKEND_PORT } else { 3001 }

function Say([string]$Text) { Write-Host "`n[smart-mirror] $Text" -ForegroundColor Cyan }
function Have([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Test-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

# Run a program and stop the install if it fails (PowerShell does not do that for programs by itself).
function Exec([string]$File, [string[]]$Arguments) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $File @Arguments
  $code = $LASTEXITCODE
  $ErrorActionPreference = $saved
  if ($code -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $code" }
}

function Get-LanIp {
  try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
    return (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1).IPAddress
  } catch { return $null }
}

# ---------------------------------------------------------------------------------------------
# Administrator rights: needed to install programs, open the firewall and register the startup
# task. Ask Windows for them by running the same thing again, in a window that stays open.
# ---------------------------------------------------------------------------------------------
$needAdmin = -not ($SkipPrerequisites -and $NoAutostart -and $NoPowerSettings -and $NoFirewall)
if ($needAdmin -and -not (Test-Admin)) {
  Say 'Administrator rights are needed. Windows will ask for permission...'
  if ($PSCommandPath) {
    $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"")
    foreach ($key in $PSBoundParameters.Keys) {
      $value = $PSBoundParameters[$key]
      if ($value -is [switch]) { if ($value.IsPresent) { $relaunch += "-$key" } } else { $relaunch += "-$key"; $relaunch += "`"$value`"" }
    }
  } else {
    $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', "irm '$RawUrl' | iex")
  }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $relaunch
  return
}

Say "Installing Smart Mirror into $InstallDir"

# ---------------------------------------------------------------------------------------------
# 1. Programs. Node 22 is pinned on purpose: it is what the app is tested with, and the SQLite
#    module ships a ready-made binary for it (a newer Node could need a C++ compiler instead).
# ---------------------------------------------------------------------------------------------
function Winget-Install([string]$Id) {
  Exec 'winget' @('install', '--id', $Id, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements')
  Refresh-Path
}

if (-not $SkipPrerequisites) {
  if (-not (Have 'winget')) {
    throw 'winget was not found. Install "App Installer" from the Microsoft Store, or install Node.js 22 and Git yourself and run this again with -SkipPrerequisites.'
  }
  $nodeOk = $false
  if (Have 'node') { $nodeOk = ([int](((node --version) -replace '^v', '').Split('.')[0])) -ge 20 }
  if (-not $nodeOk) { Say 'Installing Node.js 22...'; Winget-Install 'OpenJS.NodeJS.22' }
  if (-not (Have 'git')) { Say 'Installing Git...'; Winget-Install 'Git.Git' }
  # Only needed for casting music to speakers and camera snapshots, so a failure here is not fatal.
  if (-not (Have 'ffmpeg')) { Say 'Installing FFmpeg...'; try { Winget-Install 'Gyan.FFmpeg' } catch { Write-Warning "FFmpeg was not installed: $_" } }
  if (-not (Have 'yt-dlp')) { Say 'Installing yt-dlp...'; try { Winget-Install 'yt-dlp.yt-dlp' } catch { Write-Warning "yt-dlp was not installed: $_" } }
}
Refresh-Path
if (-not (Have 'node')) { throw 'Node.js is not available. Open a new PowerShell window and run this again.' }
if (-not (Have 'git')) { throw 'Git is not available. Open a new PowerShell window and run this again.' }

# ---------------------------------------------------------------------------------------------
# 2. The app. A second run stops the old copy first (running programs lock their files), then
#    updates it exactly like the in-app updater does: fetch and hard reset, data untouched.
# ---------------------------------------------------------------------------------------------
$stopScript = Join-Path $InstallDir 'scripts\windows\stop.ps1'
if (Test-Path $stopScript) {
  Say 'Stopping the running copy...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null
}

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (Test-Path (Join-Path $InstallDir '.git')) {
  Say 'Updating the existing install...'
  Exec 'git' @('-C', $InstallDir, 'fetch', 'origin', $Branch)
  Exec 'git' @('-C', $InstallDir, 'reset', '--hard', 'FETCH_HEAD')
} else {
  if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
    throw "$InstallDir already exists and is not a Smart Mirror install. Pick another folder with -InstallDir."
  }
  Say 'Downloading the app...'
  if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
  # The kiosk runs as a normal (non-elevated) user, so give that user write access up front.
  & icacls.exe $InstallDir /grant "${user}:(OI)(CI)M" | Out-Null
  Exec 'git' @('clone', '--branch', $Branch, $Repo, $InstallDir)
}
# Git refuses a folder created by an elevated session when a normal session of the same user uses it
# ("dubious ownership"), and the in-app updater needs to run git there.
$gitPath = $InstallDir -replace '\\', '/'
if (-not ((& git config --global --get-all safe.directory) -contains $gitPath)) {
  Exec 'git' @('config', '--global', '--add', 'safe.directory', $gitPath)
}

Say 'Installing dependencies (a few minutes the first time)...'
foreach ($part in 'backend', 'frontend') {
  # Same arguments as the in-app updater, so both always leave node_modules in the same state.
  Exec 'npm' @('install', '--include=dev', '--no-audit', '--no-fund', '--prefix', (Join-Path $InstallDir $part))
}
# The built frontend is committed to the repo, so nothing needs building. Only if it is missing:
if (-not (Test-Path (Join-Path $InstallDir 'frontend\dist\index.html'))) {
  Say 'Building the frontend...'
  Push-Location (Join-Path $InstallDir 'frontend')
  try { Exec 'npx' @('vite', 'build') } finally { Pop-Location }
}

# Settings file. STREAM_HOST is the address speakers use to fetch music from this PC; with several
# network adapters (Hyper-V, VPN) the automatic guess can pick the wrong one.
$envFile = Join-Path $InstallDir 'backend\.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $InstallDir 'backend\.env.example') $envFile
  $lanIp = Get-LanIp
  if ($lanIp) {
    $text = [IO.File]::ReadAllText($envFile)
    $text = $text -replace '(?m)^STREAM_HOST=[^\r\n]*', "STREAM_HOST=$lanIp"
    [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
  }
}

# ---------------------------------------------------------------------------------------------
# 3. This PC: network access for phones and speakers, no sleeping, start at logon.
# ---------------------------------------------------------------------------------------------
if (-not $NoFirewall) {
  Say "Opening ports $FrontendPort and $BackendPort to the home network only..."
  Remove-NetFirewallRule -DisplayName 'Smart Mirror' -ErrorAction SilentlyContinue
  # LocalSubnet: only devices on the same network. 3000 is the app (phones), 3001 is the address
  # speakers fetch music from. Keep the PC off the open internet, as with the Raspberry Pi.
  New-NetFirewallRule -DisplayName 'Smart Mirror' -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $FrontendPort, $BackendPort -RemoteAddress LocalSubnet -Profile Any | Out-Null
}

if (-not $NoPowerSettings) {
  Say 'Keeping the screen and the PC awake (plugged in)...'
  & powercfg.exe /change monitor-timeout-ac 0
  & powercfg.exe /change standby-timeout-ac 0
  & powercfg.exe /change hibernate-timeout-ac 0
}

$taskReady = $false
if (-not $NoAutostart) {
  Say 'Setting Smart Mirror to start at logon, fullscreen...'
  $startScript = Join-Path $InstallDir 'scripts\windows\start.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $InstallDir `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
  # Interactive + Limited: it must run inside the logged-in desktop session (the browser needs a
  # screen) and does not need administrator rights.
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'SmartMirror' -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Starts Smart Mirror and its fullscreen kiosk browser at logon' -Force | Out-Null
  $taskReady = $true
}

# ---------------------------------------------------------------------------------------------
# 4. Go.
# ---------------------------------------------------------------------------------------------
if (-not $NoStart) {
  Say 'Starting Smart Mirror...'
  if ($taskReady) {
    Start-ScheduledTask -TaskName 'SmartMirror'
  } else {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'scripts\windows\start.ps1')`""
  }
}

$lan = Get-LanIp
Write-Host ''
Write-Host '=======================================================' -ForegroundColor Green
Write-Host '  Smart Mirror is installed.' -ForegroundColor Green
Write-Host '=======================================================' -ForegroundColor Green
Write-Host "  On this PC     : http://localhost:$FrontendPort  (opens fullscreen by itself in a moment)"
if ($lan) { Write-Host "  From a phone   : http://${lan}:$FrontendPort" }
Write-Host "  Files and data : $InstallDir   (logs are in $InstallDir\logs)"
Write-Host ''
Write-Host '  Next:'
Write-Host '   1. Do the first-run setup on the screen (or Settings > Restore, to bring your data from the Pi).'
Write-Host '   2. For it to start after a restart with nobody there, turn on automatic sign-in:'
Write-Host '      press Win+R, type  netplwiz , untick "Users must enter a user name and password".'
Write-Host "   3. Leave the kiosk: powershell -File $InstallDir\scripts\windows\stop.ps1   (starts again at the next logon)"
Write-Host "      Remove it:       powershell -File $InstallDir\scripts\windows\stop.ps1 -Uninstall"
Write-Host '      Update it:       Settings > Check for updates, in the app (or run this installer again).'
Write-Host ''
