# Prism shell profile for Windows PowerShell 5.1 and PowerShell 7.
# Loaded by init.ps1 after your own $PROFILE. Settings come from $global:PrismConfig (config.ps1).
#
# - Linux commands with GNU flags: ls -la, rm -rf, cp -r, mkdir -p, grep -rn, touch, which, head, tail, wc,
#   df -h, du -sh, free -h, uname -a, export, unset, env, open, pbcopy, pbpaste, ln -s, kill -9, killall...
#   PowerShell-style parameters (ls -Recurse, rm -Force) still go to the original cmdlets.
# - Enter sends the line to Prism, which rewrites bash/cmd syntax (&&, $VAR, %VAR%, dir /s...) into PowerShell.
# - A prompt configured in ~/.config/prism/config.jsonc (or kept from oh-my-posh/starship).

$ErrorActionPreference = 'Continue'
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $global:OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch {}

$global:__PE = [char]27
if (-not $global:PrismConfig) { $global:PrismConfig = @{ translate = $true; linux = $true; predictions = $true; prompt = @{ style = 'prism' } } }

# ------------------------------------------------------------------ helpers
function global:__prism_ps_style($a) {
  # PowerShell-style named parameter (-Recurse, -Path, -Force) => use the original cmdlet
  foreach ($x in $a) { if ($x -is [string] -and $x -cmatch '^-[A-Z][A-Za-z]{2,}(:.*)?$') { return $true } }
  return $false
}
function global:__prism_flags([object[]]$a, [string]$known) {
  # Parses GNU-style flags. Returns @{ f = hashtable of single-letter flags; long = list; rest = positional args }
  $f = @{}; $long = New-Object System.Collections.Generic.List[string]; $rest = New-Object System.Collections.Generic.List[object]; $done = $false
  foreach ($x in $a) {
    $s = [string]$x
    if (-not $done -and $s -eq '--') { $done = $true; continue }
    if (-not $done -and $s.StartsWith('--') -and $s.Length -gt 2) { $long.Add($s.Substring(2)); continue }
    if (-not $done -and $s -cmatch "^-[$known]+$") { foreach ($c in $s.Substring(1).ToCharArray()) { $f[[string]$c] = $true }; continue }
    $rest.Add($x)
  }
  return @{ f = $f; long = $long; rest = $rest }
}
function global:__prism_has($p, [string]$c) { return [bool]($p.f.ContainsKey($c) -and $p.f[$c]) }
function global:__prism_hsize([double]$b) {
  $u = 'B', 'K', 'M', 'G', 'T', 'P'; $i = 0
  while ($b -ge 1024 -and $i -lt $u.Count - 1) { $b /= 1024; $i++ }
  if ($i -eq 0) { return ('{0}' -f [int]$b) }
  if ($b -lt 10) { return ('{0:0.0}{1}' -f $b, $u[$i]) }
  return ('{0:0}{1}' -f $b, $u[$i])
}
function global:__prism_fg([string]$c) {
  $e = $global:__PE
  if (-not $c) { return '' }
  if ($c -match '^#([0-9a-fA-F]{6})$') {
    $h = $Matches[1]
    return "$e[38;2;$([Convert]::ToInt32($h.Substring(0,2),16));$([Convert]::ToInt32($h.Substring(2,2),16));$([Convert]::ToInt32($h.Substring(4,2),16))m"
  }
  $map = @{ black = 30; red = 31; green = 32; yellow = 33; blue = 34; magenta = 35; cyan = 36; white = 37; gray = 90; grey = 90; brightred = 91; brightgreen = 92; brightyellow = 93; brightblue = 94; brightmagenta = 95; brightcyan = 96; brightwhite = 97 }
  $k = $c.ToLower()
  if ($map.ContainsKey($k)) { return "$e[$($map[$k])m" }
  return ''
}
function global:__prism_piped($inv) { return ($inv.PipelinePosition -lt $inv.PipelineLength) }
function global:__prism_resolve([string]$p) {
  # Paths with wildcards expand to several items; plain paths must exist. ~ means your home folder.
  if ($p -eq '~' -or $p.StartsWith('~/') -or $p.StartsWith('~\')) { $p = $HOME + $p.Substring(1) }
  if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($p)) { return @(Get-Item -Path $p -Force -ErrorAction SilentlyContinue) }
  $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
  if ($i) { return @($i) }
  return @()
}
function global:__prism_hidden($i) { return ($i.Name.StartsWith('.') -or [bool]($i.Attributes -band [IO.FileAttributes]::Hidden)) }

if ($global:PrismConfig.linux) {
  # Windows PowerShell 5.1 aliases curl to Invoke-WebRequest; the real curl.exe ships with Windows.
  if (Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue) { Set-Alias -Name curl -Value curl.exe -Scope Global -Option AllScope -Force; Set-Alias -Name curl -Value curl.exe -Option AllScope -Force }

  # ---------------------------------------------------------------- ls
  function global:__prism_lscolor($i) {
    $e = $global:__PE
    if ($i.PSIsContainer) { return "$e[1;34m" }
    if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { return "$e[36m" }
    $x = $i.Extension.ToLower()
    if ('.exe', '.bat', '.cmd', '.ps1', '.com', '.msi', '.sh', '.psm1' -contains $x) { return "$e[1;32m" }
    if ('.zip', '.7z', '.rar', '.tar', '.gz', '.xz', '.bz2', '.tgz', '.zst' -contains $x) { return "$e[31m" }
    if ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.mp4', '.mkv', '.mov', '.mp3', '.wav', '.flac', '.avi' -contains $x) { return "$e[35m" }
    if (__prism_hidden $i) { return "$e[90m" }
    return ''
  }
  function global:__prism_lsentries($items, $o, [bool]$piped) {
    $items = @($items)
    if (-not $o.all -and -not $o.almost) { $items = @($items | Where-Object { -not (__prism_hidden $_) }) }
    if ($o.time) { $items = @($items | Sort-Object LastWriteTime -Descending) }
    elseif ($o.size) { $items = @($items | Sort-Object { if ($_.PSIsContainer) { 0 } else { $_.Length } } -Descending) }
    else { $items = @($items | Sort-Object { $_.Name.ToLower() }) }
    if ($o.rev) { [array]::Reverse($items) }
    if (-not $items.Count) { return }
    $e = $global:__PE; $r = "$e[0m"
    if ($piped) { foreach ($i in $items) { $i.Name }; return }
    if ($o.long) {
      $now = Get-Date
      $sizes = @(foreach ($i in $items) { if ($i.PSIsContainer) { '-' } elseif ($o.human) { __prism_hsize $i.Length } else { [string]$i.Length } })
      $sw = ($sizes | Measure-Object -Property Length -Maximum).Maximum
      for ($k = 0; $k -lt $items.Count; $k++) {
        $i = $items[$k]
        $t = if ($i.PSIsContainer) { 'd' } elseif ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { 'l' } else { '-' }
        $mode = $t + $(if ($i.Attributes -band [IO.FileAttributes]::ReadOnly) { 'r' } else { '-' }) + $(if ($i.Attributes -band [IO.FileAttributes]::Hidden) { 'h' } else { '-' }) + $(if ($i.Attributes -band [IO.FileAttributes]::System) { 's' } else { '-' })
        $d = $i.LastWriteTime
        $ds = if (($now - $d).TotalDays -gt 180) { $d.ToString('MMM dd  yyyy', [Globalization.CultureInfo]::InvariantCulture) } else { $d.ToString('MMM dd HH:mm', [Globalization.CultureInfo]::InvariantCulture) }
        $name = "$(__prism_lscolor $i)$($i.Name)$r"
        if ($i.LinkTarget) { $name += " -> $($i.LinkTarget)" } elseif ($i.Target -and $i.Attributes -band [IO.FileAttributes]::ReparsePoint) { $name += " -> $(@($i.Target)[0])" }
        "{0}  {1}  {2}  {3}" -f $mode, $sizes[$k].PadLeft($sw), $ds, $name
      }
      return
    }
    if ($o.one) { foreach ($i in $items) { "$(__prism_lscolor $i)$($i.Name)$r" }; return }
    $width = 100
    try { $width = [Math]::Max(20, $Host.UI.RawUI.WindowSize.Width - 1) } catch {}
    $max = ($items | ForEach-Object { $_.Name.Length } | Measure-Object -Maximum).Maximum
    $colw = $max + 2
    $cols = [Math]::Max(1, [Math]::Floor($width / $colw))
    $rows = [Math]::Ceiling($items.Count / $cols)
    for ($row = 0; $row -lt $rows; $row++) {
      $sb = New-Object System.Text.StringBuilder
      for ($col = 0; $col -lt $cols; $col++) {
        $idx = $col * $rows + $row
        if ($idx -ge $items.Count) { break }
        $i = $items[$idx]
        $pad = if (($col + 1) * $rows + $row -lt $items.Count) { ' ' * ($colw - $i.Name.Length) } else { '' }
        [void]$sb.Append("$(__prism_lscolor $i)$($i.Name)$r$pad")
      }
      $sb.ToString()
    }
  }
  function global:Prism-ls {
    if (__prism_ps_style $args) { Get-ChildItem @args; return }
    $p = __prism_flags $args 'laAh1RtSrdF'
    $o = @{ long = (__prism_has $p 'l'); all = ((__prism_has $p 'a') -or $p.long.Contains('all')); almost = ((__prism_has $p 'A') -or $p.long.Contains('almost-all'));
      human = ((__prism_has $p 'h') -or $p.long.Contains('human-readable')); one = (__prism_has $p '1'); rec = ((__prism_has $p 'R') -or $p.long.Contains('recursive'));
      time = (__prism_has $p 't'); size = (__prism_has $p 'S'); rev = ((__prism_has $p 'r') -or $p.long.Contains('reverse')); dir = (__prism_has $p 'd') }
    $piped = __prism_piped $MyInvocation
    $paths = @($p.rest | ForEach-Object { [string]$_ })
    if (-not $paths.Count) { $paths = @('.') }
    $files = @(); $dirs = @()
    foreach ($x in $paths) {
      $found = __prism_resolve $x
      if (-not $found.Count) { Write-Host "ls: cannot access '$x': No such file or directory" -ForegroundColor Red; continue }
      foreach ($f in $found) { if ($f.PSIsContainer -and -not $o.dir) { $dirs += $f } else { $files += $f } }
    }
    if ($files.Count) { $keep = $o.all; $o.all = $true; __prism_lsentries $files $o $piped; $o.all = $keep }
    $multi = ($dirs.Count + [int][bool]$files.Count) -gt 1 -or $o.rec
    $first = -not $files.Count
    $queue = New-Object System.Collections.Generic.Queue[object]
    foreach ($d in $dirs) { $queue.Enqueue($d) }
    while ($queue.Count) {
      $d = $queue.Dequeue()
      $children = @(Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue)
      if ($multi -and -not $piped) { if (-not $first) { '' }; "$($global:__PE)[1m$($d.FullName.Replace($HOME, '~')):$($global:__PE)[0m" }
      $first = $false
      __prism_lsentries $children $o $piped
      if ($o.rec) {
        foreach ($c in $children) { if ($c.PSIsContainer -and -not ($c.Attributes -band [IO.FileAttributes]::ReparsePoint) -and ($o.all -or $o.almost -or -not (__prism_hidden $c))) { $queue.Enqueue($c) } }
      }
    }
  }
  function global:ll { ls -l @args }
  function global:la { ls -la @args }
  function global:l { ls -lA @args }

  # ---------------------------------------------------------------- files
  function global:Prism-rm {
    if (__prism_ps_style $args) { Remove-Item @args; return }
    $p = __prism_flags $args 'rRfivd'
    $rec = (__prism_has $p 'r') -or (__prism_has $p 'R') -or $p.long.Contains('recursive')
    $force = (__prism_has $p 'f') -or $p.long.Contains('force')
    $verbose = (__prism_has $p 'v')
    $protect = @([IO.Path]::GetPathRoot($HOME), $HOME, $env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:USERPROFILE) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }
    if (-not $p.rest.Count) { if (-not $force) { Write-Host 'rm: missing operand' -ForegroundColor Red }; return }
    foreach ($x in $p.rest) {
      $items = __prism_resolve ([string]$x)
      if (-not $items.Count) { if (-not $force) { Write-Host "rm: cannot remove '$x': No such file or directory" -ForegroundColor Red }; continue }
      foreach ($i in $items) {
        $full = $i.FullName.TrimEnd('\')
        if (($protect -contains $full -or $full -match '^[A-Za-z]:$') -and -not $p.long.Contains('no-preserve-root')) { Write-Host "rm: refusing to remove '$full' (protected folder)" -ForegroundColor Red; continue }
        if ($i.PSIsContainer -and -not $rec -and -not ((__prism_has $p 'd') -and -not (Get-ChildItem -LiteralPath $full -Force | Select-Object -First 1))) { Write-Host "rm: cannot remove '$x': Is a directory" -ForegroundColor Red; continue }
        try {
          Remove-Item -LiteralPath $full -Recurse:($rec -or $i.PSIsContainer) -Force -ErrorAction Stop
          if ($verbose) { "removed '$($i.Name)'" }
        } catch { Write-Host "rm: cannot remove '$x': $($_.Exception.Message)" -ForegroundColor Red }
      }
    }
  }
  function global:Prism-cp {
    if (__prism_ps_style $args) { Copy-Item @args; return }
    $p = __prism_flags $args 'rRfnvpa'
    $rec = (__prism_has $p 'r') -or (__prism_has $p 'R') -or (__prism_has $p 'a') -or $p.long.Contains('recursive')
    if ($p.rest.Count -lt 2) { Write-Host 'cp: missing destination file operand' -ForegroundColor Red; return }
    $dest = [string]$p.rest[$p.rest.Count - 1]
    $srcs = @($p.rest | Select-Object -First ($p.rest.Count - 1))
    foreach ($s in $srcs) {
      $items = __prism_resolve ([string]$s)
      if (-not $items.Count) { Write-Host "cp: cannot stat '$s': No such file or directory" -ForegroundColor Red; continue }
      foreach ($i in $items) {
        if ($i.PSIsContainer -and -not $rec) { Write-Host "cp: -r not specified; omitting directory '$s'" -ForegroundColor Red; continue }
        $target = $dest
        if ((__prism_has $p 'n') -and (Test-Path -LiteralPath $target) -and -not (Get-Item -LiteralPath $target).PSIsContainer) { continue }
        try { Copy-Item -LiteralPath $i.FullName -Destination $target -Recurse:$rec -Force -ErrorAction Stop; if (__prism_has $p 'v') { "'$s' -> '$dest'" } }
        catch { Write-Host "cp: $($_.Exception.Message)" -ForegroundColor Red }
      }
    }
  }
  function global:Prism-mv {
    if (__prism_ps_style $args) { Move-Item @args; return }
    $p = __prism_flags $args 'fnvi'
    if ($p.rest.Count -lt 2) { Write-Host 'mv: missing destination file operand' -ForegroundColor Red; return }
    $dest = [string]$p.rest[$p.rest.Count - 1]
    foreach ($s in @($p.rest | Select-Object -First ($p.rest.Count - 1))) {
      $items = __prism_resolve ([string]$s)
      if (-not $items.Count) { Write-Host "mv: cannot stat '$s': No such file or directory" -ForegroundColor Red; continue }
      foreach ($i in $items) {
        if ((__prism_has $p 'n') -and (Test-Path -LiteralPath $dest) -and -not (Get-Item -LiteralPath $dest).PSIsContainer) { continue }
        try { Move-Item -LiteralPath $i.FullName -Destination $dest -Force -ErrorAction Stop; if (__prism_has $p 'v') { "renamed '$s' -> '$dest'" } }
        catch { Write-Host "mv: $($_.Exception.Message)" -ForegroundColor Red }
      }
    }
  }
  function global:Prism-mkdir {
    if (__prism_ps_style $args) { New-Item -ItemType Directory @args; return }
    $p = __prism_flags $args 'pv'
    foreach ($d in $p.rest) {
      $d = [string]$d
      if (Test-Path -LiteralPath $d) { if (-not (__prism_has $p 'p')) { Write-Host "mkdir: cannot create directory '$d': File exists" -ForegroundColor Red }; continue }
      $parent = Split-Path -Parent $d
      if ($parent -and -not (Test-Path -LiteralPath $parent) -and -not (__prism_has $p 'p')) { Write-Host "mkdir: cannot create directory '$d': No such file or directory" -ForegroundColor Red; continue }
      [void](New-Item -ItemType Directory -Path $d -Force)
      if (__prism_has $p 'v') { "mkdir: created directory '$d'" }
    }
  }
  function global:Prism-md { mkdir @args }
  function global:Prism-rmdir {
    if (__prism_ps_style $args) { Remove-Item @args; return }
    foreach ($d in $args) {
      if ((Get-ChildItem -LiteralPath ([string]$d) -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) { Write-Host "rmdir: failed to remove '$d': Directory not empty" -ForegroundColor Red }
      else { Remove-Item -LiteralPath ([string]$d) -Force }
    }
  }
  function global:touch {
    foreach ($f in $args) {
      $f = [string]$f
      if ($f.StartsWith('-')) { continue }
      if (Test-Path -LiteralPath $f) { (Get-Item -LiteralPath $f -Force).LastWriteTime = Get-Date }
      else { [void](New-Item -ItemType File -Path $f -Force) }
    }
  }
  function global:Prism-cat {
    if (-not $args.Count) { $input; return }
    if (__prism_ps_style $args) { Get-Content @args; return }
    $p = __prism_flags $args 'nbAsE'
    $n = 0
    foreach ($f in $p.rest) {
      $items = __prism_resolve ([string]$f)
      if (-not $items.Count) { Write-Host "cat: ${f}: No such file or directory" -ForegroundColor Red; continue }
      foreach ($i in $items) {
        if ($i.PSIsContainer) { Write-Host "cat: ${f}: Is a directory" -ForegroundColor Red; continue }
        foreach ($line in (Get-Content -LiteralPath $i.FullName)) {
          if ((__prism_has $p 'n') -or ((__prism_has $p 'b') -and $line)) { $n++; ('{0,6}  {1}' -f $n, $line) } else { $line }
        }
      }
    }
  }
  function global:ln {
    $p = __prism_flags $args 'sfv'
    if ($p.rest.Count -lt 2) { Write-Host 'usage: ln [-s] TARGET LINK_NAME' -ForegroundColor Red; return }
    $target = [string]$p.rest[0]; $link = [string]$p.rest[1]
    if ((__prism_has $p 'f') -and (Test-Path -LiteralPath $link)) { Remove-Item -LiteralPath $link -Force }
    $isDir = (Test-Path -LiteralPath $target -PathType Container)
    if (__prism_has $p 's') {
      try { [void](New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop) }
      catch {
        if ($isDir) { [void](New-Item -ItemType Junction -Path $link -Target (Resolve-Path $target)); Write-Host 'ln: created a junction (symlinks need Developer Mode or admin rights)' -ForegroundColor DarkGray }
        else { Write-Host "ln: $($_.Exception.Message) Turn on Developer Mode in Windows Settings to allow symlinks." -ForegroundColor Red }
      }
    } else { [void](New-Item -ItemType HardLink -Path $link -Target $target) }
  }
  function global:chmod { if ($args -notcontains '+x' -and -not ($args | Where-Object { $_ -match '^[0-7]{3,4}$|^[ugoa]*[+-=]x$' })) { Write-Host 'chmod: Windows uses ACLs; use icacls for permissions.' -ForegroundColor DarkGray } }
  function global:chown { Write-Host 'chown: Windows uses ACLs; use icacls or takeown.' -ForegroundColor DarkGray }

  # ---------------------------------------------------------------- text
  function global:grep {
    $p = __prism_flags $args 'ivnrRlLcwFEoHhqs'
    $pattern = $null; $paths = New-Object System.Collections.Generic.List[string]
    $rest = @($p.rest)
    $includes = @($p.long | Where-Object { $_ -like 'include=*' } | ForEach-Object { $_.Substring(8) })
    for ($k = 0; $k -lt $rest.Count; $k++) {
      if ([string]$rest[$k] -eq '-e' -and $k + 1 -lt $rest.Count) { $pattern = [string]$rest[$k + 1]; $k++; continue }
      if ($null -eq $pattern) { $pattern = [string]$rest[$k] } else { $paths.Add([string]$rest[$k]) }
    }
    if ($null -eq $pattern) { Write-Host 'usage: grep [-ivnrlcwFo] PATTERN [FILE]...' -ForegroundColor Red; return }
    $ic = __prism_has $p 'i'; $inv = __prism_has $p 'v'; $num = __prism_has $p 'n'; $rec = (__prism_has $p 'r') -or (__prism_has $p 'R')
    $regex = if (__prism_has $p 'F') { [regex]::Escape($pattern) } else { $pattern }
    if (__prism_has $p 'w') { $regex = "\b(?:$regex)\b" }
    $opts = if ($ic) { [Text.RegularExpressions.RegexOptions]::IgnoreCase } else { [Text.RegularExpressions.RegexOptions]::None }
    try { $rx = New-Object Text.RegularExpressions.Regex($regex, $opts) } catch { Write-Host "grep: invalid pattern: $pattern" -ForegroundColor Red; return }
    $piped = __prism_piped $MyInvocation
    $e = $global:__PE; $color = -not $piped -and -not $p.long.Contains('color=never')
    $binary = '.exe', '.dll', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.7z', '.pdf', '.ico', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.pdb', '.lib', '.obj', '.bin', '.iso', '.msi', '.node', '.class', '.jar', '.pyc'
    $sources = New-Object System.Collections.Generic.List[object]
    if ($paths.Count -eq 0 -and $rec) { $paths.Add('.') }
    if ($paths.Count -eq 0) {
      $lines = @($input | Out-String -Stream)
      $sources.Add(@{ name = $null; lines = $lines })
    } else {
      foreach ($x in $paths) {
        $found = __prism_resolve $x
        if (-not $found.Count) { if (-not (__prism_has $p 's')) { Write-Host "grep: ${x}: No such file or directory" -ForegroundColor Red }; continue }
        foreach ($f in $found) {
          if ($f.PSIsContainer) {
            if (-not $rec) { Write-Host "grep: ${x}: Is a directory" -ForegroundColor Red; continue }
            foreach ($file in (Get-ChildItem -LiteralPath $f.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)) {
              if ($file.FullName -match '[\\/](\.git|node_modules|\.venv|__pycache__)[\\/]') { continue }
              if ($binary -contains $file.Extension.ToLower() -or $file.Length -ge 20MB) { continue }
              if ($includes.Count) { $ok = $false; foreach ($g in $includes) { if ($file.Name -like $g) { $ok = $true } }; if (-not $ok) { continue } }
              $sources.Add(@{ name = (Resolve-Path -LiteralPath $file.FullName -Relative); file = $file.FullName })
            }
          } else { $sources.Add(@{ name = $x; file = $f.FullName }) }
        }
      }
    }
    $showName = (__prism_has $p 'H') -or (($sources.Count -gt 1 -or $rec) -and -not (__prism_has $p 'h'))
    $total = 0
    foreach ($s in $sources) {
      $lines = if ($s.file) { try { [IO.File]::ReadAllLines($s.file) } catch { @() } } else { $s.lines }
      $count = 0; $ln = 0
      foreach ($line in $lines) {
        $ln++
        $m = $rx.IsMatch([string]$line)
        if ($m -eq $inv) { continue }
        $count++; $total++
        if ((__prism_has $p 'q')) { return }
        if ((__prism_has $p 'l') -or (__prism_has $p 'c')) { continue }
        if (__prism_has $p 'o') { foreach ($mm in $rx.Matches([string]$line)) { if ($color) { "$e[1;31m$($mm.Value)$e[0m" } else { $mm.Value } }; continue }
        $text = if ($color -and -not $inv) { $rx.Replace([string]$line, { param($mm) "$e[1;31m$($mm.Value)$e[0m" }) } else { [string]$line }
        $prefix = ''
        if ($showName -and $s.name) { $prefix += $(if ($color) { "$e[35m$($s.name)$e[0m$e[36m:$e[0m" } else { "$($s.name):" }) }
        if ($num) { $prefix += $(if ($color) { "$e[32m$ln$e[0m$e[36m:$e[0m" } else { "${ln}:" }) }
        "$prefix$text"
      }
      if ((__prism_has $p 'l') -and $count) { $s.name }
      if ((__prism_has $p 'L') -and -not $count) { $s.name }
      if (__prism_has $p 'c') { if ($showName -and $s.name) { "$($s.name):$count" } else { "$count" } }
    }
    $global:LASTEXITCODE = [int]($total -eq 0)
  }
  function global:head {
    $n = 10; $files = @()
    for ($k = 0; $k -lt $args.Count; $k++) {
      $a = [string]$args[$k]
      if ($a -eq '-n' -and $k + 1 -lt $args.Count) { $n = [int]$args[$k + 1]; $k++ } elseif ($a -match '^-n(\d+)$|^-(\d+)$') { $n = [int]($Matches[1] + $Matches[2]) } else { $files += $a }
    }
    if (-not $files.Count) { $input | Select-Object -First $n; return }
    foreach ($f in $files) { if ($files.Count -gt 1) { "==> $f <==" }; Get-Content -LiteralPath $f -TotalCount $n }
  }
  function global:tail {
    $n = 10; $follow = $false; $files = @()
    for ($k = 0; $k -lt $args.Count; $k++) {
      $a = [string]$args[$k]
      if ($a -eq '-n' -and $k + 1 -lt $args.Count) { $n = [int]$args[$k + 1]; $k++ } elseif ($a -match '^-n(\d+)$|^-(\d+)$') { $n = [int]($Matches[1] + $Matches[2]) }
      elseif ($a -eq '-f' -or $a -eq '-F' -or $a -eq '--follow') { $follow = $true } else { $files += $a }
    }
    if (-not $files.Count) { $input | Select-Object -Last $n; return }
    foreach ($f in $files) { if ($files.Count -gt 1) { "==> $f <==" }; Get-Content -LiteralPath $f -Tail $n -Wait:$follow }
  }
  function global:wc {
    $p = __prism_flags $args 'lwcm'
    $sel = @('l', 'w', 'c') | Where-Object { __prism_has $p $_ }
    if (-not $sel.Count) { $sel = @('l', 'w', 'c') }
    $count = { param($text) @{ l = ([regex]::Matches($text, "`n")).Count; w = ([regex]::Matches($text, '\S+')).Count; c = [Text.Encoding]::UTF8.GetByteCount($text) } }
    $fmt = { param($r, $name) (($sel | ForEach-Object { ([string]$r[$_]).PadLeft(7) }) -join ' ') + $(if ($name) { " $name" } else { '' }) }
    if (-not $p.rest.Count) { $t = (@($input | Out-String -Stream) -join "`n") + "`n"; & $fmt (& $count $t) $null; return }
    foreach ($f in $p.rest) { & $fmt (& $count ([IO.File]::ReadAllText((Resolve-Path -LiteralPath ([string]$f)).Path))) $f }
  }
  function global:which {
    $all = $args -contains '-a'
    foreach ($n in ($args | Where-Object { $_ -ne '-a' })) {
      $c = @(Get-Command $n -All:$all -ErrorAction SilentlyContinue)
      if (-not $c.Count) { Write-Host "which: no $n in (PATH)" -ForegroundColor Red; continue }
      foreach ($x in $c) {
        switch ($x.CommandType) {
          'Application' { $x.Source }
          'Alias' { "${n}: aliased to $($x.Definition)" }
          'Function' { "${n}: shell function" }
          'Cmdlet' { "${n}: PowerShell cmdlet ($($x.ModuleName))" }
          default { "${n}: $($x.CommandType)" }
        }
        if (-not $all) { break }
      }
    }
  }

  # ---------------------------------------------------------------- system
  function global:df {
    $h = ($args -match 'h').Count -gt 0
    $f = { param($b) if ($h) { __prism_hsize $b } else { [string][Math]::Round($b / 1KB) } }
    '{0,-12} {1,8} {2,8} {3,8} {4,5}  {5}' -f 'Filesystem', $(if ($h) { 'Size' } else { '1K-blocks' }), 'Used', 'Avail', 'Use%', 'Mounted on'
    foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $null -ne $_.Used -and ($_.Used + $_.Free) -gt 0 })) {
      $size = $d.Used + $d.Free
      '{0,-12} {1,8} {2,8} {3,8} {4,4}%  {5}' -f "$($d.Name):", (& $f $size), (& $f $d.Used), (& $f $d.Free), [Math]::Round($d.Used * 100 / $size), $d.Root
    }
  }
  function global:du {
    $p = __prism_flags $args 'shac'
    $depth = 1
    foreach ($l in $p.long) { if ($l -like 'max-depth=*') { $depth = [int]$l.Substring(10) } }
    $rest = @($p.rest)
    for ($k = 0; $k -lt $rest.Count; $k++) { if ([string]$rest[$k] -eq '-d' -and $k + 1 -lt $rest.Count) { $depth = [int]$rest[$k + 1]; $rest = @($rest | Select-Object -Index (@(0..($rest.Count - 1)) | Where-Object { $_ -ne $k -and $_ -ne $k + 1 })); break } }
    if (-not $rest.Count) { $rest = @('.') }
    $fmt = { param($b) if (__prism_has $p 'h') { __prism_hsize $b } else { [string][Math]::Ceiling($b / 1KB) } }
    $size = { param($path) (Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum }
    foreach ($x in $rest) {
      $root = Get-Item -LiteralPath ([string]$x) -Force -ErrorAction SilentlyContinue
      if (-not $root) { Write-Host "du: cannot access '$x': No such file or directory" -ForegroundColor Red; continue }
      if (-not $root.PSIsContainer) { "{0}`t{1}" -f (& $fmt $root.Length), $x; continue }
      if (-not (__prism_has $p 's') -and $depth -gt 0) {
        foreach ($c in (Get-ChildItem -LiteralPath $root.FullName -Directory -Force -ErrorAction SilentlyContinue)) { "{0}`t{1}" -f (& $fmt ([double](& $size $c.FullName))), (Join-Path $x $c.Name) }
      }
      "{0}`t{1}" -f (& $fmt ([double](& $size $root.FullName))), $x
    }
  }
  function global:free {
    $h = ($args -match 'h').Count -gt 0
    $os = Get-CimInstance Win32_OperatingSystem
    $f = { param($kb) if ($h) { __prism_hsize ($kb * 1KB) } else { [string]$kb } }
    $tm = [double]$os.TotalVisibleMemorySize; $fm = [double]$os.FreePhysicalMemory
    $tv = [double]$os.TotalVirtualMemorySize - $tm; $fv = [double]$os.FreeVirtualMemory - $fm
    '{0,-6} {1,12} {2,12} {3,12}' -f '', 'total', 'used', 'free'
    '{0,-6} {1,12} {2,12} {3,12}' -f 'Mem:', (& $f $tm), (& $f ($tm - $fm)), (& $f $fm)
    '{0,-6} {1,12} {2,12} {3,12}' -f 'Swap:', (& $f ([Math]::Max(0, $tv))), (& $f ([Math]::Max(0, $tv - $fv))), (& $f ([Math]::Max(0, $fv)))
  }
  function global:uname {
    $v = [Environment]::OSVersion.Version
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64') { 'x86_64' } elseif ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { $env:PROCESSOR_ARCHITECTURE }
    $p = __prism_flags $args 'asnrvmo'
    if (__prism_has $p 'a') { "Windows_NT $($env:COMPUTERNAME.ToLower()) $($v.Major).$($v.Minor).$($v.Build) $arch Windows"; return }
    $out = @()
    if (__prism_has $p 'n') { $out += $env:COMPUTERNAME.ToLower() }
    if (__prism_has $p 'r') { $out += "$($v.Major).$($v.Minor).$($v.Build)" }
    if (__prism_has $p 'm') { $out += $arch }
    if (__prism_has $p 'o') { $out += 'Windows' }
    if (-not $out.Count -or (__prism_has $p 's')) { $out = @('Windows_NT') + $out }
    $out -join ' '
  }
  function global:uptime {
    $b = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    $u = (Get-Date) - $b
    'up {0} days, {1:00}:{2:00}' -f $u.Days, $u.Hours, $u.Minutes
  }
  function global:nproc { [Environment]::ProcessorCount }
  function global:env {
    $set = @{}; $k = 0
    while ($k -lt $args.Count -and ([string]$args[$k]) -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $set[$Matches[1]] = $Matches[2]; $k++ }
    if ($k -ge $args.Count) {
      if ($set.Count) { foreach ($n in $set.Keys) { Set-Item "env:$n" $set[$n] } }
      Get-ChildItem env: | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }; return
    }
    $old = @{}
    foreach ($n in $set.Keys) { $old[$n] = [Environment]::GetEnvironmentVariable($n); Set-Item "env:$n" $set[$n] }
    try { $cmd = $args[$k]; $rest = @($args | Select-Object -Skip ($k + 1)); & $cmd @rest }
    finally { foreach ($n in $old.Keys) { if ($null -eq $old[$n]) { Remove-Item "env:$n" -ErrorAction SilentlyContinue } else { Set-Item "env:$n" $old[$n] } } }
  }
  function global:export {
    if (-not $args.Count -or $args[0] -eq '-p') { Get-ChildItem env: | Sort-Object Name | ForEach-Object { "export $($_.Name)=`"$($_.Value)`"" }; return }
    foreach ($a in $args) { if (([string]$a) -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
  }
  function global:unset { foreach ($n in $args) { Remove-Item "env:$n" -ErrorAction SilentlyContinue; Remove-Variable -Name $n -Scope Global -ErrorAction SilentlyContinue } }
  function global:Prism-kill {
    if (__prism_ps_style $args) { Stop-Process @args; return }
    $force = $false; $ids = @()
    foreach ($a in $args) { $s = [string]$a; if ($s -match '^-(9|KILL|SIGKILL)$') { $force = $true } elseif ($s -match '^-(\d+|[A-Z]+)$') { } elseif ($s -eq '-l') { 'HUP INT QUIT KILL TERM'; return } else { $ids += [int]$s } }
    foreach ($i in $ids) { try { Stop-Process -Id $i -Force:$force -ErrorAction Stop } catch { Write-Host "kill: ($i) - No such process" -ForegroundColor Red } }
  }
  function global:killall { $force = $args -contains '-9'; foreach ($n in ($args | Where-Object { $_ -notmatch '^-' })) { $ps = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($n)) -ErrorAction SilentlyContinue); if (-not $ps.Count) { Write-Host "${n}: no process found" -ForegroundColor Red }; $ps | Stop-Process -Force:$force } }
  function global:pkill { $force = $args -contains '-9'; foreach ($n in ($args | Where-Object { $_ -notmatch '^-' })) { Get-Process | Where-Object { $_.ProcessName -match $n } | Stop-Process -Force:$force } }
  function global:pgrep { foreach ($n in ($args | Where-Object { $_ -notmatch '^-' })) { Get-Process | Where-Object { $_.ProcessName -match $n } | ForEach-Object { if ($args -contains '-l') { "$($_.Id) $($_.ProcessName)" } else { $_.Id } } } }
  function global:Prism-ps {
    if (__prism_ps_style $args) { Get-Process @args; return }
    if (-not $args.Count) { Get-Process; return }
    '{0,7} {1,6} {2,9} {3}' -f 'PID', '%CPU', 'MEM', 'COMMAND'
    Get-Process | Sort-Object CPU -Descending | ForEach-Object { '{0,7} {1,6:0.0} {2,9} {3}' -f $_.Id, $_.CPU, (__prism_hsize $_.WorkingSet64), $_.ProcessName }
  }
  function global:open { if (-not $args.Count) { Invoke-Item . ; return }; foreach ($a in $args) { $s = [string]$a; if ($s -match '^[a-z]+://') { Start-Process $s } else { Invoke-Item -LiteralPath $s } } }
  function global:xdg-open { open @args }
  function global:pbcopy { $t = ($input | Out-String); Set-Clipboard -Value $t.TrimEnd("`r", "`n") }
  function global:pbpaste { Get-Clipboard }
  function global:less { if ($args.Count) { Get-Content -LiteralPath ([string]$args[0]) | Out-Host -Paging } else { $input | Out-Host -Paging } }
  function global:Prism-wget {
    foreach ($u in ($args | Where-Object { $_ -notmatch '^-' })) { $name = [IO.Path]::GetFileName(([uri]$u).AbsolutePath); if (-not $name) { $name = 'index.html' }; Invoke-WebRequest -Uri $u -OutFile $name -UseBasicParsing; "saved '$name'" }
  }
  function global:Prism-man { Get-Help @args -Full | Out-Host -Paging }

  # Built-in aliases (ls, rm, cp...) beat functions, so the aliases themselves are pointed at Prism's versions.
  # Global + AllScope makes that work in every scope, and the original cmdlets stay available by full name.
  # The scope that loaded this profile already holds its own copy of each AllScope alias, so it is set there too.
  foreach ($n in 'ls', 'rm', 'cp', 'mv', 'mkdir', 'md', 'rmdir', 'cat', 'kill', 'ps', 'wget', 'man') {
    Set-Alias -Name $n -Value "Prism-$n" -Scope Global -Option AllScope -Force
    Set-Alias -Name $n -Value "Prism-$n" -Option AllScope -Force
  }

  # Suggest an install when a well-known tool is missing.
  $global:__PrismInstall = @{ vim = 'vim.vim'; nvim = 'Neovim.Neovim'; nano = 'GNU.Nano'; htop = 'aristocratos.btop4win'; btop = 'aristocratos.btop4win'; top = 'aristocratos.btop4win';
    jq = 'jqlang.jq'; git = 'Git.Git'; node = 'OpenJS.NodeJS.LTS'; npm = 'OpenJS.NodeJS.LTS'; python = 'Python.Python.3.12'; python3 = 'Python.Python.3.12'; pip = 'Python.Python.3.12';
    rg = 'BurntSushi.ripgrep.MSVC'; fzf = 'junegunn.fzf'; bat = 'sharkdp.bat'; fd = 'sharkdp.fd'; lazygit = 'JesseDuffield.lazygit'; gh = 'GitHub.cli'; code = 'Microsoft.VisualStudioCode';
    neofetch = 'Fastfetch-cli.Fastfetch'; fastfetch = 'Fastfetch-cli.Fastfetch'; go = 'GoLang.Go'; cargo = 'Rustlang.Rustup'; rustc = 'Rustlang.Rustup'; java = 'Microsoft.OpenJDK.21'; docker = 'Docker.DockerDesktop';
    make = 'ezwinports.make'; gcc = 'BrechtSanders.WinLibs.POSIX.UCRT'; tmux = $null; zsh = $null; apt = $null; 'apt-get' = $null; yum = $null; pacman = $null; brew = $null }
  $ExecutionContext.InvokeCommand.CommandNotFoundAction = {
    param($name, $ev)
    if ($name -like 'get-*' -or $name -like '*.*' -or -not $global:__PrismInstall.ContainsKey($name)) { return }
    if ($global:__PrismLastHint -eq $name) { return }
    $global:__PrismLastHint = $name
    $id = $global:__PrismInstall[$name]
    $e = $global:__PE
    if ($id) { [Console]::WriteLine("$e[33mPrism:$e[0m '$name' is not installed. Install it with: $e[1mwinget install $id$e[0m") }
    elseif ($name -in 'apt', 'apt-get', 'yum', 'pacman', 'brew') { [Console]::WriteLine("$e[33mPrism:$e[0m on Windows use $e[1mwinget$e[0m, e.g. winget search <name>, winget install <id>") }
    else { [Console]::WriteLine("$e[33mPrism:$e[0m '$name' is not available on Windows. Try WSL: $e[1mwsl --install$e[0m") }
  }
}

# ------------------------------------------------------------------ PSReadLine: completion, history, translation
$__rl = $null
try { if (-not (Get-Module PSReadLine)) { Import-Module PSReadLine -ErrorAction Stop }; $__rl = Get-Module PSReadLine } catch {}
if ($__rl) {
  try { Set-PSReadLineOption -BellStyle None } catch {}
  try { Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete } catch {}
  try { Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward; Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward } catch {}
  try { Set-PSReadLineKeyHandler -Chord 'Ctrl+d' -Function DeleteCharOrExit } catch {}
  try { Set-PSReadLineKeyHandler -Chord 'Ctrl+w' -Function BackwardKillWord } catch {}
  try { Set-PSReadLineKeyHandler -Chord 'Ctrl+u' -Function BackwardDeleteLine } catch {}
  try { Set-PSReadLineKeyHandler -Chord 'Ctrl+l' -Function ClearScreen } catch {}
  $e = $global:__PE
  try { Set-PSReadLineOption -Colors @{ Command = "$e[32m"; Parameter = "$e[90m"; String = "$e[33m"; Operator = "$e[35m"; Variable = "$e[36m"; Comment = "$e[90m"; Number = "$e[35m"; Keyword = "$e[35m"; Type = "$e[34m"; Member = "$e[37m" } } catch {}
  if ($global:PrismConfig.predictions -and $__rl.Version -ge [version]'2.1.0') {
    try { Set-PSReadLineOption -PredictionSource History; Set-PSReadLineOption -Colors @{ InlinePrediction = "$e[90m" } } catch {}
  }
  if ($env:PRISM_PIPE) {
    try {
      Set-PSReadLineKeyHandler -Key Enter -BriefDescription PrismAcceptLine -Description 'sudo, admin checks and bash/cmd translation, then run' -ScriptBlock {
        $line = $null; $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
        $t = __prism_translate $line
        if ($null -ne $t -and $t -ne $line) { [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $line.Length, $t) }
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
      }
    } catch {}
  }
}
function global:__prism_translate([string]$line) {
  if (-not $env:PRISM_PIPE -or -not $line -or -not $line.Trim() -or $line.StartsWith(' ')) { return $line }
  $client = $null
  try {
    $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $env:PRISM_PIPE, [System.IO.Pipes.PipeDirection]::InOut)
    $client.Connect(300)
    $enc = New-Object System.Text.UTF8Encoding $false
    $w = New-Object System.IO.StreamWriter($client, $enc); $w.AutoFlush = $true
    $r = New-Object System.IO.StreamReader($client, $enc)
    $req = @{ line = $line; ps7 = ($PSVersionTable.PSVersion.Major -ge 7); last = ''; env = @(); vars = @() }
    $h = Get-History -Count 1
    if ($h) { $req.last = [string]$h.CommandLine }
    if ($line.Contains('$') -or $line.Contains('%')) { $req.env = @(Get-ChildItem env: | ForEach-Object { $_.Name }); $req.vars = @(Get-Variable | ForEach-Object { $_.Name }) }
    $w.WriteLine((ConvertTo-Json $req -Compress -Depth 3))
    $resp = $r.ReadLine()
    if ($resp) { $o = $resp | ConvertFrom-Json; if ($null -ne $o.line) { return [string]$o.line } }
  } catch {} finally { if ($client) { $client.Dispose() } }
  return $line
}

# ------------------------------------------------------------------ administrator rights
. (Join-Path $PSScriptRoot 'elevate.ps1')
function global:sudo {
  if (-not $args.Count) { Write-Host 'usage: sudo COMMAND [ARGS...]'; return }
  $line = ($args | ForEach-Object { $s = [string]$_; if ($s -match '[\s"'']') { "'" + $s.Replace("'", "''") + "'" } else { $s } }) -join ' '
  __prism_elevate pwsh $line
}
# Prism rewrites `sudo ...` to __prism_sudo '...', so the whole line (quotes, &&, pipes) reaches the elevated shell as typed
function global:__prism_sudo([string]$cmd) { __prism_elevate pwsh $cmd }
# Prism rewrites commands that always need admin (sfc, DISM, choco install...) to: if (__prism_ask_admin ...) { command }
# Returns $true to run it here as typed, $false after running it elevated.
function global:__prism_ask_admin([string]$cmd) {
  $name = ($cmd.Trim() -split '\s+')[0]
  Write-Host "$($global:__PE)[33m⚡$($global:__PE)[0m $name needs administrator rights. Run it as admin? [Y/n] " -NoNewline
  $k = [Console]::ReadKey($true)
  if ($k.Key -eq 'N' -or $k.Key -eq 'Escape') { Write-Host 'n'; return $true }
  Write-Host 'y'
  __prism_elevate pwsh $cmd | Out-Host
  return $false
}
# After a command fails with "Access denied" / "requires elevation", offer to run it again as admin.
function global:__prism_admin_retry([bool]$ok, $code) {
  if ($ok -or -not $global:PrismConfig.adminAsk -or $env:PRISM_ELEVATED -eq '1' -or -not $env:PRISM_TAB) { return }
  $h = Get-History -Count 1
  if (-not $h -or $h.Id -eq $global:__PrismAdminSeen) { return }
  $global:__PrismAdminSeen = $h.Id
  $line = [string]$h.CommandLine
  if ($line -match '^\s*(sudo\b|if \(__prism_|__prism_)') { return }
  $need = ($code -eq 740)  # ERROR_ELEVATION_REQUIRED
  $err = $global:Error[0]
  if ($err -and -not [object]::ReferenceEquals($err, $global:__PrismLastErr)) {
    $global:__PrismLastErr = $err
    $ex = $err.Exception
    $txt = "$($err.FullyQualifiedErrorId) $($ex.GetType().Name) $($ex.Message) $($ex.InnerException.Message)"
    if ($txt -match 'UnauthorizedAccess|Access (to the path .+ )?is denied|access denied|requires elevation|elevated|administrator|PermissionDenied') { $need = $true }
  }
  if (-not $need) { return }
  Write-Host "$($global:__PE)[33m⚡$($global:__PE)[0m That needs administrator rights. Run it again as admin? [y/N] " -NoNewline
  $k = [Console]::ReadKey($true)
  if ($k.Key -ne 'Y') { Write-Host 'n'; return }
  Write-Host 'y'
  __prism_elevate pwsh $line
}

# ------------------------------------------------------------------ toys (drawn by Prism in this tab)
foreach ($t in 'fetch', 'lava', 'matrix', 'pipes', 'donut', 'clock', 'visualizer', 'cava', 'toys') {
  if (-not (Get-Command $t -CommandType Application -ErrorAction SilentlyContinue)) {
    Set-Item -Path "function:global:$t" -Value ([scriptblock]::Create("__prism_toy '$t' `$args"))
  }
}

# ------------------------------------------------------------------ Prism commands
function global:__prism_msg([string]$s) {
  if ($env:PRISM_INBOX -and (Test-Path -LiteralPath $env:PRISM_INBOX)) {
    [IO.File]::WriteAllText((Join-Path $env:PRISM_INBOX ('ps-{0}-{1}.msg' -f $PID, [guid]::NewGuid().ToString('N'))), "$s`n")
  } else { Write-Host -NoNewline "$($global:__PE)]7777;$s$([char]7)" }
}
function global:settings { __prism_msg "panel;$($args -join ' ')" }
function global:prism {
  $sub = if ($args.Count) { ([string]$args[0]).ToLower() } else { 'help' }
  $rest = @($args | Select-Object -Skip 1)
  $e = $global:__PE
  switch ($sub) {
    'settings' { __prism_msg "panel;$($rest -join ' ')"; return }
    'opacity' { __prism_msg "opacity;$($rest[0])"; return }
    'font-size' { __prism_msg "font;$($rest[0])"; return }
    'scheme' { __prism_msg "scheme;$($rest -join ' ')"; return }
    'reload' { __prism_msg 'reload;'; return }
    'alias' {
      if (-not $rest.Count) { __prism_aliases; return }
      $name = [string]$rest[0]
      if ($rest.Count -eq 1) { __prism_aliases | Where-Object { $_ -match "^\s*$([regex]::Escape($name))\s" }; return }
      $body = (@($rest | Select-Object -Skip 1) | ForEach-Object { [string]$_ }) -join ' '
      __prism_msg ('add;' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("run`t$name`t$body")))
      "alias $name='$body' (saved, available from the next command)"
      return
    }
    'unalias' { foreach ($n in $rest) { __prism_msg "remove;$n" }; return }
    'help' {
      "$e[1mPrism$e[0m commands"
      '  settings                 open settings (appearance, shell, admin, aliases, keys)'
      '  prism alias NAME CMD     save an alias (bash style works too: alias ll=''ls -la'')'
      '  prism alias              list aliases          prism unalias NAME'
      '  prism opacity 0-100      terminal transparency prism font-size 10-28'
      '  prism scheme NAME        terminal color scheme prism reload'
      '  sudo COMMAND             run one command as administrator, in this tab'
      '  prism version | update | uninstall'
      ''
      "$e[1mLinux commands$e[0m: ls -la, rm -rf, cp -r, mkdir -p, grep -rn, touch, which, head, tail, wc, df -h, du -sh, free -h,"
      '  uname -a, uptime, export, unset, env, open, pbcopy, pbpaste, ln -s, kill -9, killall, pgrep, ps aux'
      "$e[1mTranslation$e[0m: bash and cmd syntax (&&, `$VAR, %VAR%, dir /s, del /q, set X=1) is converted before it runs."
      '  Start a line with a space to run it exactly as typed.'
      return
    }
    default {
      $cmd = Get-Command prism.cmd -CommandType Application -ErrorAction SilentlyContinue
      if (-not $cmd) { Write-Host "prism: unknown command '$sub' (Prism CLI not on PATH)" -ForegroundColor Red; return }
      & $cmd.Source @args
    }
  }
}

# ------------------------------------------------------------------ prompt
function global:__prism_git {
  $d = (Get-Location).ProviderPath
  for ($k = 0; $k -lt 40 -and $d; $k++) {
    $g = Join-Path $d '.git'
    if (Test-Path -LiteralPath $g) {
      if (Test-Path -LiteralPath $g -PathType Leaf) { $line = Get-Content -LiteralPath $g -TotalCount 1; if ($line -match '^gitdir:\s*(.+)$') { $g = $Matches[1]; if (-not [IO.Path]::IsPathRooted($g)) { $g = Join-Path $d $g } } else { return $null } }
      $headFile = Join-Path $g 'HEAD'
      if (-not (Test-Path -LiteralPath $headFile)) { return $null }
      $head = (Get-Content -LiteralPath $headFile -TotalCount 1)
      if ($head -match '^ref: refs/heads/(.+)$') { return $Matches[1] }
      return $head.Substring(0, [Math]::Min(7, $head.Length))
    }
    $d = Split-Path -Parent $d
  }
  return $null
}
$__keepPrompt = $false
$__pc = $global:PrismConfig.prompt
if ($__pc.style -eq 'keep') { $__keepPrompt = $true }
elseif ($__pc.style -eq 'auto') { $__def = [string]$function:prompt; if ($__def -match 'oh-my-posh|starship|Invoke-Starship|posh-git|Write-VcsStatus') { $__keepPrompt = $true } }
if ($__keepPrompt) {
  $global:__PrismUserPrompt = $function:prompt
  function global:prompt { $ok = $?; $code = $global:LASTEXITCODE; __prism_admin_retry $ok $code; __prism_tick; & $global:__PrismUserPrompt }
} else {
  function global:prompt {
    $ok = $?; $code = $global:LASTEXITCODE
    __prism_admin_retry $ok $code
    __prism_tick
    $c = $global:PrismConfig.prompt
    $e = $global:__PE; $r = "$e[0m"
    $h = Get-History -Count 1
    $fresh = $h -and $h.Id -ne $global:__PrismLastHistId
    $failed = $fresh -and -not $ok
    if ($h) { $global:__PrismLastHistId = $h.Id }
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($s in $c.segments) {
      switch ($s) {
        'user' { $parts.Add("$(__prism_fg $c.colors.user)$env:USERNAME$r") }
        'host' { $parts.Add("$(__prism_fg $c.colors.host)$($env:COMPUTERNAME.ToLower())$r") }
        'userhost' { $parts.Add("$(__prism_fg $c.colors.user)$env:USERNAME$r$(__prism_fg $c.colors.muted)@$r$(__prism_fg $c.colors.host)$($env:COMPUTERNAME.ToLower())$r") }
        'path' {
          $p = (Get-Location).ProviderPath
          if (-not $p) { $p = (Get-Location).Path }
          if ($p.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase)) { $p = '~' + $p.Substring($HOME.Length) }
          $sep = '\'
          if ($c.unixPaths) { $p = $p.Replace('\', '/'); $sep = '/' }
          $bits = @($p.Split($sep) | Where-Object { $_ -ne '' })
          if ($c.pathDepth -gt 0 -and $bits.Count -gt $c.pathDepth) { $p = '…' + $sep + (($bits | Select-Object -Last $c.pathDepth) -join $sep) }
          $parts.Add("$e[1m$(__prism_fg $c.colors.path)$p$r")
        }
        'git' { $b = __prism_git; if ($b) { $parts.Add("$(__prism_fg $c.colors.git)$($c.gitSymbol)$b$r") } }
        'venv' { if ($env:VIRTUAL_ENV) { $parts.Add("$(__prism_fg $c.colors.muted)($(Split-Path -Leaf $env:VIRTUAL_ENV))$r") } }
        'duration' {
          if ($fresh) {
            $t = ($h.EndExecutionTime - $h.StartExecutionTime).TotalSeconds
            if ($t -ge $c.durationMin) {
              $txt = if ($t -ge 60) { '{0}m{1:00}s' -f [int][Math]::Floor($t / 60), [int]($t % 60) } else { '{0:0.0}s' -f $t }
              $parts.Add("$(__prism_fg $c.colors.muted)took $txt$r")
            }
          }
        }
        'status' { if ($failed) { $codeText = if ($code) { " $code" } else { '' }; $parts.Add("$(__prism_fg $c.colors.error)✗$codeText$r") } }
        'time' { $parts.Add("$(__prism_fg $c.colors.muted)$(Get-Date -Format 'HH:mm')$r") }
        'shell' { $parts.Add("$(__prism_fg $c.colors.muted)$(if ($PSVersionTable.PSVersion.Major -ge 7) { 'pwsh' } else { 'powershell' })$r") }
      }
    }
    $symColor = if ($failed) { $c.colors.error } else { $c.colors.symbol }
    $sym = "$(__prism_fg $symColor)$($c.symbol)$r "
    $line = $parts -join ' '
    $gap = ''
    if ($c.newline -and $c.blankLine -and $global:__PrismPrompted) { $gap = "`n" }
    $global:__PrismPrompted = $true
    if ($c.newline) { return "$gap$line`n$sym" }
    return "$line $sym"
  }
  try { Set-PSReadLineOption -PromptText "$($global:PrismConfig.prompt.symbol) " } catch {}
}
function global:__prism_tick {
  # runs before every prompt: remember the previous folder for `cd -`, reload aliases when Prism changed them
  $here = (Get-Location).Path
  if ($global:__PrismPwd -and $global:__PrismPwd -ne $here) { $global:PRISM_OLDPWD = $global:__PrismPwd }
  $global:__PrismPwd = $here
  if (Get-Command __tc_reload -ErrorAction SilentlyContinue) { __tc_reload }
}
# errors from loading the profile are not a reason to offer admin rights
$global:__PrismLastErr = $global:Error[0]
# a fetch greeting in new tabs (Settings > Shell & prompt)
if ($global:PrismConfig.fetchOnStart -and $env:PRISM_TAB -and (Get-Command fetch -CommandType Function -ErrorAction SilentlyContinue)) { fetch }
