# Smart Mirror installer for Windows 10 PCs WITHOUT winget (older builds, LTSC, fresh installs).
# In an administrator PowerShell, paste ONE line:
#
#   irm https://raw.githubusercontent.com/DeDuplicate/smart_mirror/main/scripts/windows/install-legacy.ps1 | iex
#
# It downloads Git straight from its publisher, Node.js 22 when the PC has no Node 20 or 22 (kept in its own
# folder, an existing newer Node is left alone), plus Chromium as the kiosk browser (much lighter than Edge;
# Edge or Chrome is used instead if that download fails), checks every download against a checksum or digital
# signature, puts FFmpeg and yt-dlp in C:\ProgramData\SmartMirror\bin (on the machine PATH, yt-dlp updated
# weekly), Node in ...\SmartMirror\node and Chromium in ...\SmartMirror\chromium, and then runs
# the normal installer, install.ps1, for everything else: the app itself, the firewall, no sleeping, and
# the fullscreen kiosk at logon. Safe to run again.
# ASCII only so it survives any download encoding; Windows PowerShell 5.1 safe.
param(
  [string]$InstallDir = 'C:\SmartMirror',
  [string]$Repo = 'https://github.com/DeDuplicate/smart_mirror.git',
  [string]$Branch = 'main',
  [switch]$SkipPrerequisites,   # do not download or install anything (Node 20+ and Git must already be there)
  [switch]$NoAutostart,         # passed on to install.ps1
  [switch]$NoPowerSettings,     # passed on to install.ps1
  [switch]$NoFirewall,          # passed on to install.ps1
  [switch]$NoStart              # passed on to install.ps1
)

$ErrorActionPreference = 'Stop'
$RawBase = "https://raw.githubusercontent.com/DeDuplicate/smart_mirror/$Branch/scripts/windows"
# Downloads and tools live under ProgramData\SmartMirror, which Lock-Folder makes writable by
# administrators only. A user-writable temp folder would let a normal program swap a file between the
# check and the moment the elevated installer runs it.
$SharedDir = Join-Path $env:ProgramData 'SmartMirror'
$Tmp = Join-Path $SharedDir ('tmp-' + [guid]::NewGuid().ToString('N'))   # fresh every run, never reused
$ToolsBin = Join-Path $SharedDir 'bin'
$ChromiumDir = Join-Path $SharedDir 'chromium'
$NodeDir = Join-Path $SharedDir 'node'
# Older Windows PowerShell may not offer TLS 1.2 by default, and every site below requires it.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Say([string]$Text) { Write-Host "`n[smart-mirror] $Text" -ForegroundColor Cyan }
function Have([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Test-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

# ---------------------------------------------------------------------------------------------
# Downloads. Every file is checked against the publisher's SHA-256 and/or its digital signature
# before anything runs it.
# ---------------------------------------------------------------------------------------------
function Get-Text([string]$Url) {
  $ProgressPreference = 'SilentlyContinue'
  $content = (Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers @{ 'User-Agent' = 'smart-mirror-installer' }).Content
  if ($content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($content) }
  return $content
}

function Get-File([string]$Url, [string]$Name, [string]$Sha256, [switch]$Signed) {
  if (-not (Test-Path $Tmp)) { New-Item -ItemType Directory -Path $Tmp | Out-Null }
  $path = Join-Path $Tmp $Name
  Say "Downloading $Name ..."
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes Windows PowerShell 5.1 downloads many times slower
  Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing -Headers @{ 'User-Agent' = 'smart-mirror-installer' }
  if ($Sha256) {
    $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash
    if ($actual -ne $Sha256.Trim().ToUpper()) {
      Remove-Item $path -Force
      throw "$Name failed its SHA-256 check (expected $Sha256, got $actual). Not installing it."
    }
  }
  if ($Signed) {
    $signature = Get-AuthenticodeSignature -FilePath $path
    if ($signature.Status -ne 'Valid') {
      Remove-Item $path -Force
      throw "$Name has no valid digital signature ($($signature.Status)). Not installing it."
    }
  }
  return $path
}

# The app's SQLite module (better-sqlite3) ships ready-made binaries for Node 20 and 22 only. On any other
# version (Node 24 or 26, say) it tries to compile itself with a C++ toolchain and fails, so those are
# not usable. Node 22 is also what the app is tested with.
function Get-NodeMajor {
  if (-not (Have 'node')) { return 0 }
  return [int](((node --version) -replace '^v', '').Split('.')[0])
}

# Node 22 as a plain unpacked copy in its own folder, for a PC that has no Node or a different one. Nothing
# is installed or uninstalled: whatever Node the PC already has stays as it is, and install.ps1 and start.ps1
# put this copy first on PATH for the app only. Checked against the SHA-256 on nodejs.org and node.exe's
# digital signature.
function Install-NodeZip([string]$Dir) {
  # Assigned to a variable first: PowerShell pipes a JSON array out of Invoke-RestMethod as ONE object,
  # so filtering the call directly would treat the whole version list as a single release.
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $release = $index | Where-Object { $_.version -like 'v22.*' -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
  if (-not $release) { throw 'Could not find a Node.js 22 download on nodejs.org.' }
  $name = "node-$($release.version)-win-x64.zip"
  $sums = (Get-Text "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt") -split "`n"
  $line = $sums | Where-Object { $_ -match ('\s' + [regex]::Escape($name) + '\s*$') } | Select-Object -First 1
  if (-not $line) { throw "nodejs.org lists no SHA-256 for $name." }
  if (Test-Path -LiteralPath $Dir) { throw "$Dir exists but holds no node.exe. Delete it (as an administrator) and run this again." }
  $zip = Get-File "https://nodejs.org/dist/$($release.version)/$name" $name (($line.Trim() -split '\s+')[0])
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $unpacked = Join-Path $Tmp 'node'
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpacked)
  $inner = Get-ChildItem $unpacked -Directory | Select-Object -First 1
  if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName 'node.exe')) -or -not (Test-Path (Join-Path $inner.FullName 'npm.cmd'))) { throw 'node.exe or npm.cmd is not in the Node.js download.' }
  $signature = Get-AuthenticodeSignature -FilePath (Join-Path $inner.FullName 'node.exe')
  if ($signature.Status -ne 'Valid') { throw "node.exe has no valid digital signature ($($signature.Status)). Not using it." }
  Move-Item $inner.FullName $Dir
}

function Get-GitInstaller {
  $release = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'smart-mirror-installer' }
  $asset = $release.assets | Where-Object { $_.name -match '^Git-[0-9.]+-64-bit\.exe$' } | Select-Object -First 1
  if (-not $asset) { throw 'Could not find the Git for Windows installer. Install Git from https://git-scm.com/download/win and run this again.' }
  $sha = ''
  if ($asset.digest -like 'sha256:*') { $sha = $asset.digest.Substring(7) }
  return (Get-File $asset.browser_download_url $asset.name $sha -Signed)
}

function Get-ChromeMsi {
  return (Get-File 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi' 'chrome.msi' '' -Signed)
}

function Install-Msi([string]$Msi) {
  $process = Start-Process -FilePath msiexec.exe -ArgumentList "/i `"$Msi`" /qn /norestart" -Wait -PassThru
  # 3010 means "installed, a restart is advisable", which Node and Chrome do not need.
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) { throw "Installing $(Split-Path $Msi -Leaf) failed (msiexec exit code $($process.ExitCode))." }
}

function Find-Browser {
  @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

# True only for something an administrator (or SYSTEM) created. A standard user can create folders in
# ProgramData first; they would stay the owner (and could change the permissions or contents later) of
# anything they made. A link (junction or symlink) is never trusted either: an elevated write through one
# lands somewhere else entirely.
function Test-Trusted([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
  if ($item.PSIsContainer) { $acl = (New-Object IO.DirectoryInfo $Path).GetAccessControl() } else { $acl = (New-Object IO.FileInfo $Path).GetAccessControl() }
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  return ($owner -eq 'S-1-5-18' -or $owner -eq 'S-1-5-32-544')
}

# Only administrators and SYSTEM may change this folder; everyone else may read and run from it. It holds
# installers that run elevated and programs on the machine PATH (one run by a SYSTEM task), so a standard
# user must not be able to add or swap files there. Well-known SIDs, because group names such as
# "Administrators" are translated on non-English Windows.
function Lock-Folder([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    # Refused rather than cleaned up: deleting a tree somebody else controls, with administrator rights,
    # is itself a way to be tricked into deleting the wrong files.
    if (-not (Test-Trusted $Path)) {
      throw "$Path already exists and was not created by an administrator. Delete it (as an administrator) and run this again."
    }
  } else {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
  & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not restrict access to $Path (icacls exit code $LASTEXITCODE)." }
  # Check the result instead of trusting it: nobody but SYSTEM and Administrators may be able to change anything here.
  $FSR = [Security.AccessControl.FileSystemRights]
  $writeRights = [int]($FSR::WriteData -bor $FSR::AppendData -bor $FSR::Delete -bor $FSR::DeleteSubdirectoriesAndFiles -bor $FSR::ChangePermissions -bor $FSR::TakeOwnership)
  foreach ($rule in (New-Object IO.DirectoryInfo $Path).GetAccessControl().Access) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and (([int]$rule.FileSystemRights -band $writeRights) -ne 0) -and $sid -ne 'S-1-5-18' -and $sid -ne 'S-1-5-32-544') {
      throw "$Path can still be changed by $sid after locking it. Not continuing."
    }
  }
}

# A tool already in the folder is only reused if an administrator put it there.
function Test-ToolPresent([string]$Bin, [string]$Name) {
  $file = Join-Path $Bin $Name
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  if (-not (Test-Trusted $file)) { throw "$file was not created by an administrator. Delete it and run this again." }
  return $true
}

# yt-dlp and FFmpeg are only needed to cast music to speakers and for camera snapshots.
function Install-Tools([string]$Bin) {
  if (Test-Path -LiteralPath $Bin) {
    if (-not (Test-Trusted $Bin)) { throw "$Bin was not created by an administrator. Delete it and run this again." }
  } else {
    New-Item -ItemType Directory -Path $Bin | Out-Null
  }
  if (-not (Test-ToolPresent $Bin 'yt-dlp.exe') -and -not (Have 'yt-dlp')) {
    Say 'Installing yt-dlp...'
    $base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
    $match = [regex]::Match((Get-Text "$base/SHA2-256SUMS"), '(?m)^([0-9a-fA-F]{64})\s+\*?yt-dlp\.exe\s*$')
    if (-not $match.Success) { throw 'yt-dlp publishes no SHA-256 for yt-dlp.exe.' }
    Move-Item (Get-File "$base/yt-dlp.exe" 'yt-dlp.exe' $match.Groups[1].Value) (Join-Path $Bin 'yt-dlp.exe') -Force
  }
  if (-not (Test-ToolPresent $Bin 'ffmpeg.exe') -and -not (Have 'ffmpeg')) {
    Say 'Installing FFmpeg (about 110 MB)...'
    # The Windows builds of FFmpeg's usual packager, from his GitHub releases (more dependable than his
    # own site), with the SHA-256 GitHub records for each file.
    $release = Invoke-RestMethod 'https://api.github.com/repos/GyanD/codexffmpeg/releases/latest' -Headers @{ 'User-Agent' = 'smart-mirror-installer' }
    $asset = $release.assets | Where-Object { $_.name -match '^ffmpeg-[0-9.]+-essentials_build\.zip$' } | Select-Object -First 1
    if (-not $asset -or $asset.digest -notlike 'sha256:*') { throw 'No FFmpeg download with a published SHA-256 was found.' }
    $zip = Get-File $asset.browser_download_url 'ffmpeg.zip' $asset.digest.Substring(7)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
      $entry = $archive.Entries | Where-Object { $_.FullName -match '/bin/ffmpeg\.exe$' } | Select-Object -First 1
      if (-not $entry) { throw 'ffmpeg.exe is not in the FFmpeg download.' }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $Bin 'ffmpeg.exe'), $true)
    } finally { $archive.Dispose() }
  }
}

# The kiosk browser: Chromium (the ungoogled-chromium build, which runs no Google services in the
# background; start.ps1 prefers it to Edge, which is far heavier). Each version gets its own folder, so a
# newer one never overwrites the copy that is running. It does not update itself: running this installer
# again fetches the newest version.
function Install-Chromium([string]$Dir) {
  $release = Invoke-RestMethod 'https://api.github.com/repos/ungoogled-software/ungoogled-chromium-windows/releases/latest' -Headers @{ 'User-Agent' = 'smart-mirror-installer' }
  $asset = $release.assets | Where-Object { $_.name -match '_windows_x64\.zip$' } | Select-Object -First 1
  if (-not $asset -or $asset.digest -notlike 'sha256:*') { throw 'No Chromium download with a published SHA-256 was found.' }
  if ($release.tag_name -notmatch '^[0-9][0-9A-Za-z._-]*$') { throw "Unexpected Chromium version name '$($release.tag_name)'." }
  if (Test-Path -LiteralPath $Dir) {
    if (-not (Test-Trusted $Dir)) { throw "$Dir was not created by an administrator. Delete it and run this again." }
  } else {
    New-Item -ItemType Directory -Path $Dir | Out-Null
  }
  $target = Join-Path $Dir $release.tag_name
  if (Test-Path -LiteralPath (Join-Path $target 'chrome.exe')) { return }   # this version is already here
  Say 'Installing Chromium (about 200 MB)...'
  $zip = Get-File $asset.browser_download_url 'chromium.zip' $asset.digest.Substring(7)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $unpacked = Join-Path $Tmp 'chromium'
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpacked)
  $inner = Get-ChildItem $unpacked -Directory | Select-Object -First 1
  if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName 'chrome.exe'))) { throw 'chrome.exe is not in the Chromium download.' }
  Move-Item $inner.FullName $target
  # Keep the newest two: install.ps1 restarts the kiosk right after this, onto the new one, so at most
  # the previous version could still be running.
  Get-ChildItem $Dir -Directory | Sort-Object CreationTime -Descending | Select-Object -Skip 2 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# Append a folder to the machine PATH without disturbing what is there. The raw value is read and
# written back as an expandable string so entries like %SystemRoot%\system32 stay as they are.
function Add-MachinePath([string]$Dir, [string]$Key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment') {
  $raw = (Get-Item -Path $Key).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  if (($raw -split ';') -contains $Dir) { return }
  Set-ItemProperty -Path $Key -Name 'Path' -Value ($raw.TrimEnd(';') + ';' + $Dir) -Type ExpandString
}

# YouTube changes often and an old yt-dlp stops casting, so keep it fresh (the Pi does this from cron).
function Register-YtdlpUpdate([string]$Bin) {
  $action = New-ScheduledTaskAction -Execute (Join-Path $Bin 'yt-dlp.exe') -Argument '-U'
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 4am
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName 'SmartMirror yt-dlp update' -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Keeps yt-dlp current so casting music to speakers keeps working' -Force | Out-Null
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------
# Administrator rights: needed to install programs. Ask Windows for them by running the same thing
# again, in a window that stays open.
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
    $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', "irm '$RawBase/install-legacy.ps1' | iex")
  }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $relaunch
  return
}

if (-not $SkipPrerequisites) {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Smart Mirror needs 64-bit Windows.' }
  Lock-Folder $SharedDir   # before the first download: everything below is saved inside it

  # Use the PC's own Node when it is 20 or 22. Otherwise (none, or a newer one the app's database module
  # cannot use) keep a private Node 22 in ProgramData\SmartMirror\node and leave the PC's Node alone.
  if (-not (Test-Path -LiteralPath (Join-Path $NodeDir 'node.exe'))) {
    $major = Get-NodeMajor
    if ($major -ne 20 -and $major -ne 22) {
      if ($major -eq 0) { Say 'Node.js was not found; unpacking Node.js 22 for Smart Mirror...' } else { Say "This PC has Node.js $major, which Smart Mirror cannot use; unpacking its own Node.js 22 (the PC's copy is left alone)..." }
      Install-NodeZip $NodeDir
    }
  }

  if (-not (Have 'git')) {
    Say 'Installing Git...'
    $process = Start-Process -FilePath (Get-GitInstaller) -ArgumentList '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /NOCANCEL /SP-' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installing Git failed (exit code $($process.ExitCode))." }
    Refresh-Path
  }

  try {
    Install-Chromium $ChromiumDir
  } catch {
    Write-Warning "Chromium was not installed ($_), so the kiosk will use Edge or Chrome."
    if (-not (Find-Browser)) { Say 'No other browser was found; installing Google Chrome for the kiosk...'; Install-Msi (Get-ChromeMsi) }
  }

  try {
    Install-Tools $ToolsBin
    Add-MachinePath $ToolsBin
    # Only for a yt-dlp this script put there; a copy the user already had elsewhere is theirs to update.
    # SYSTEM, because the folder is administrator-only and yt-dlp -U replaces its own file.
    if (Test-Path (Join-Path $ToolsBin 'yt-dlp.exe')) { Register-YtdlpUpdate $ToolsBin }
  } catch {
    Write-Warning "yt-dlp / FFmpeg were not fully installed (casting music to speakers needs them; everything else works): $_"
  }
  if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
Refresh-Path

# Everything else is the normal installer. Use the copy next to this file when there is one (a clone or
# a download), otherwise fetch it from the same branch.
$sibling = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'install.ps1' } else { '' }
$installer = if ($sibling -and (Test-Path $sibling)) { [IO.File]::ReadAllText($sibling) } else { Get-Text "$RawBase/install.ps1" }
$passOn = @{ SkipPrerequisites = $true; InstallDir = $InstallDir; Repo = $Repo; Branch = $Branch }
if (Test-Path -LiteralPath (Join-Path $NodeDir 'node.exe')) {
  # Only a copy an administrator put there is put first on PATH of the elevated installer.
  if (-not (Test-Trusted $NodeDir)) { throw "$NodeDir was not created by an administrator. Delete it (as an administrator) and run this again." }
  $passOn.NodeDir = $NodeDir
}
if ($NoAutostart) { $passOn.NoAutostart = $true }
if ($NoPowerSettings) { $passOn.NoPowerSettings = $true }
if ($NoFirewall) { $passOn.NoFirewall = $true }
if ($NoStart) { $passOn.NoStart = $true }
& ([scriptblock]::Create($installer)) @passOn
