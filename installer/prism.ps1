﻿#Requires -Version 5.1
<#
.SYNOPSIS
  Prism engine: applies a desktop theme to Windows 11 and puts everything back on request.

.DESCRIPTION
  prism list                        list themes (built-in and yours)
  prism apply <theme|file.json>     apply a theme (the first time also saves a backup of your settings)
  prism apply <theme> -DryRun       only write the generated files to -OutDir, change nothing
  prism restore                     restore the original look from the backup
  prism status                      what is active
  prism update                      update Prism to the latest version
  prism uninstall [-Force]          remove Prism (restores the original look first)

.PARAMETER SkipInstall
  Do not install missing tools (GlazeWM).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('list', 'themes', 'apply', 'restore', 'status', 'update', 'uninstall', 'help')][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Theme,
  [switch]$SkipInstall,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$Detached,
  [string]$OutDir = 'prism-out'
)

$ErrorActionPreference = 'Stop'
# When another program reads our output (Prism settings), send UTF-8.
if ([Console]::IsOutputRedirected) { try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {} }

$Root          = Split-Path -Parent $PSScriptRoot
$ThemesDir     = Join-Path $Root 'themes'
$DataDir       = Join-Path $env:LOCALAPPDATA 'Prism'
$UserThemesDir = Join-Path $DataDir 'themes'
$BackupDir     = Join-Path $DataDir 'backup'
$BackupFile    = Join-Path $DataDir 'backup.json'
$CurrentFile   = Join-Path $DataDir 'current.json'
$AppDir        = Join-Path $DataDir 'app'
$BinDir        = Join-Path $DataDir 'bin'
$InstallUrl    = 'https://raw.githubusercontent.com/onufry444/prism/main/install.ps1'
$Utf8NoBom     = New-Object System.Text.UTF8Encoding $false

$GlazeConfig = Join-Path $env:USERPROFILE '.glzr\glazewm\config.yaml'
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Prism GlazeWM.lnk'

$PersonalizeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$DwmKey         = 'HKCU:\Software\Microsoft\Windows\DWM'
$AccentKey      = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent'
$AdvancedKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$DesktopKey     = 'HKCU:\Control Panel\Desktop'

# Every registry value Prism may change. Only these are backed up and restored.
$RegValues = @(
  @{ Path = $PersonalizeKey; Name = 'AppsUseLightTheme';    Type = 'DWord' },
  @{ Path = $PersonalizeKey; Name = 'SystemUsesLightTheme'; Type = 'DWord' },
  @{ Path = $PersonalizeKey; Name = 'EnableTransparency';   Type = 'DWord' },
  @{ Path = $DwmKey;         Name = 'AccentColor';          Type = 'DWord' },
  @{ Path = $DwmKey;         Name = 'ColorizationColor';    Type = 'DWord' },
  @{ Path = $AccentKey;      Name = 'AccentColorMenu';      Type = 'DWord' },
  @{ Path = $AdvancedKey;    Name = 'TaskbarAl';            Type = 'DWord' },
  @{ Path = $DesktopKey;     Name = 'WallpaperStyle';       Type = 'String' },
  @{ Path = $DesktopKey;     Name = 'TileWallpaper';        Type = 'String' }
)
$ManagedFiles = @($GlazeConfig)

# ---------------------------------------------------------------- output
function Write-Step([string]$m) { Write-Host "  > $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  + $m" -ForegroundColor Green }
function Write-Note([string]$m) { Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn([string]$m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# ---------------------------------------------------------------- helpers
function Get-Prop($Obj, [string]$Path, $Default = $null) {
  $cur = $Obj
  foreach ($p in $Path.Split('.')) {
    if ($null -eq $cur) { return $Default }
    $prop = $cur.PSObject.Properties[$p]
    if ($null -eq $prop) { return $Default }
    $cur = $prop.Value
  }
  if ($null -eq $cur) { return $Default }
  return $cur
}
function Set-Prop($Obj, [string]$Name, $Value) {
  if ($Obj.PSObject.Properties[$Name]) { $Obj.$Name = $Value } else { $Obj | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}
function Write-TextFile([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}
function Read-Json([string]$Path) { return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json }
function Test-Hex([string]$v) { return $v -match '^#[0-9a-fA-F]{6}$' }
function Resolve-Color($T, [string]$Value) {
  if (Test-Hex $Value) { return $Value.ToLower() }
  $c = Get-Prop $T "colors.$Value"
  if ($c -and (Test-Hex $c)) { return $c.ToLower() }
  throw "Theme '$($T.id)': unknown color '$Value'. Use #RRGGBB or a name from the colors section."
}
function Split-Rgb([string]$Hex) { return @([Convert]::ToInt32($Hex.Substring(1, 2), 16), [Convert]::ToInt32($Hex.Substring(3, 2), 16), [Convert]::ToInt32($Hex.Substring(5, 2), 16)) }

# ---------------------------------------------------------------- themes
function Get-ThemeList {
  $seen = @{}
  foreach ($dir in @($UserThemesDir, $ThemesDir)) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter '*.json' | Where-Object { $_.Name -ne 'schema.json' })) {
      if ($seen.ContainsKey($f.BaseName)) { continue }
      $seen[$f.BaseName] = $true
      try { $t = Read-Json $f.FullName } catch { continue }
      [pscustomobject]@{ Id = $f.BaseName; Name = $t.name; Yours = $(if ($dir -eq $UserThemesDir) { 'yes' } else { '' }); Description = $t.description }
    }
  }
}
function Test-Theme($T, [string]$Path) {
  $err = New-Object System.Collections.Generic.List[string]
  if (-not (Get-Prop $T 'id'))   { $err.Add('missing id') }
  if (-not (Get-Prop $T 'name')) { $err.Add('missing name') }
  if ((Get-Prop $T 'colors.mode') -notin @('dark', 'light')) { $err.Add('colors.mode must be "dark" or "light"') }
  foreach ($k in 'background', 'text', 'accent') { if (-not (Test-Hex (Get-Prop $T "colors.$k" ''))) { $err.Add("colors.$k must be a #RRGGBB color") } }
  $colors = Get-Prop $T 'colors'
  if ($colors) { foreach ($p in $colors.PSObject.Properties) { if ($p.Name -ne 'mode' -and -not (Test-Hex $p.Value)) { $err.Add("colors.$($p.Name) must be a #RRGGBB color") } } }
  $op = Get-Prop $T 'effects.opacity' 80
  if ($op -lt 0 -or $op -gt 100) { $err.Add('effects.opacity must be 0-100') }
  $wt = Get-Prop $T 'wallpaper.type' 'none'
  if ($wt -notin @('gradient', 'image', 'none')) { $err.Add('wallpaper.type: gradient, image or none') }
  if ($wt -eq 'gradient' -and @(Get-Prop $T 'wallpaper.colors' @()).Count -lt 2) { $err.Add('wallpaper.colors needs at least 2 colors') }
  if ($wt -eq 'image' -and -not (Get-Prop $T 'wallpaper.path')) { $err.Add('wallpaper.path is required for type=image') }
  if ((Get-Prop $T 'windows.corners' 'rounded') -notin @('rounded', 'small_rounded', 'square')) { $err.Add('windows.corners: rounded, small_rounded or square') }
  if ($err.Count -eq 0) {
    try {
      foreach ($c in @(Get-Prop $T 'wallpaper.colors' @())) { [void](Resolve-Color $T $c) }
      foreach ($k in 'focused', 'inactive') { $v = Get-Prop $T "windows.border.$k"; if ($v) { [void](Resolve-Color $T $v) } }
    } catch { $err.Add($_.Exception.Message) }
  }
  if ($err.Count) { throw "Problems in theme $Path`n  - " + ($err -join "`n  - ") }
}
function Read-Theme([string]$IdOrPath) {
  if (-not $IdOrPath) { throw 'Name a theme, e.g.: prism apply tiles   (see: prism list)' }
  if (Test-Path -LiteralPath $IdOrPath -PathType Leaf) { $path = (Resolve-Path -LiteralPath $IdOrPath).Path }
  else {
    $path = Join-Path $UserThemesDir "$IdOrPath.json"
    if (-not (Test-Path -LiteralPath $path)) { $path = Join-Path $ThemesDir "$IdOrPath.json" }
  }
  if (-not (Test-Path -LiteralPath $path)) { throw "There is no theme '$IdOrPath'. See: prism list" }
  $t = Read-Json $path
  Test-Theme $t $path
  Set-Prop $t '__dir' (Split-Path -Parent $path)
  Set-Prop $t '__path' $path
  return $t
}

# ---------------------------------------------------------------- Windows API
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

# ---------------------------------------------------------------- backup and restore
function Save-Backup {
  if (Test-Path $BackupFile) { Write-Note 'A backup of your original settings already exists; keeping it.'; return }
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  $reg = foreach ($r in $RegValues) { $v = Get-RegValue $r.Path $r.Name; [pscustomobject]@{ Path = $r.Path; Name = $r.Name; Type = $r.Type; Exists = ($null -ne $v); Value = $v } }
  $files = for ($i = 0; $i -lt $ManagedFiles.Count; $i++) {
    $target = $ManagedFiles[$i]; $copy = $null
    if (Test-Path -LiteralPath $target) { $copy = Join-Path $BackupDir ("file$i-" + (Split-Path -Leaf $target)); Copy-Item -LiteralPath $target -Destination $copy -Force }
    [pscustomobject]@{ Target = $target; Backup = $copy }
  }
  $backup = [pscustomobject]@{ Created = (Get-Date).ToString('o'); Registry = @($reg); Wallpaper = (Get-RegValue $DesktopKey 'WallPaper'); Files = @($files); GlazeWasRunning = [bool](Get-Process -Name glazewm -ErrorAction SilentlyContinue) }
  Write-TextFile $BackupFile ($backup | ConvertTo-Json -Depth 6)
  Write-Ok "Saved a backup of your original settings ($BackupFile)"
}
function Invoke-Restore {
  if (-not (Test-Path $BackupFile)) { Write-Warn 'There is no backup to restore: Prism has not changed anything yet, or it was already restored.'; return }
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
  Remove-Item -LiteralPath $CurrentFile -ErrorAction SilentlyContinue  # Prism turns the dock and menu bar off when this disappears
  Write-Ok 'Done. Some changes (like the taskbar color) may need you to sign out and back in.'
}

# ---------------------------------------------------------------- generators
function Get-WindowsPlan($T) {
  $rgb = Split-Rgb (Resolve-Color $T 'accent')
  $light = [int]((Get-Prop $T 'colors.mode') -eq 'light')
  # Windows stores the accent as ABGR and ColorizationColor as ARGB
  $abgr = [int64]0xFF000000L + $rgb[2] * 65536 + $rgb[1] * 256 + $rgb[0]
  $argb = [int64]0xC4000000L + $rgb[0] * 65536 + $rgb[1] * 256 + $rgb[2]
  $plan = [ordered]@{
    "$PersonalizeKey\AppsUseLightTheme" = $light; "$PersonalizeKey\SystemUsesLightTheme" = $light
    "$PersonalizeKey\EnableTransparency" = [int][bool](Get-Prop $T 'effects.transparency' $true)
    "$DwmKey\AccentColor" = $abgr; "$DwmKey\ColorizationColor" = $argb; "$AccentKey\AccentColorMenu" = $abgr
  }
  $align = Get-Prop $T 'taskbar.alignment'
  if ($align) { $plan["$AdvancedKey\TaskbarAl"] = [int]($align -eq 'center') }
  return $plan
}
function New-Wallpaper($T, [string]$OutPath) {
  $type = Get-Prop $T 'wallpaper.type' 'none'
  if ($type -eq 'none') { return $null }
  $dir = Split-Path -Parent $OutPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if ($type -eq 'image') {
    $p = Get-Prop $T 'wallpaper.path'
    $src = if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $T.__dir $p }
    if (-not (Test-Path -LiteralPath $src)) { throw "Wallpaper file not found: $src" }
    $dest = [IO.Path]::ChangeExtension($OutPath, [IO.Path]::GetExtension($src))
    Copy-Item -LiteralPath $src -Destination $dest -Force
    return $dest
  }
  Add-Type -AssemblyName System.Drawing
  $w = 3840; $h = 2160
  $colors = [System.Drawing.Color[]]@(@(Get-Prop $T 'wallpaper.colors') | ForEach-Object { [System.Drawing.ColorTranslator]::FromHtml((Resolve-Color $T $_)) })
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $w, $h
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $rect, $colors[0], $colors[$colors.Count - 1], ([single](Get-Prop $T 'wallpaper.angle' 90))
    if ($colors.Count -gt 2) {
      $blend = New-Object System.Drawing.Drawing2D.ColorBlend -ArgumentList $colors.Count
      $blend.Colors = $colors
      $blend.Positions = [single[]](0..($colors.Count - 1) | ForEach-Object { $_ / ($colors.Count - 1) })
      $brush.InterpolationColors = $blend
    }
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $g.Dispose(); $bmp.Dispose() }
  return $OutPath
}
function Get-PrismExe { $p = Join-Path $AppDir 'Prism.exe'; if (Test-Path -LiteralPath $p) { return $p }; return $null }
function New-GlazeConfig($T) {
  $q = { param($s) "'" + ([string]$s -replace "'", "''") + "'" }
  $inner = [int](Get-Prop $T 'windows.gaps.inner' 10)
  $outer = [int](Get-Prop $T 'windows.gaps.outer' 12)
  # GlazeWM tiles over the whole screen: leave room for the Prism menu bar and dock
  $top = $outer; $bottom = $outer
  if ([bool](Get-Prop $T 'bar.enabled' $false)) { $top += [int](Get-Prop $T 'bar.height' 30) }
  if ([bool](Get-Prop $T 'dock.enabled' $false) -and -not [bool](Get-Prop $T 'dock.autohide' $false)) { $bottom += [int](Get-Prop $T 'dock.iconSize' 48) + 22 }
  $border = ([string][bool](Get-Prop $T 'windows.border.enabled' $true)).ToLower()
  $focused = Resolve-Color $T (Get-Prop $T 'windows.border.focused' 'accent')
  $inactive = Resolve-Color $T (Get-Prop $T 'windows.border.inactive' 'background')
  $corners = Get-Prop $T 'windows.corners' 'rounded'
  $hideTitle = ([string][bool](Get-Prop $T 'windows.hideTitleBar' $false)).ToLower()
  $inOp = [int](Get-Prop $T 'windows.inactiveOpacity' 100)
  $fx = { param($color, $opacity)
@"
    border:
      enabled: $border
      color: $(& $q $color)
    hide_title_bar:
      enabled: $hideTitle
    corner_style:
      enabled: true
      style: $(& $q $corners)
    transparency:
      enabled: $(([string]($opacity -lt 100)).ToLower())
      opacity: '$opacity%'
"@ }
  $prism = Get-PrismExe
  $terminal = if ($prism) { "shell-exec `"$prism`"" } else { 'shell-exec wt' }
  $keys = New-Object System.Collections.Generic.List[string]
  $bind = { param([string[]]$cmds, [string[]]$keysIn) $keys.Add('  - commands: [' + (($cmds | ForEach-Object { & $q $_ }) -join ', ') + "]`n    bindings: [" + (($keysIn | ForEach-Object { & $q $_ }) -join ', ') + ']') }
  foreach ($d in @(@('left', 'h'), @('right', 'l'), @('up', 'k'), @('down', 'j'))) { & $bind @("focus --direction $($d[0])") @("alt+$($d[1])", "alt+$($d[0])"); & $bind @("move --direction $($d[0])") @("alt+shift+$($d[1])", "alt+shift+$($d[0])") }
  & $bind @('resize --width -2%') @('alt+u'); & $bind @('resize --width +2%') @('alt+p'); & $bind @('resize --height +2%') @('alt+o'); & $bind @('resize --height -2%') @('alt+i')
  & $bind @('wm-enable-binding-mode --name resize') @('alt+r'); & $bind @('wm-toggle-pause') @('alt+shift+p'); & $bind @('toggle-tiling-direction') @('alt+v')
  & $bind @('wm-cycle-focus') @('alt+space'); & $bind @('toggle-floating --centered') @('alt+shift+space'); & $bind @('toggle-tiling') @('alt+t')
  & $bind @('toggle-fullscreen') @('alt+f'); & $bind @('toggle-minimized') @('alt+m'); & $bind @('close') @('alt+shift+q'); & $bind @('wm-exit') @('alt+shift+e')
  & $bind @('wm-reload-config') @('alt+shift+r'); & $bind @('wm-redraw') @('alt+shift+w'); & $bind @($terminal) @('alt+enter')
  & $bind @('focus --next-active-workspace') @('alt+s'); & $bind @('focus --prev-active-workspace') @('alt+a'); & $bind @('focus --recent-workspace') @('alt+d')
  1..9 | ForEach-Object { & $bind @("focus --workspace $_") @("alt+$_") }
  1..9 | ForEach-Object { & $bind @("move --workspace $_", "focus --workspace $_") @("alt+shift+$_") }

@"
# Generated by Prism from the theme "$($T.name)". Change the theme and run: prism apply $($T.id)
general:
  startup_commands: []
  shutdown_commands: []
  config_reload_commands: []
  focus_follows_cursor: false
  toggle_workspace_on_refocus: false
  cursor_jump:
    enabled: true
    trigger: 'monitor_focus'
  hide_method: 'cloak'
  show_all_in_taskbar: false

gaps:
  scale_with_dpi: true
  inner_gap: '${inner}px'
  outer_gap:
    top: '${top}px'
    right: '${outer}px'
    bottom: '${bottom}px'
    left: '${outer}px'

window_effects:
  focused_window:
$(& $fx $focused 100)
  other_windows:
$(& $fx $inactive $inOp)

window_behavior:
  initial_state: 'tiling'
  state_defaults:
    floating:
      centered: true
      shown_on_top: false
    fullscreen:
      maximized: false
      shown_on_top: false

workspaces:
$((1..9 | ForEach-Object { "  - name: '$_'" }) -join "`n")

window_rules:
  - commands: ['ignore']
    match:
      # the Prism dock and menu bar
      - window_title: { regex: '^Prism (Dock|Menu Bar)$' }
      - window_process: { equals: 'zebar' }
      - window_title: { regex: '[Pp]icture.in.[Pp]icture' }
        window_class: { regex: 'Chrome_WidgetWin_1|MozillaDialogClass' }
      - window_process: { equals: 'PowerToys' }
        window_class: { regex: 'HwndWrapper\[PowerToys\.PowerAccent.*?\]' }
      - window_process: { equals: 'PowerToys' }
        window_title: { regex: '.*? - Peek' }

binding_modes:
  - name: 'resize'
    keybindings:
      - commands: ['resize --width -2%']
        bindings: ['h', 'left']
      - commands: ['resize --width +2%']
        bindings: ['l', 'right']
      - commands: ['resize --height +2%']
        bindings: ['k', 'up']
      - commands: ['resize --height -2%']
        bindings: ['j', 'down']
      - commands: ['wm-disable-binding-mode --name resize']
        bindings: ['escape', 'enter', 'alt+r']

keybindings:
$($keys -join "`n")
"@
}

# ---------------------------------------------------------------- GlazeWM
function Find-Glaze {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'glzr.io\GlazeWM\glazewm.exe'),
    (Join-Path $env:ProgramFiles 'glzr.io\glazewm.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\glzr.io\GlazeWM\glazewm.exe')
  )
  foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*') {
    Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'GlazeWM*' -and $_.InstallLocation } | ForEach-Object { $candidates += (Join-Path $_.InstallLocation 'glazewm.exe') }
  }
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}
function Install-Glaze {
  $exe = Find-Glaze
  if ($exe) { Write-Note "GlazeWM is installed ($exe)"; return $exe }
  if ($SkipInstall) { Write-Warn 'GlazeWM is not installed (skipped because of -SkipInstall)'; return $null }
  $ErrorActionPreference = 'Continue'  # winget and msiexec write to stderr
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Step 'Installing GlazeWM with winget (Windows may ask for permission)'
    & winget install --id glzr-io.GlazeWM -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | Out-Null
    $exe = Find-Glaze
    if ($exe) { return $exe }
    Write-Note "winget did not finish (code $LASTEXITCODE); downloading from GitHub instead"
  }
  try {
    Write-Step 'Downloading GlazeWM from GitHub'
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/glzr-io/glazewm/releases/latest' -UseBasicParsing -Headers @{ 'User-Agent' = 'Prism' }
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $asset = @($rel.assets | Where-Object { $_.name -match "^standalone-glazewm-v[\d.]+-$arch\.msi$" })[0]
    if (-not $asset) { throw 'no installer found in the latest GlazeWM release' }
    $msi = Join-Path ([IO.Path]::GetTempPath()) $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $msi -UseBasicParsing
    Write-Step 'Installing GlazeWM (Windows will ask for permission)'
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Verb RunAs -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "msiexec exit code $($p.ExitCode)" }
  } catch { Write-Warn "Could not install GlazeWM: $($_.Exception.Message)"; return $null }
  return (Find-Glaze)
}
function Start-Glaze([string]$Exe) {
  $cli = Join-Path (Split-Path -Parent $Exe) 'cli\glazewm.exe'
  if (Get-Process -Name glazewm -ErrorAction SilentlyContinue) {
    if (Test-Path -LiteralPath $cli) { $ErrorActionPreference = 'Continue'; & $cli command wm-reload-config 2>&1 | Out-Null; $ErrorActionPreference = 'Stop' }
    else { Stop-Process -Name glazewm -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800; Start-Process -FilePath $Exe -ArgumentList 'start' }
  } else { Start-Process -FilePath $Exe -ArgumentList 'start' }
}
function New-Shortcut([string]$Link, [string]$Target, [string]$Arguments = '') {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($Link); $s.TargetPath = $Target; $s.Arguments = $Arguments; $s.Save()
}

# ---------------------------------------------------------------- commands
function Invoke-Apply {
  $T = Read-Theme $Theme
  Write-Host ''
  Write-Host "  Prism: $($T.name)" -ForegroundColor White
  if ($T.description) { Write-Note $T.description }
  Write-Host ''
  $tiling = [bool](Get-Prop $T 'windows.tiling' $false)

  if ($DryRun) {
    $out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir)
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    Write-TextFile (Join-Path $out 'windows-registry.json') ((Get-WindowsPlan $T) | ConvertTo-Json)
    [void](New-Wallpaper $T (Join-Path $out 'wallpaper.png'))
    if ($tiling) { Write-TextFile (Join-Path $out 'glazewm.yaml') (New-GlazeConfig $T) }
    Write-Ok "Dry run: files written to $out (nothing on this PC changed)"
    return
  }
  if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Build -lt 22000) { throw 'Desktop themes need Windows 11.' }
  Save-Backup

  Write-Step 'Colors and mode'
  $plan = Get-WindowsPlan $T
  foreach ($k in $plan.Keys) { $i = $k.LastIndexOf('\'); Set-Reg $k.Substring(0, $i) $k.Substring($i + 1) 'DWord' $plan[$k] }

  $wp = New-Wallpaper $T (Join-Path $DataDir "wallpaper-$($T.id).png")
  if ($wp) { Write-Step 'Wallpaper'; Set-Reg $DesktopKey 'WallpaperStyle' 'String' '10'; Set-Reg $DesktopKey 'TileWallpaper' 'String' '0'; Set-Wallpaper $wp }

  if ($tiling) {
    Write-Step 'Window tiling (GlazeWM)'
    $exe = Install-Glaze
    if ($exe) {
      Write-TextFile $GlazeConfig (New-GlazeConfig $T)
      if (-not (Test-Path -LiteralPath $StartupLink)) { New-Shortcut $StartupLink $exe 'start' }
      Start-Glaze $exe
      Write-Ok 'Tiling is on. Alt+arrows move focus, Alt+1..9 switch workspaces, Alt+Enter opens Prism, Alt+Shift+E turns tiling off.'
    }
  } elseif (Test-Path -LiteralPath $StartupLink) {
    Remove-Item -LiteralPath $StartupLink -Force
    Stop-Process -Name glazewm -ErrorAction SilentlyContinue
    Write-Note 'This theme does not tile windows; stopped the tiling Prism had started.'
  }
  Send-SettingChange
  # Prism (the app) watches this file and applies the dock, menu bar and terminal colors
  Write-TextFile $CurrentFile ([pscustomobject]@{ id = $T.id; name = $T.name; path = $T.__path; applied = (Get-Date).ToString('o') } | ConvertTo-Json)
  if (-not (Get-PrismExe) -and ([bool](Get-Prop $T 'dock.enabled' $false) -or [bool](Get-Prop $T 'bar.enabled' $false))) { Write-Note 'The dock and menu bar appear when the Prism app is running.' }
  Write-Host ''
  Write-Ok "Applied $($T.name). Back to the original look: prism restore"
}
function Show-Status {
  if (Test-Path $CurrentFile) { $c = Read-Json $CurrentFile; Write-Ok "Active theme: $($c.name) ($($c.id)), since $($c.applied)" } else { Write-Note 'No Prism theme is active.' }
  if (Test-Path $BackupFile) { Write-Note "Backup of the original look: $BackupFile" }
  Write-Note ('Window tiling: ' + $(if (Get-Process -Name glazewm -ErrorAction SilentlyContinue) { 'running' } else { 'off' }))
}
function Invoke-Update {
  Write-Step 'Opening the updater in a new window (Prism will close for a moment)'
  $env:TERM_PROGRAM = $null
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', "irm $InstallUrl | iex"
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
      $a = Read-Host '  Remove Prism from this PC? The original Windows look is restored first. Type YES'
      if ($a -ne 'YES') { Write-Note 'Cancelled.'; return }
    }
    Write-Step 'Prism will close now; the uninstall finishes in a new window.'
    $env:TERM_PROGRAM = $null
    Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", 'uninstall', '-Force', '-Detached'
    return
  }
  if (-not $Force) {
    $a = Read-Host '  Remove Prism from this PC? The original Windows look is restored first. Type YES'
    if ($a -ne 'YES') { Write-Note 'Cancelled.'; return }
  }
  Stop-PrismApp
  if (Test-Path $BackupFile) { Invoke-Restore }
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Prism.lnk') -ErrorAction SilentlyContinue
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Get-ItemProperty $run -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties } | Where-Object { $_.Value -is [string] -and $_.Value -like "*$AppDir*" } | ForEach-Object { Remove-ItemProperty -Path $run -Name $_.Name -ErrorAction SilentlyContinue }
  Remove-FromUserPath $BinDir
  foreach ($d in $BinDir, $AppDir) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue } }
  Write-Ok 'Prism was removed.'
  Write-Note "Your themes and backups stay in $DataDir, and your config in $(Join-Path $env:USERPROFILE '.config\prism'). Delete those folders if you don't need them."
  if ($Detached) { Write-Note 'You can close this window.' }
}

switch ($Command) {
  { $_ -in 'list', 'themes' } { Get-ThemeList | Format-Table -AutoSize Id, Name, Yours, Description }
  'apply'     { Invoke-Apply }
  'restore'   { Invoke-Restore }
  'status'    { Show-Status }
  'update'    { Invoke-Update }
  'uninstall' { Invoke-Uninstall }
  default     { Get-Help $PSCommandPath -Detailed | Out-String | Write-Host }
}
