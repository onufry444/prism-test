# Prism: instalacja jedną komendą. Wklej w PowerShell (zwykłym, bez uprawnień administratora):
#
#   irm https://raw.githubusercontent.com/onufry444/prism/main/install.ps1 | iex
#
# Co robi: pobiera najnowsze wydanie z GitHuba, instaluje je w %LOCALAPPDATA%\Prism,
# dodaje komendę `prism` i skrót w menu Start, a potem uruchamia Prism.
# Nic nie zmienia w wyglądzie Windows, dopóki sam nie wybierzesz motywu.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  $repo = 'onufry444/prism'
  $zipUrl = if ($env:PRISM_ZIP) { $env:PRISM_ZIP } else { "https://github.com/$repo/releases/latest/download/Prism-win-x64.zip" }
  $root = Join-Path $env:LOCALAPPDATA 'Prism'
  $appDir = Join-Path $root 'app'
  $binDir = Join-Path $root 'bin'

  function Say([string]$m, [string]$c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }

  try {
    Write-Host ''
    Write-Host '  Prism' -ForegroundColor Magenta -NoNewline; Write-Host '  terminal i wygląd Windowsa w jednym' -ForegroundColor DarkGray
    Write-Host ''
    if ($env:OS -ne 'Windows_NT') { throw "Prism działa tylko w Windows." }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Prism wymaga 64-bitowego Windows.' }
    if ([Environment]::OSVersion.Version.Build -lt 22000) { Say "Uwaga: motywy systemu wymagają Windows 11. Sam terminal zadziała." 'Yellow' }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('prism-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      Say 'Pobieram najnowszą wersję...' 'Cyan'
      $zip = Join-Path $tmp 'prism.zip'
      if (Test-Path -LiteralPath $zipUrl) { Copy-Item -LiteralPath $zipUrl -Destination $zip }
      else { Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing }

      Say 'Rozpakowuję...' 'Cyan'
      $stage = Join-Path $tmp 'x'
      Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
      $exe = Get-ChildItem -LiteralPath $stage -Filter 'Prism.exe' -Recurse | Select-Object -First 1
      if (-not $exe) { throw 'W pobranej paczce nie ma Prism.exe.' }

      $running = @(Get-Process -Name Prism -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($appDir, [StringComparison]::OrdinalIgnoreCase) })
      if ($running.Count) { Say "Zamykam działający Prism..." 'Cyan'; $running | Stop-Process -Force; Start-Sleep -Milliseconds 900 }
      New-Item -ItemType Directory -Path $root -Force | Out-Null
      if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
      Copy-Item -LiteralPath $exe.DirectoryName -Destination $appDir -Recurse
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Komenda `prism` w każdym terminalu
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $cmd = @(
      '@echo off',
      'setlocal',
      'set "PRISM_APP=%LOCALAPPDATA%\Prism\app"',
      'if "%~1"=="" (start "" "%PRISM_APP%\Prism.exe" & exit /b 0)',
      'if /i "%~1"=="settings" (start "" "%PRISM_APP%\Prism.exe" --settings & exit /b 0)',
      'if /i "%~1"=="ustawienia" (start "" "%PRISM_APP%\Prism.exe" --settings & exit /b 0)',
      'powershell -NoProfile -ExecutionPolicy Bypass -File "%PRISM_APP%\engine\installer\prism.ps1" %*'
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $binDir 'prism.cmd'), $cmd + "`r`n", (New-Object System.Text.ASCIIEncoding))

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $cur = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $parts = @($cur -split ';' | Where-Object { $_ })
      if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $binDir })) {
        $key.SetValue('Path', ((@($parts) + $binDir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
      }
    } finally { $key.Close() }
    [Environment]::SetEnvironmentVariable('PRISM_INSTALLED', '1', 'User')  # powiadamia Windows o nowej ścieżce
    if (($env:Path -split ';') -notcontains $binDir) { $env:Path = "$env:Path;$binDir" }

    # Skrót w menu Start
    $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Prism.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $appDir 'Prism.exe'
    $s.WorkingDirectory = $env:USERPROFILE
    $s.Description = 'Prism: terminal i wygląd Windowsa'
    $s.Save()

    Write-Host ''
    Say 'Gotowe! Prism jest zainstalowany.' 'Green'
    Say 'Uruchomisz go z menu Start albo komendą:  prism'
    Say 'W Prism wpisz  settings  żeby zmienić wygląd Windowsa.'
    Say 'Aktualizacja: prism update    Usunięcie: prism uninstall' 'DarkGray'
    Write-Host ''
    if (-not $env:PRISM_NO_LAUNCH) { Start-Process -FilePath (Join-Path $appDir 'Prism.exe') }
  } catch {
    Write-Host ''
    Say "Instalacja nie powiodła się: $($_.Exception.Message)" 'Red'
    Say "Zgłoś problem: https://github.com/$repo/issues" 'DarkGray'
    Write-Host ''
  }
}
