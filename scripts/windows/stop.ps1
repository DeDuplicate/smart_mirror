# Stops Smart Mirror on this PC (servers, kiosk browser and the relaunch loops), or removes it.
#
#   stop.ps1                       stop it until the next logon
#   stop.ps1 -Uninstall            also remove the startup task and the firewall rule
#   stop.ps1 -Uninstall -RemoveFiles   also delete the install folder (your data goes with it)
#
# Power settings that install.ps1 changed (screen and sleep timeouts) are left as they are; change
# them in Settings > System > Power. ASCII only, Windows PowerShell 5.1 safe.
param([switch]$Uninstall, [switch]$RemoveFiles)

$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$starter = Join-Path $PSScriptRoot 'start.ps1'
$profileDir = Join-Path $Root 'browser-profile'

Stop-ScheduledTask -TaskName 'SmartMirror' -ErrorAction SilentlyContinue

# Every process this install started carries one of two paths on its command line: start.ps1 (the
# launcher and the two relaunch loops) or the kiosk browser's profile folder. taskkill /T takes each
# one's whole tree with it (node, cmd, the browser's helpers).
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains($starter) -or $_.CommandLine.Contains($profileDir))
}
foreach ($p in $targets) { taskkill /PID $p.ProcessId /T /F 2>&1 | Out-Null }
Write-Host ("Stopped {0} process tree(s)." -f @($targets).Count)

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName 'SmartMirror' -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName 'Smart Mirror' -ErrorAction SilentlyContinue
  Write-Host 'Removed the startup task and the firewall rule.'
  if ($RemoveFiles) {
    # This script lives inside the folder, so let a separate process delete it a moment later.
    Start-Process cmd.exe -WindowStyle Hidden -ArgumentList "/c ping -n 4 127.0.0.1 >nul & rmdir /s /q `"$Root`""
    Write-Host "Deleting $Root ..."
  }
}
