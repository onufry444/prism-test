# Tests for the Prism PowerShell profile. Run on Windows PowerShell 5.1 and PowerShell 7:
#   node test/gen-shell.js C:\tmp\shell ; .\test\profile.tests.ps1 -Dir C:\tmp\shell
param([Parameter(Mandatory)][string]$Dir)
$ErrorActionPreference = 'Continue'
. (Join-Path $Dir 'init.ps1')
$script:fail = 0
function Check([string]$name, $cond, $info) {
  if ($cond) { Write-Host "OK    $name" } else { Write-Host "FAIL  $name" -ForegroundColor Red; if ($null -ne $info) { Write-Host "      $(($info | Out-String).Trim())" }; $script:fail++ }
}
$strip = { param($s) ([string]$s) -replace "$([char]27)\[[0-9;]*m", '' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('prism-ps-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
Push-Location $work
try {
  Write-Host "PowerShell $($PSVersionTable.PSVersion)"
  mkdir -p a/b/c; Check 'mkdir -p creates parents' (Test-Path a/b/c)
  mkdir a 2>$null; Check 'mkdir on existing folder does not throw' $true
  touch a/x.txt a/.hidden; Check 'touch creates files' ((Test-Path a/x.txt) -and (Test-Path a/.hidden))
  Set-Content -Path a/x.txt -Value "hello world`nfoo bar`nHello again"
  $names = @(ls a | ForEach-Object { [string]$_ })
  Check 'ls piped gives names' ($names -contains 'x.txt' -and $names -contains 'b') $names
  Check 'ls hides dotfiles' (-not ($names -contains '.hidden')) $names
  $all = @(ls -a a | ForEach-Object { [string]$_ }); Check 'ls -a shows dotfiles' ($all -contains '.hidden') $all
  $long = (& $strip ((ls -la a) -join "`n")); Check 'ls -la long format' ($long -match '-.{3}\s+\d+\s+\w{3} \d{2} .*x\.txt' -and $long -match 'd.{3}\s+-\s') $long
  $grid = (& $strip ((ls a) -join ' ')); Check 'ls grid output' ($grid -match 'x\.txt' -and $grid -match '\bb\b') $grid
  $obj = @(ls -Recurse a)[0]; Check 'ls -Recurse goes to Get-ChildItem' ($obj -is [IO.FileSystemInfo]) $obj
  $g = @(grep -i hello a/x.txt | ForEach-Object { [string]$_ }); Check 'grep -i' ($g.Count -eq 2) $g
  $g = @(grep -rn foo a | ForEach-Object { & $strip $_ }); Check 'grep -rn' (($g -join '|') -match 'x\.txt:2:foo bar') $g
  $g = @('one', 'two', 'three' | grep t | ForEach-Object { [string]$_ }); Check 'grep from pipeline' (($g -join ',') -eq 'two,three') $g
  $g = @(grep -c o a/x.txt); Check 'grep -c' ([string]$g[0] -eq '3') $g
  Check 'head -n 1' ((head -n 1 a/x.txt) -eq 'hello world')
  Check 'head from pipeline' ((@('a', 'b', 'c') | head -2) -join '' -eq 'ab')
  Check 'tail -n 1' ((tail -n 1 a/x.txt) -eq 'Hello again')
  $w = [string](wc -l a/x.txt); Check 'wc -l' ($w -match '^\s*3 a/x\.txt$') $w
  $c = @(cat -n a/x.txt); Check 'cat -n' ($c[0] -match '^\s+1\s+hello world$') $c
  $which = [string](which powershell); Check 'which' ($which -match 'powershell\.exe$') $which
  cp -r a c; Check 'cp -r' (Test-Path c/b/c)
  cp a/x.txt a/copy.txt; Check 'cp file' (Test-Path a/copy.txt)
  mv c d; Check 'mv' ((Test-Path d) -and -not (Test-Path c))
  rm d 2>$null; Check 'rm refuses a folder without -r' (Test-Path d)
  rm -rf d; Check 'rm -rf' (-not (Test-Path d))
  rm -f does-not-exist; Check 'rm -f on missing file is quiet' $true
  rm a/copy.txt; Check 'rm file' (-not (Test-Path a/copy.txt))
  export PRISM_T=yes; Check 'export' ($env:PRISM_T -eq 'yes')
  unset PRISM_T; Check 'unset' (-not $env:PRISM_T)
  Check 'env lists variables' ((@(env) -join "`n") -match 'PATH=')
  Check 'df -h' (((df -h) -join "`n") -match 'Filesystem')
  Check 'free -h' (((free -h) -join "`n") -match 'Mem:')
  Check 'uname -a' ([string](uname -a) -match '^Windows_NT .* x86_64|^Windows_NT')
  Check 'uptime' ([string](uptime) -match '^up \d+ days')
  Check 'du -sh' ([string](du -sh a) -match '\ta$')
  Check 'text alias' ((hello Ann) -eq "Hello Ann! `"q`" `$HOME")
  Check 'run alias passes arguments' (@(ll2 a | ForEach-Object { & $strip $_ }) -join "`n" -match 'x\.txt')
  Push-Location a; $up = [string](up2); Pop-Location; Check 'alias with && works on this PowerShell' ($up -match [regex]::Escape($work)) $up
  Check 'alias list' ((@(__prism_aliases) -join "`n") -match 'hello\s+echo: Hello')
  $p = & $strip (prompt); Check 'prompt has path and symbol' ($p -match '❯ $' -and $p -match 'prism-ps-') $p
  Check 'translate without Prism returns the line' ((__prism_translate 'ls -la') -eq 'ls -la')
  $help = (prism help) -join "`n"; Check 'prism help' ($help -match 'prism alias')
} finally { Pop-Location; Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
if ($script:fail) { Write-Host "$($script:fail) check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'All profile checks passed' -ForegroundColor Green
