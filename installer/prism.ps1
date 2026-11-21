#Requires -Version 5.1
<#
.SYNOPSIS
  Prism: jeden plik motywu zmienia wygląd całego Windowsa 11.

.DESCRIPTION
  prism list                         lista motywów
  prism apply <motyw|plik.json>      zastosuj motyw (pierwszy raz robi kopię oryginalnych ustawień)
  prism apply <motyw> -DryRun        tylko wygeneruj pliki do folderu -OutDir, niczego nie zmieniaj
  prism restore                      przywróć oryginalny wygląd z kopii
  prism status                       co jest teraz włączone
  prism update                       aktualizacja Prism do najnowszej wersji
  prism uninstall                    usuwa Prism (najpierw przywraca oryginalny wygląd)

.PARAMETER SkipInstall
  Nie instaluj brakujących programów (GlazeWM, Windhawk) przez winget.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('list', 'apply', 'restore', 'status', 'update', 'uninstall', 'help')][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Theme,
  [switch]$SkipInstall,
  [switch]$DryRun,
  [switch]$Force,
  [string]$OutDir = 'prism-out'
)

$ErrorActionPreference = 'Stop'
# Gdy wynik czyta inny program (np. ustawienia Prism), wysyłaj go w UTF-8, żeby polskie znaki dotarły poprawnie.
if ([Console]::IsOutputRedirected) { try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {} }
$Root      = Split-Path -Parent $PSScriptRoot
$ThemesDir = Join-Path $Root 'themes'
$DataDir   = Join-Path $env:LOCALAPPDATA 'Prism'
$BackupDir = Join-Path $DataDir 'backup'
$BackupFile  = Join-Path $DataDir 'backup.json'
$CurrentFile = Join-Path $DataDir 'current.json'
$UserThemesDir = Join-Path $DataDir 'themes'
$AppDir      = Join-Path $DataDir 'app'
$BinDir      = Join-Path $DataDir 'bin'
$InstallUrl  = 'https://raw.githubusercontent.com/onufry444/prism/main/install.ps1'
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

$GlazeConfig    = Join-Path $env:USERPROFILE '.glzr\glazewm\config.yaml'
$GlazeExe       = Join-Path $env:ProgramFiles 'glzr.io\glazewm.exe'
$GlazeCli       = Join-Path $env:ProgramFiles 'glzr.io\cli\glazewm.exe'
$TerminalConfig = Join-Path $env:APPDATA 'Prism\settings.json'
$StartupLink    = Join-Path ([Environment]::GetFolderPath('Startup')) 'Prism GlazeWM.lnk'

$PersonalizeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$DwmKey         = 'HKCU:\Software\Microsoft\Windows\DWM'
$AccentKey      = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent'
$AdvancedKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$DesktopKey     = 'HKCU:\Control Panel\Desktop'

# Każda wartość rejestru, którą Prism może zmienić. Tylko te trafiają do kopii i są przywracane.
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
$ManagedFiles = @($GlazeConfig, $TerminalConfig)

# ---------------------------------------------------------------- wypisywanie
function Write-Step([string]$m) { Write-Host "  > $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "  + $m" -ForegroundColor Green }
function Write-Note([string]$m) { Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn([string]$m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# ---------------------------------------------------------------- narzędzia
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
  if ($Obj.PSObject.Properties[$Name]) { $Obj.$Name = $Value }
  else { $Obj | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}

function Write-TextFile([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function Read-Json([string]$Path) {
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Test-Hex([string]$v) { return $v -match '^#[0-9a-fA-F]{6}$' }

function Resolve-Color($T, [string]$Value) {
  if (Test-Hex $Value) { return $Value.ToLower() }
  $c = Get-Prop $T "colors.$Value"
  if ($c -and (Test-Hex $c)) { return $c.ToLower() }
  throw "Motyw '$($T.id)': nie znam koloru '$Value'. Użyj #RRGGBB albo nazwy z sekcji colors."
}

function Split-Rgb([string]$Hex) {
  return @([Convert]::ToInt32($Hex.Substring(1, 2), 16), [Convert]::ToInt32($Hex.Substring(3, 2), 16), [Convert]::ToInt32($Hex.Substring(5, 2), 16))
}

# ---------------------------------------------------------------- motywy
function Get-ThemeList {
  $seen = @{}
  foreach ($dir in @($UserThemesDir, $ThemesDir)) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter '*.json' | Where-Object { $_.Name -ne 'schema.json' })) {
      if ($seen.ContainsKey($f.BaseName)) { continue }
      $seen[$f.BaseName] = $true
      try { $t = Read-Json $f.FullName } catch { continue }
      [pscustomobject]@{ Id = $f.BaseName; Name = $t.name; Own = ($dir -eq $UserThemesDir); Description = $t.description }
    }
  }
}

function Test-Theme($T, [string]$Path) {
  $err = New-Object System.Collections.Generic.List[string]
  if (-not (Get-Prop $T 'id'))   { $err.Add('brak pola id') }
  if (-not (Get-Prop $T 'name')) { $err.Add('brak pola name') }
  $mode = Get-Prop $T 'colors.mode'
  if ($mode -notin @('dark', 'light')) { $err.Add('colors.mode musi być "dark" albo "light"') }
  foreach ($k in 'background', 'text', 'accent') {
    if (-not (Test-Hex (Get-Prop $T "colors.$k" ''))) { $err.Add("colors.$k musi być kolorem #RRGGBB") }
  }
  $colors = Get-Prop $T 'colors'
  if ($colors) {
    foreach ($p in $colors.PSObject.Properties) {
      if ($p.Name -ne 'mode' -and -not (Test-Hex $p.Value)) { $err.Add("colors.$($p.Name) musi być kolorem #RRGGBB") }
    }
  }
  $op = Get-Prop $T 'effects.opacity' 80
  if ($op -lt 0 -or $op -gt 100) { $err.Add('effects.opacity musi być od 0 do 100') }
  $wt = Get-Prop $T 'wallpaper.type' 'none'
  if ($wt -notin @('gradient', 'image', 'none')) { $err.Add('wallpaper.type: gradient, image albo none') }
  if ($wt -eq 'gradient' -and @(Get-Prop $T 'wallpaper.colors' @()).Count -lt 2) { $err.Add('wallpaper.colors potrzebuje co najmniej 2 kolorów') }
  if ($wt -eq 'image' -and -not (Get-Prop $T 'wallpaper.path')) { $err.Add('wallpaper.path jest wymagane dla type=image') }
  $corners = Get-Prop $T 'windows.corners' 'rounded'
  if ($corners -notin @('rounded', 'small_rounded', 'square')) { $err.Add('windows.corners: rounded, small_rounded albo square') }
  if ($err.Count -eq 0) {
    # kolory podane nazwą muszą istnieć
    try {
      foreach ($c in @(Get-Prop $T 'wallpaper.colors' @())) { [void](Resolve-Color $T $c) }
      foreach ($k in 'focused', 'inactive') { $v = Get-Prop $T "windows.border.$k"; if ($v) { [void](Resolve-Color $T $v) } }
    } catch { $err.Add($_.Exception.Message) }
  }
  if ($err.Count) { throw "Błędy w motywie $Path`n  - " + ($err -join "`n  - ") }
}

function Read-Theme([string]$IdOrPath) {
  if (-not $IdOrPath) { throw 'Podaj motyw, np.: prism apply kafel   (lista: prism list)' }
  if (Test-Path -LiteralPath $IdOrPath -PathType Leaf) { $path = (Resolve-Path -LiteralPath $IdOrPath).Path }
  else {
    $path = Join-Path $UserThemesDir "$IdOrPath.json"
    if (-not (Test-Path -LiteralPath $path)) { $path = Join-Path $ThemesDir "$IdOrPath.json" }
  }
  if (-not (Test-Path -LiteralPath $path)) { throw "Nie ma motywu '$IdOrPath'. Lista: prism list" }
  $t = Read-Json $path
  Test-Theme $t $path
  Set-Prop $t '__dir' (Split-Path -Parent $path)
  return $t
}

# ---------------------------------------------------------------- system (WinAPI)
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
  foreach ($area in 'ImmersiveColorSet', 'WindowsThemeElement', 'TraySettings') {
    [void][Prism.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, $area, 2, 3000, [ref]$r)
  }
}

function Set-Wallpaper([string]$Path) {
  Initialize-Native
  # SPI_SETDESKWALLPAPER = 20, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
  if (-not [Prism.Native]::SystemParametersInfo(20, 0, $Path, 3)) { Write-Warn "Nie udało się ustawić tapety: $Path" }
}

function Set-Reg([string]$Path, [string]$Name, [string]$Type, $Value) {
  if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
  if ($Type -eq 'DWord') {
    # DWORD w rejestrze to 32 bity; wartości powyżej 0x7FFFFFFF trzeba podać jako ujemny Int32
    $Value = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]([int64]$Value -band 0xFFFFFFFFL)), 0)
  }
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}

function Get-RegValue([string]$Path, [string]$Name) {
  $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  return $item.$Name
}

# ---------------------------------------------------------------- kopia i przywracanie
function Save-Backup {
  if (Test-Path $BackupFile) { Write-Note 'Kopia oryginalnych ustawień już jest, zostawiam ją bez zmian.'; return }
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  $reg = foreach ($r in $RegValues) {
    $v = Get-RegValue $r.Path $r.Name
    [pscustomobject]@{ Path = $r.Path; Name = $r.Name; Type = $r.Type; Exists = ($null -ne $v); Value = $v }
  }
  $files = for ($i = 0; $i -lt $ManagedFiles.Count; $i++) {
    $target = $ManagedFiles[$i]; $copy = $null
    if (Test-Path -LiteralPath $target) { $copy = Join-Path $BackupDir ("file$i-" + (Split-Path -Leaf $target)); Copy-Item -LiteralPath $target -Destination $copy -Force }
    [pscustomobject]@{ Target = $target; Backup = $copy }
  }
  $backup = [pscustomobject]@{
    Created    = (Get-Date).ToString('o')
    Registry   = @($reg)
    Wallpaper  = (Get-RegValue $DesktopKey 'WallPaper')
    Files      = @($files)
    GlazeWasRunning = [bool](Get-Process -Name glazewm -ErrorAction SilentlyContinue)
  }
  Write-TextFile $BackupFile ($backup | ConvertTo-Json -Depth 6)
  Write-Ok "Zapisano kopię oryginalnych ustawień ($BackupFile)"
}

function Invoke-Restore {
  if (-not (Test-Path $BackupFile)) { Write-Warn 'Nie ma kopii do przywrócenia. Prism nic jeszcze nie zmienił albo kopia została już użyta.'; return }
  $b = Read-Json $BackupFile
  Write-Step 'Przywracam ustawienia Windowsa'
  foreach ($r in @($b.Registry)) {
    if ($r.Exists) { Set-Reg $r.Path $r.Name $r.Type $r.Value }
    else { Remove-ItemProperty -Path $r.Path -Name $r.Name -ErrorAction SilentlyContinue }
  }
  Write-Step 'Przywracam pliki konfiguracji'
  foreach ($f in @($b.Files)) {
    if ($f.Backup -and (Test-Path -LiteralPath $f.Backup)) { Copy-Item -LiteralPath $f.Backup -Destination $f.Target -Force }
    elseif (Test-Path -LiteralPath $f.Target) { Remove-Item -LiteralPath $f.Target -Force }
  }
  if (Test-Path -LiteralPath $StartupLink) {
    Remove-Item -LiteralPath $StartupLink -Force
    if (-not $b.GlazeWasRunning) { Stop-Process -Name glazewm -ErrorAction SilentlyContinue }
    Write-Ok 'Wyłączono autostart GlazeWM dodany przez Prism'
  }
  if ($b.Wallpaper) { Set-Wallpaper $b.Wallpaper }
  Send-SettingChange
  Move-Item -LiteralPath $BackupFile -Destination (Join-Path $DataDir ("backup-przywrocona-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) -Force
  Remove-Item -LiteralPath $CurrentFile -ErrorAction SilentlyContinue
  Write-Ok 'Gotowe. Część zmian (np. kolor paska zadań) może wymagać wylogowania.'
}

# ---------------------------------------------------------------- generatory
function Get-WindowsPlan($T) {
  $rgb = Split-Rgb (Resolve-Color $T 'accent')
  $light = [int]((Get-Prop $T 'colors.mode') -eq 'light')
  # Windows zapisuje akcent jako ABGR, a ColorizationColor jako ARGB
  $abgr = [int64]0xFF000000L + $rgb[2] * 65536 + $rgb[1] * 256 + $rgb[0]
  $argb = [int64]0xC4000000L + $rgb[0] * 65536 + $rgb[1] * 256 + $rgb[2]
  $plan = [ordered]@{
    "$PersonalizeKey\AppsUseLightTheme"    = $light
    "$PersonalizeKey\SystemUsesLightTheme" = $light
    "$PersonalizeKey\EnableTransparency"   = [int][bool](Get-Prop $T 'effects.transparency' $true)
    "$DwmKey\AccentColor"                  = $abgr
    "$DwmKey\ColorizationColor"            = $argb
    "$AccentKey\AccentColorMenu"           = $abgr
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
    $src = Join-Path $T.__dir (Get-Prop $T 'wallpaper.path')
    if (-not (Test-Path -LiteralPath $src)) { throw "Nie ma pliku tapety: $src" }
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

function New-GlazeConfig($T) {
  $q = { param($s) "'" + ([string]$s -replace "'", "''") + "'" }
  $inner = Get-Prop $T 'windows.gaps.inner' 10
  $outer = Get-Prop $T 'windows.gaps.outer' 12
  $border = [bool](Get-Prop $T 'windows.border.enabled' $true)
  $focused = Resolve-Color $T (Get-Prop $T 'windows.border.focused' 'accent')
  $inactive = Resolve-Color $T (Get-Prop $T 'windows.border.inactive' 'background')
  $corners = Get-Prop $T 'windows.corners' 'rounded'
  $hideTitle = ([string][bool](Get-Prop $T 'windows.hideTitleBar' $false)).ToLower()
  $inOp = [int](Get-Prop $T 'windows.inactiveOpacity' 100)
  $b = ([string]$border).ToLower()
  $fx = { param($color, $opacity)
@"
    border:
      enabled: $b
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

  $keys = New-Object System.Collections.Generic.List[string]
  $bind = { param([string[]]$cmds, [string[]]$keysIn) $keys.Add("  - commands: [" + (($cmds | ForEach-Object { & $q $_ }) -join ', ') + "]`n    bindings: [" + (($keysIn | ForEach-Object { & $q $_ }) -join ', ') + "]") }
  $dirs = @(@('left', 'h'), @('right', 'l'), @('up', 'k'), @('down', 'j'))
  foreach ($d in $dirs) { & $bind @("focus --direction $($d[0])") @("alt+$($d[1])", "alt+$($d[0])") }
  foreach ($d in $dirs) { & $bind @("move --direction $($d[0])") @("alt+shift+$($d[1])", "alt+shift+$($d[0])") }
  & $bind @('resize --width -2%') @('alt+u');  & $bind @('resize --width +2%') @('alt+p')
  & $bind @('resize --height +2%') @('alt+o'); & $bind @('resize --height -2%') @('alt+i')
  & $bind @('wm-enable-binding-mode --name resize') @('alt+r')
  & $bind @('wm-toggle-pause') @('alt+shift+p')
  & $bind @('toggle-tiling-direction') @('alt+v')
  & $bind @('wm-cycle-focus') @('alt+space')
  & $bind @('toggle-floating --centered') @('alt+shift+space')
  & $bind @('toggle-tiling') @('alt+t')
  & $bind @('toggle-fullscreen') @('alt+f')
  & $bind @('toggle-minimized') @('alt+m')
  & $bind @('close') @('alt+shift+q')
  & $bind @('wm-exit') @('alt+shift+e')
  & $bind @('wm-reload-config') @('alt+shift+r')
  & $bind @('wm-redraw') @('alt+shift+w')
  & $bind @('shell-exec wt') @('alt+enter')
  & $bind @('focus --next-active-workspace') @('alt+s')
  & $bind @('focus --prev-active-workspace') @('alt+a')
  & $bind @('focus --recent-workspace') @('alt+d')
  1..9 | ForEach-Object { & $bind @("focus --workspace $_") @("alt+$_") }
  1..9 | ForEach-Object { & $bind @("move --workspace $_", "focus --workspace $_") @("alt+shift+$_") }

@"
# Wygenerowane przez Prism z motywu "$($T.name)". Zmiany zrób w motywie i uruchom: prism apply $($T.id)
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
    top: '${outer}px'
    right: '${outer}px'
    bottom: '${outer}px'
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

function Update-TerminalSettings($T, [string]$Path) {
  $settings = [pscustomobject]@{}
  if (Test-Path -LiteralPath $Path) {
    try { $settings = Read-Json $Path } catch { Write-Warn "Nie mogę odczytać $Path, tworzę nowe ustawienia terminala." }
  }
  $look = Get-Prop $settings 'look'
  if (-not $look) { $look = [pscustomobject]@{}; Set-Prop $settings 'look' $look }
  $mono = Get-Prop $T 'fonts.mono' 'Cascadia Code'
  $values = [ordered]@{
    preset = $null
    opacity = [int](Get-Prop $T 'effects.opacity' 80)
    bg = Resolve-Color $T 'background'
    fg = Resolve-Color $T 'text'
    accent = Resolve-Color $T 'accent'
    ansi = Get-Prop $T 'terminal.ansi' (Get-Prop $T 'colors.mode')
    font = "`"$mono`", Consolas, monospace"
    size = [int](Get-Prop $T 'fonts.size' 14)
    radius = [int](Get-Prop $T 'effects.radius' 12)
  }
  foreach ($k in $values.Keys) { Set-Prop $look $k $values[$k] }
  Set-Prop $settings 'desktopBlur' ([bool](Get-Prop $T 'effects.blur' $true))
  Write-TextFile $Path ($settings | ConvertTo-Json -Depth 10)
}

# ---------------------------------------------------------------- programy
function Install-Tool([string]$Id, [string]$Label) {
  # winget pisze na stderr; w Windows PowerShell 5.1 przy 'Stop' to by przerwało skrypt
  $ErrorActionPreference = 'Continue'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Write-Warn "Brak winget. Zainstaluj $Label ręcznie (id: $Id)."; return $false }
  $found = (& winget list --id $Id -e --accept-source-agreements 2>$null | Out-String)
  if ($found -match [regex]::Escape($Id)) { Write-Note "$Label jest już zainstalowany"; return $true }
  if ($SkipInstall) { Write-Warn "$Label nie jest zainstalowany (pominięto przez -SkipInstall)"; return $false }
  Write-Step "Instaluję $Label (winget)"
  & winget install --id $Id -e --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -eq -1978335189) { return $true }  # APPINSTALLER_CLI_ERROR_PACKAGE_ALREADY_INSTALLED
  if ($LASTEXITCODE -ne 0) { Write-Warn "Instalacja $Label nie powiodła się (kod $LASTEXITCODE)"; return $false }
  return $true
}

function New-Shortcut([string]$Link, [string]$Target) {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($Link); $s.TargetPath = $Target; $s.Save()
}

# ---------------------------------------------------------------- komendy
function Invoke-Apply {
  $T = Read-Theme $Theme
  Write-Host ''
  Write-Host "  Prism: $($T.name)" -ForegroundColor White
  if ($T.description) { Write-Note $T.description }
  Write-Host ''
  $tiling = [bool](Get-Prop $T 'windows.tiling' $false)
  $termOn = [bool](Get-Prop $T 'terminal.enabled' $true)
  $wh = Get-Prop $T 'taskbar.windhawk'

  if ($DryRun) {
    $out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir)
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    Write-TextFile (Join-Path $out 'windows-registry.json') ((Get-WindowsPlan $T) | ConvertTo-Json)
    $wp = New-Wallpaper $T (Join-Path $out 'wallpaper.png')
    if ($tiling) { Write-TextFile (Join-Path $out 'glazewm.yaml') (New-GlazeConfig $T) }
    if ($termOn) { Update-TerminalSettings $T (Join-Path $out 'terminal-settings.json') }
    Write-Ok "Próba: pliki zapisane w $out (system nie został zmieniony)"
    return
  }

  if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Build -lt 22000) { throw 'Prism wymaga Windows 11.' }
  Save-Backup

  Write-Step 'Ustawiam kolory i tryb Windowsa'
  $plan = Get-WindowsPlan $T
  foreach ($k in $plan.Keys) {
    $i = $k.LastIndexOf('\')
    Set-Reg $k.Substring(0, $i) $k.Substring($i + 1) 'DWord' $plan[$k]
  }

  $wpPath = New-Wallpaper $T (Join-Path $DataDir "wallpaper-$($T.id).png")
  if ($wpPath) {
    Write-Step 'Ustawiam tapetę'
    Set-Reg $DesktopKey 'WallpaperStyle' 'String' '10'
    Set-Reg $DesktopKey 'TileWallpaper' 'String' '0'
    Set-Wallpaper $wpPath
  }

  if ($tiling) {
    Write-Step 'Kafelkowanie okien (GlazeWM)'
    if (Install-Tool 'glzr-io.GlazeWM' 'GlazeWM') {
      Write-TextFile $GlazeConfig (New-GlazeConfig $T)
      if (Test-Path -LiteralPath $GlazeExe) {
        if (-not (Test-Path -LiteralPath $StartupLink)) { New-Shortcut $StartupLink $GlazeExe }
        if ((Get-Process -Name glazewm -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $GlazeCli)) {
          $ErrorActionPreference = 'Continue'; & $GlazeCli command wm-reload-config 2>$null | Out-Null; $ErrorActionPreference = 'Stop'
        }
        elseif (-not (Get-Process -Name glazewm -ErrorAction SilentlyContinue)) { Start-Process -FilePath $GlazeExe }
        Write-Ok 'GlazeWM działa. Alt+strzałki zmieniają okno, Alt+1..9 pulpity, Alt+Shift+E wyłącza.'
      } else { Write-Warn "Nie znalazłem $GlazeExe. Uruchom GlazeWM z menu Start." }
    }
  } elseif (Test-Path -LiteralPath $StartupLink) {
    Remove-Item -LiteralPath $StartupLink -Force
    Stop-Process -Name glazewm -ErrorAction SilentlyContinue
    Write-Note 'Ten motyw nie używa kafelkowania, wyłączyłem GlazeWM uruchomiony przez Prism.'
  }

  if ($termOn) {
    Write-Step 'Motyw Szkło Terminala'
    Update-TerminalSettings $T $TerminalConfig
    Write-Note 'Kolory terminala zmienią się od razu, rozmycie po ponownym uruchomieniu Prism.'
  }

  Send-SettingChange
  Write-TextFile $CurrentFile ([pscustomobject]@{ id = $T.id; name = $T.name; applied = (Get-Date).ToString('o') } | ConvertTo-Json)

  if ($wh) {
    $tb = Get-Prop $wh 'taskbarStyler'; $sm = Get-Prop $wh 'startMenuStyler'
    if (Install-Tool 'RamenSoftware.Windhawk' 'Windhawk') {
      Write-Host ''
      Write-Host '  Ostatni krok ręcznie (w etapie 4 Prism zrobi to sam):' -ForegroundColor White
      Write-Note '1. Otwórz Windhawk'
      if ($tb) { Write-Note "2. Zainstaluj mod 'Windows 11 Taskbar Styler', w ustawieniach wybierz motyw: $tb" }
      if ($sm) { Write-Note "3. Zainstaluj mod 'Windows 11 Start Menu Styler', w ustawieniach wybierz motyw: $sm" }
    }
  }
  Write-Host ''
  Write-Ok "Motyw $($T.name) zastosowany. Powrót do oryginału: prism restore"
}

function Show-Status {
  if (Test-Path $CurrentFile) { $c = Read-Json $CurrentFile; Write-Ok "Aktywny motyw: $($c.name) ($($c.id)), od $($c.applied)" } else { Write-Note 'Żaden motyw Prism nie jest aktywny.' }
  if (Test-Path $BackupFile) { Write-Note "Kopia oryginału: $BackupFile" }
  Write-Note ("GlazeWM: " + $(if (Get-Process -Name glazewm -ErrorAction SilentlyContinue) { 'działa' } else { 'nie działa' }))
}

function Invoke-Update {
  Write-Step 'Otwieram aktualizację w osobnym oknie (Prism zostanie na chwilę zamknięty)'
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
      [Environment]::SetEnvironmentVariable('PRISM_INSTALLED', $null, 'User')  # wysyła WM_SETTINGCHANGE
    }
  } finally { $key.Close() }
}

function Invoke-Uninstall {
  if ($env:TERM_PROGRAM -eq 'Prism') {
    Write-Step 'Prism nie usunie sam siebie od środka. Otwieram dezinstalację w osobnym oknie.'
    $a2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $PSCommandPath, 'uninstall')
    if ($Force) { $a2 += '-Force' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $a2
    return
  }
  if (-not $Force) {
    $a = Read-Host '  Usunąć Prism z tego komputera? Najpierw przywrócę oryginalny wygląd Windows. Wpisz TAK'
    if ($a -ne 'TAK') { Write-Note 'Anulowano.'; return }
  }
  if (Test-Path $BackupFile) { Invoke-Restore }
  Get-Process -Name Prism -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($AppDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
  Start-Sleep -Milliseconds 600
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Prism.lnk') -ErrorAction SilentlyContinue
  Remove-FromUserPath $BinDir
  foreach ($d in $BinDir, $AppDir) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }
  Write-Ok 'Prism został usunięty.'
  if (Test-Path -LiteralPath $DataDir) { Write-Note "Twoje motywy i kopie ustawień zostały w $DataDir. Możesz usunąć ten folder ręcznie." }
}

switch ($Command) {
  'list'    { Get-ThemeList | Format-Table -AutoSize Id, Name, @{ n = 'Twój'; e = { if ($_.Own) { 'tak' } else { '' } } }, Description }
  'apply'   { Invoke-Apply }
  'restore' { Invoke-Restore }
  'status'  { Show-Status }
  'update'  { Invoke-Update }
  'uninstall' { Invoke-Uninstall }
  default   { Get-Help $PSCommandPath -Detailed | Out-String | Write-Host }
}
