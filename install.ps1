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
  # Is this PowerShell shown by Prism (a Prism tab, or a console Windows handed to Prism)?
  # Then closing Prism for the update would end this script too.
  function Test-InsidePrism {
    if ($env:TERM_PROGRAM -eq 'Prism') { return $true }
    $st = Get-ItemProperty -LiteralPath 'HKCU:\Console\%%Startup' -ErrorAction SilentlyContinue
    if (-not $st -or $st.DelegationTerminal -ne '{682C9CD9-030D-4029-BA37-7DD6F909FDF8}') { return $false }
    try {
      Add-Type -Namespace PrismSetup -Name Con -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);'
      $hostPid = [uint32]0
      [void][PrismSetup.Con]::GetWindowThreadProcessId([PrismSetup.Con]::GetConsoleWindow(), [ref]$hostPid)
      return ((Get-Process -Id $hostPid -ErrorAction SilentlyContinue).ProcessName -eq 'OpenConsole')
    } catch { return $false }
  }

  try {
    Write-Host ''
    Write-Host '  Prism' -ForegroundColor Magenta -NoNewline; Write-Host '  one terminal for PowerShell, cmd and bash' -ForegroundColor DarkGray
    Write-Host ''
    if ($env:OS -ne 'Windows_NT') { throw 'Prism runs on Windows.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Prism needs 64-bit Windows.' }

    $running = @(Get-Process -Name Prism -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($appDir, [StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count -and -not $env:PRISM_INSTALL_CHILD -and (Test-InsidePrism)) {
      # continue in a classic console window (conhost never hands its window to Prism)
      $again = "`$env:PRISM_INSTALL_CHILD = '1'; `$env:PRISM_REPO = '$repo'; " + $(if ($env:PRISM_ZIP) { "`$env:PRISM_ZIP = '$($env:PRISM_ZIP -replace "'", "''")'; " } else { '' }) + "irm https://raw.githubusercontent.com/$repo/main/install.ps1 | iex"
      $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($again))
      Start-Process -FilePath 'conhost.exe' -ArgumentList "powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -EncodedCommand $enc"
      Say 'Prism has to close for the update, so it continues in a separate window.' 'Yellow'
      return
    }

    # a log of every install, for when something goes wrong
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $log = Join-Path $root 'install.log'
    try { Start-Transcript -LiteralPath $log -Force | Out-Null; $logging = $true } catch { $logging = $false }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('prism-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $newDir = Join-Path $root 'app.new'
    try {
      Say 'Downloading the latest version...' 'Cyan'
      $zip = Join-Path $tmp 'prism.zip'
      if (Test-Path -LiteralPath $zipUrl) { Copy-Item -LiteralPath $zipUrl -Destination $zip }
      else {
        for ($try = 1; ; $try++) {
          try { Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing; if ((Get-Item -LiteralPath $zip).Length -gt 20MB) { break } ; throw 'the download is incomplete' }
          catch { if ($try -ge 3) { throw "Download failed: $($_.Exception.Message)" }; Say "Download failed ($($_.Exception.Message)), trying again..." 'Yellow'; Start-Sleep -Seconds (2 * $try) }
        }
      }

      Say 'Unpacking...' 'Cyan'
      $stage = Join-Path $tmp 'x'
      Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
      $exe = Get-ChildItem -LiteralPath $stage -Filter 'Prism.exe' -Recurse | Select-Object -First 1
      if (-not $exe) { throw 'The download does not contain Prism.exe.' }
      # the new version goes next to the old one first; the old one is only replaced once everything is ready
      # only our own leftovers: on Windows the pattern app.* would also match the app folder itself
      foreach ($d in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'app.new' -or $_.Name -like 'app.old-*' })) { Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue }
      Copy-Item -LiteralPath $exe.DirectoryName -Destination $newDir -Recurse
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    $inApp = { param($p) $p -and $p.StartsWith($appDir + '\', [StringComparison]::OrdinalIgnoreCase) }
    $running = @(Get-Process -Name Prism -ErrorAction SilentlyContinue | Where-Object { & $inApp $_.Path })
    if ($running.Count) {
      Say 'Closing the running Prism...' 'Cyan'
      $inbox = Join-Path $env:APPDATA 'Prism\inbox'
      if (Test-Path -LiteralPath $inbox) { [IO.File]::WriteAllText((Join-Path $inbox 'install-quit.msg'), "quit;`n") }
      for ($i = 0; $i -lt 30 -and @(Get-Process -Id $running.Id -ErrorAction SilentlyContinue).Count; $i++) { Start-Sleep -Milliseconds 200 }
    }
    if (Test-Path -LiteralPath $appDir) {
      # Windows keeps a program's files locked until every one of its processes has exited (Prism, its helpers,
      # prism-handoff.exe, an elevated sudo helper). Renaming the folder only works once nothing uses it, and it
      # never leaves a half-deleted Prism behind.
      $oldDir = Join-Path $root ('app.old-' + [DateTime]::Now.Ticks)
      $err = $null
      for ($i = 0; $i -lt 60; $i++) {
        @(Get-Process -ErrorAction SilentlyContinue | Where-Object { & $inApp $_.Path }) | Stop-Process -Force -ErrorAction SilentlyContinue
        try { Rename-Item -LiteralPath $appDir -NewName (Split-Path $oldDir -Leaf) -ErrorAction Stop; $err = $null; break }
        catch { $err = $_; Start-Sleep -Milliseconds 500 }
      }
      if ($err) {
        Remove-Item -LiteralPath $newDir -Recurse -Force -ErrorAction SilentlyContinue
        $hidden = @(Get-Process -Name Prism, prism-handoff -ErrorAction SilentlyContinue | Where-Object { -not $_.Path })
        if ($hidden.Count) { throw 'Prism is running as administrator, so this window cannot close it. Close Prism (or run this in an administrator PowerShell), then try again. Your current Prism was not changed.' }
        throw "Something still uses the Prism folder ($($err.Exception.Message)). Close Prism and try again. Your current Prism was not changed."
      }
      Rename-Item -LiteralPath $newDir -NewName 'app'
      Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue  # if something still holds a file, the next update removes it
    } else {
      Rename-Item -LiteralPath $newDir -NewName 'app'
    }

    # the `prism` command in every terminal
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $cmd = @(
      '@echo off',
      'setlocal',
      'set "PRISM_APP=%LOCALAPPDATA%\Prism\app"',
      'if not exist "%PRISM_APP%\engine\installer\prism.ps1" goto repair',
      'if "%~1"=="" (start "" "%PRISM_APP%\Prism.exe" & exit /b 0)',
      'if /i "%~1"=="run" goto run',
      'if /i "%~1"=="settings" (start "" "%PRISM_APP%\Prism.exe" --settings & exit /b 0)',
      'if /i "%~1"=="open" (start "" "%PRISM_APP%\Prism.exe" & exit /b 0)',
      # `(goto) 2>nul` ends this .cmd before PowerShell starts (the rest of the line is already read),
      # so `prism uninstall` can delete this file without cmd complaining.
      '(goto) 2>nul & powershell -NoProfile -ExecutionPolicy Bypass -File "%PRISM_APP%\engine\installer\prism.ps1" %*',
      # prism run COMMAND: the command line goes through a file, so no argument is mistaken for a Prism option
      ':run',
      'set "PRISM_RUN=%TEMP%\prism-run-%RANDOM%%RANDOM%.txt"',
      '>"%PRISM_RUN%" echo(%*',
      'start "" "%PRISM_APP%\Prism.exe" --run-cmdfile "%PRISM_RUN%" --run-cwd "%CD%."',
      'exit /b 0',
      # a damaged install (files missing): download and install Prism again
      ':repair',
      'echo Prism is damaged, installing it again...',
      'set "R=onufry444/prism"',
      'if exist "%LOCALAPPDATA%\Prism\repo.txt" set /p R=<"%LOCALAPPDATA%\Prism\repo.txt"',
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:PRISM_REPO=''%R%''; irm https://raw.githubusercontent.com/%R%/main/install.ps1 | iex"',
      'exit /b %ERRORLEVEL%'
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
    if ($logging) { Say "Details: $log" 'DarkGray' }
    Say "Report it here: https://github.com/$repo/issues" 'DarkGray'
    Write-Host ''
  } finally {
    if ($logging) { try { Stop-Transcript | Out-Null } catch {} }
  }
}
