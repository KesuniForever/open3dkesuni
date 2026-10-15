# Starts the Open3DKesuni printer bridge automatically when this Windows user logs on.
# Run once, yourself, in PowerShell from the repo folder:   powershell -ExecutionPolicy Bypass -File scripts\install-bridge-autostart.ps1
# Remove it again:                                          powershell -ExecutionPolicy Bypass -File scripts\install-bridge-autostart.ps1 -Remove
param([switch]$Remove)
$name = "Open3DKesuni printer bridge"
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed: $name"
  return
}
$cmd = Join-Path $PSScriptRoot "start-bridge.cmd"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# No time limit, keep going on battery, start again if Windows stopped it.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Installed: $name (starts at logon). Start it now with: Start-ScheduledTask -TaskName '$name'"
Write-Host "Log: $(Join-Path (Split-Path $PSScriptRoot) 'logs\printer-bridge.log')"
