#Requires -Version 5.1
<#
.SYNOPSIS
  Prism command line: open Prism, update it, remove it.

.DESCRIPTION
  prism                      open Prism
  prism settings             open Prism settings
  prism version              show the installed version
  prism update               update Prism to the latest version
  prism uninstall [-Purge]   remove Prism (-Purge also removes your settings and config)
  prism restore              undo Windows changes made by Prism 0.3 desktop themes, if any
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('version', 'update', 'uninstall', 'restore', 'help')][string]$Command = 'help',
  [switch]$Force,
  [switch]$Purge,
  [switch]$Detached
)

$ErrorActionPreference = 'Stop'
if ([Console]::IsOutputRedirected) { try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {} }

$DataDir     = Join-Path $env:LOCALAPPDATA 'Prism'
$BackupFile  = Join-Path $DataDir 'backup.json'
$CurrentFile = Join-Path $DataDir 'current.json'
$AppDir      = Join-Path $DataDir 'app'
$BinDir      = Join-Path $DataDir 'bin'
$Utf8NoBom   = New-Object System.Text.UTF8Encoding $false
# Prism 0.3 desktop themes could start window tiling at login; restore removes that too
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Prism GlazeWM.lnk'

function Write-Step([string]$m) { Write-Host "  > $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  + $m" -ForegroundColor Green }
function Write-Note([string]$m) { Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn([string]$m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# ---------------------------------------------------------------- helpers
function Write-TextFile([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}
function Read-Json([string]$Path) { return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json }
function Initialize-Native {
  if ('Prism.Native' -as [type]) { return }
  Add-Type -Namespace Prism -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool SystemParametersInfo(int uiAction, int uiParam, string pvParam, int fWinIni);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
}
function Send-SettingChange {
  Initialize-Native
  $r = [UIntPtr]::Zero
  foreach ($area in 'ImmersiveColorSet', 'WindowsThemeElement', 'TraySettings') { [void][Prism.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, $area, 2, 3000, [ref]$r) }
}
function Set-Wallpaper([string]$Path) {
  Initialize-Native
  if (-not [Prism.Native]::SystemParametersInfo(20, 0, $Path, 3)) { Write-Warn "Could not set the wallpaper: $Path" } # SPI_SETDESKWALLPAPER
}
function Set-Reg([string]$Path, [string]$Name, [string]$Type, $Value) {
  if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
  if ($Type -eq 'DWord') { $Value = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]([int64]$Value -band 0xFFFFFFFFL)), 0) }
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}
function Get-RegValue([string]$Path, [string]$Name) {
  $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  return $item.$Name
}

# ---------------------------------------------------------------- undo Prism 0.3 desktop changes
function Invoke-Restore {
  if (-not (Test-Path $BackupFile)) { Write-Note 'Nothing to restore: Windows was not changed by an older Prism version.'; return }
  $b = Read-Json $BackupFile
  Write-Step 'Restoring Windows settings'
  foreach ($r in @($b.Registry)) { if ($r.Exists) { Set-Reg $r.Path $r.Name $r.Type $r.Value } else { Remove-ItemProperty -Path $r.Path -Name $r.Name -ErrorAction SilentlyContinue } }
  Write-Step 'Restoring config files'
  foreach ($f in @($b.Files)) {
    if ($f.Backup -and (Test-Path -LiteralPath $f.Backup)) { Copy-Item -LiteralPath $f.Backup -Destination $f.Target -Force }
    elseif (Test-Path -LiteralPath $f.Target) { Remove-Item -LiteralPath $f.Target -Force }
  }
  if (Test-Path -LiteralPath $StartupLink) {
    Remove-Item -LiteralPath $StartupLink -Force
    if (-not $b.GlazeWasRunning) { Stop-Process -Name glazewm -ErrorAction SilentlyContinue }
    Write-Ok 'Turned off window tiling started by Prism'
  }
  if ($b.Wallpaper) { Set-Wallpaper $b.Wallpaper }
  Send-SettingChange
  Move-Item -LiteralPath $BackupFile -Destination (Join-Path $DataDir ('backup-restored-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) -Force
  Remove-Item -LiteralPath $CurrentFile -ErrorAction SilentlyContinue
  Write-Ok 'Done. Some changes (like the taskbar color) may need you to sign out and back in.'
}

# ---------------------------------------------------------------- commands
function Show-Version {
  $exe = Join-Path $AppDir 'Prism.exe'
  if (Test-Path -LiteralPath $exe) { Write-Host "Prism $(((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion) -replace '^(\d+\.\d+\.\d+)\.0$', '$1')" } else { Write-Host 'Prism is not installed in this user profile.' }
}
function Invoke-Update {
  Write-Step 'Opening the updater in a new window (Prism will close for a moment)'
  $env:TERM_PROGRAM = $null
  # update from the repository Prism was installed from
  $repo = 'onufry444/prism'
  $f = Join-Path $DataDir 'repo.txt'
  if (Test-Path -LiteralPath $f) { $r = ([IO.File]::ReadAllText($f)).Trim(); if ($r -match '^[\w.-]+/[\w.-]+$') { $repo = $r } }
  $cmd = "`$env:PRISM_REPO = '$repo'; irm https://raw.githubusercontent.com/$repo/main/install.ps1 | iex"
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', $cmd
}
function Remove-FromUserPath([string]$Dir) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $cur = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $all = @($cur -split ';' | Where-Object { $_ })
    $keep = @($all | Where-Object { $_.TrimEnd('\') -ne $Dir.TrimEnd('\') })
    if ($keep.Count -ne $all.Count) {
      $key.SetValue('Path', ($keep -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
      [Environment]::SetEnvironmentVariable('PRISM_INSTALLED', $null, 'User')  # broadcasts WM_SETTINGCHANGE
    }
  } finally { $key.Close() }
}
# Asks the running app to quit, so it can put the taskbar and the desktop work area back; forces it after a few seconds.
function Stop-PrismApp {
  $procs = @(Get-Process -Name Prism -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($AppDir, [StringComparison]::OrdinalIgnoreCase) })
  if (-not $procs.Count) { return }
  $inbox = Join-Path $env:APPDATA 'Prism\inbox'
  if (Test-Path -LiteralPath $inbox) { [IO.File]::WriteAllText((Join-Path $inbox ('quit-' + [guid]::NewGuid().ToString('N') + '.msg')), "quit;`n") }
  for ($i = 0; $i -lt 30 -and @(Get-Process -Id ($procs.Id) -ErrorAction SilentlyContinue).Count; $i++) { Start-Sleep -Milliseconds 200 }
  Get-Process -Id ($procs.Id) -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
}
function Invoke-Uninstall {
  # Inside a Prism tab, closing Prism would end this script too: finish in a separate window.
  # -Detached makes sure that window never hands off again, whatever the environment says.
  if ($env:TERM_PROGRAM -eq 'Prism' -and -not $Detached) {
    if (-not $Force) {
      $a = Read-Host '  Remove Prism from this PC? Type YES'
      if ($a -ne 'YES') { Write-Note 'Cancelled.'; return }
    }
    Write-Step 'Prism will close now; the uninstall finishes in a new window.'
    $env:TERM_PROGRAM = $null
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", 'uninstall', '-Force', '-Detached')
    if ($Purge) { $a += '-Purge' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $a
    return
  }
  if (-not $Force) {
    $a = Read-Host '  Remove Prism from this PC? Type YES'
    if ($a -ne 'YES') { Write-Note 'Cancelled.'; return }
  }
  Stop-PrismApp
  if (Test-Path $BackupFile) { Invoke-Restore }
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Prism.lnk') -ErrorAction SilentlyContinue
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Get-ItemProperty $run -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties } | Where-Object { $_.Value -is [string] -and $_.Value -like "*$AppDir*" } | ForEach-Object { Remove-ItemProperty -Path $run -Name $_.Name -ErrorAction SilentlyContinue }
  Remove-FromUserPath $BinDir
  foreach ($d in $BinDir, $AppDir) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue } }
  Remove-Item -LiteralPath (Join-Path $DataDir 'repo.txt') -Force -ErrorAction SilentlyContinue
  Write-Ok 'Prism was removed.'
  if ($Purge) {
    foreach ($d in $DataDir, (Join-Path $env:APPDATA 'Prism'), (Join-Path $env:USERPROFILE '.config\prism')) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue } }
    Write-Note 'Your settings and config were removed too.'
  } else {
    Write-Note "Your config stays in $(Join-Path $env:USERPROFILE '.config\prism') (and settings in $(Join-Path $env:APPDATA 'Prism')). Run 'prism uninstall -Purge' to remove those as well."
  }
  if ($Detached) { Write-Note 'You can close this window.' }
}

switch ($Command) {
  'version'   { Show-Version }
  'update'    { Invoke-Update }
  'uninstall' { Invoke-Uninstall }
  'restore'   { Invoke-Restore }
  default     { Get-Help $PSCommandPath -Detailed | Out-String | Write-Host }
}
