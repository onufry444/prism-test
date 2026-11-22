# Prism installer. Paste into PowerShell (no admin rights needed):
#
#   irm https://raw.githubusercontent.com/onufry444/prism/main/install.ps1 | iex
#
# Downloads the latest release from GitHub, installs it in %LOCALAPPDATA%\Prism, adds the `prism` command
# and a Start menu shortcut, then starts Prism. Nothing else on your PC changes; `prism uninstall` removes it all.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  # PRISM_REPO=owner/name installs from another copy of the repository (for testing)
  $repo = if ($env:PRISM_REPO -match '^[\w.-]+/[\w.-]+$') { $env:PRISM_REPO } else { 'onufry444/prism' }
  $zipUrl = if ($env:PRISM_ZIP) { $env:PRISM_ZIP } else { "https://github.com/$repo/releases/latest/download/Prism-win-x64.zip" }
  $root = Join-Path $env:LOCALAPPDATA 'Prism'
  $appDir = Join-Path $root 'app'
  $binDir = Join-Path $root 'bin'

  function Say([string]$m, [string]$c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }

  try {
    Write-Host ''
    Write-Host '  Prism' -ForegroundColor Magenta -NoNewline; Write-Host '  one terminal for PowerShell, cmd and bash' -ForegroundColor DarkGray
    Write-Host ''
    if ($env:OS -ne 'Windows_NT') { throw 'Prism runs on Windows.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Prism needs 64-bit Windows.' }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('prism-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      Say 'Downloading the latest version...' 'Cyan'
      $zip = Join-Path $tmp 'prism.zip'
      if (Test-Path -LiteralPath $zipUrl) { Copy-Item -LiteralPath $zipUrl -Destination $zip } else { Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing }

      Say 'Unpacking...' 'Cyan'
      $stage = Join-Path $tmp 'x'
      Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
      $exe = Get-ChildItem -LiteralPath $stage -Filter 'Prism.exe' -Recurse | Select-Object -First 1
      if (-not $exe) { throw 'The download does not contain Prism.exe.' }

      $running = @(Get-Process -Name Prism -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($appDir, [StringComparison]::OrdinalIgnoreCase) })
      if ($running.Count) {
        Say 'Closing the running Prism...' 'Cyan'
        # ask nicely first, so Prism can put the taskbar back
        $inbox = Join-Path $env:APPDATA 'Prism\inbox'
        if (Test-Path -LiteralPath $inbox) { [IO.File]::WriteAllText((Join-Path $inbox 'install-quit.msg'), "quit;`n") }
        for ($i = 0; $i -lt 30 -and @(Get-Process -Id $running.Id -ErrorAction SilentlyContinue).Count; $i++) { Start-Sleep -Milliseconds 200 }
        Get-Process -Id $running.Id -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 600
      }
      New-Item -ItemType Directory -Path $root -Force | Out-Null
      if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
      Copy-Item -LiteralPath $exe.DirectoryName -Destination $appDir -Recurse
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    # the `prism` command in every terminal
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $cmd = @(
      '@echo off',
      'setlocal',
      'set "PRISM_APP=%LOCALAPPDATA%\Prism\app"',
      'if "%~1"=="" (start "" "%PRISM_APP%\Prism.exe" & exit /b 0)',
      'if /i "%~1"=="settings" (start "" "%PRISM_APP%\Prism.exe" --settings & exit /b 0)',
      'if /i "%~1"=="open" (start "" "%PRISM_APP%\Prism.exe" & exit /b 0)',
      # `(goto) 2>nul` ends this .cmd before PowerShell starts (the rest of the line is already read),
      # so `prism uninstall` can delete this file without cmd complaining.
      '(goto) 2>nul & powershell -NoProfile -ExecutionPolicy Bypass -File "%PRISM_APP%\engine\installer\prism.ps1" %*'
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $binDir 'prism.cmd'), $cmd + "`r`n", (New-Object System.Text.ASCIIEncoding))
    # prism update uses the same repository
    [IO.File]::WriteAllText((Join-Path $root 'repo.txt'), $repo, (New-Object System.Text.ASCIIEncoding))

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $cur = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $parts = @($cur -split ';' | Where-Object { $_ })
      if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $binDir })) { $key.SetValue('Path', ((@($parts) + $binDir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString) }
    } finally { $key.Close() }
    [Environment]::SetEnvironmentVariable('PRISM_INSTALLED', '1', 'User')  # tells Windows about the new PATH
    if (($env:Path -split ';') -notcontains $binDir) { $env:Path = "$env:Path;$binDir" }

    # Start menu shortcut
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Prism.lnk'))
    $s.TargetPath = Join-Path $appDir 'Prism.exe'
    $s.WorkingDirectory = $env:USERPROFILE
    $s.Description = 'Prism terminal'
    $s.Save()

    Write-Host ''
    Say 'Prism is installed.' 'Green'
    Say 'Open it from the Start menu, with Ctrl+Alt+T, or by typing:  prism'
    Say 'Inside Prism, type  settings  to make it yours. No need to run it as admin: sudo works.'
    Say 'Update: prism update    Remove: prism uninstall' 'DarkGray'
    Write-Host ''
    if (-not $env:PRISM_NO_LAUNCH) { Start-Process -FilePath (Join-Path $appDir 'Prism.exe') }
  } catch {
    Write-Host ''
    Say "Installation failed: $($_.Exception.Message)" 'Red'
    Say "Report it here: https://github.com/$repo/issues" 'DarkGray'
    Write-Host ''
  }
}
