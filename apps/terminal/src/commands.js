'use strict';
// Zamienia listę własnych komend na pliki startowe dla bash, zsh, PowerShell i cmd.
// Każda komenda staje się prawdziwą funkcją powłoki, więc działa z potokami, przekierowaniami itd.
//
// Komendy Prism (settings, krycie, dodaj-komende…) wysyłają wiadomość do okna aplikacji.
// Jeśli powłoka ma zmienną PRISM_INBOX, wiadomość trafia jako mały plik do tego folderu
// (działa zawsze, także przez ConPTY w Windows). Bez niej używana jest sekwencja OSC 7777.
const fs = require('fs');
const path = require('path');

const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/;
const RESERVED = new Set(['settings', 'ustawienia', 'tutorial', 'pomoc', 'motyw', 'krycie', 'czcionka', 'dodaj-komende', 'komendy', 'prism']);
const PH = /\{(\d+|args|date|time|user)\}/g;

const validName = n => typeof n === 'string' && NAME.test(n) && !RESERVED.has(n);

function clean(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter(c => c && validName(c.name) && typeof c.body === 'string' && !seen.has(c.name) && seen.add(c.name))
    .map(c => ({ name: c.name, type: c.type === 'run' ? 'run' : 'text', body: c.body.replace(/\r\n?/g, '\n'), desc: String(c.desc || '') }));
}

const APP_HELP = [
  'Komendy Prism:',
  '  settings              ustawienia: motyw Windows, kolory, tapeta, okna, terminal',
  '  krycie 0-100          przezroczystość terminala',
  '  czcionka 10-28        rozmiar czcionki',
  '  motyw NAZWA           kolory terminala: grafit, szklo, papier, fosfor, morze, sliwka',
  '  dodaj-komende [-u] NAZWA "treść"   nowa komenda (-u = treść to polecenia)',
  '  tutorial              samouczek krok po kroku',
  '  prism apply MOTYW     motyw całego Windows (prism restore = oryginał)',
  '',
  'Skróty: Ctrl+Shift+T nowa karta, Ctrl+, ustawienia, Ctrl+Shift+C/V kopiuj/wklej'
];

function listing(cmds, withApp = true) {
  const rows = cmds.map(c => `  ${c.name.padEnd(20)}  ${c.desc || (c.type === 'run' ? 'uruchamia: ' : 'wypisuje: ') + c.body.split('\n')[0]}`);
  return ['Twoje komendy:', ...(rows.length ? rows : ['  (brak, dodaj: dodaj-komende NAZWA "tekst")']), ...(withApp ? ['', ...APP_HELP] : [])].join('\n');
}

// ---------- bash / zsh ----------
const sq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const shText = b => '"' + b.replace(/[\\"`$]/g, '\\$&').replace(PH, (m, k) =>
  k === 'args' ? '$*' : k === 'date' ? '$(date +%Y-%m-%d)' : k === 'time' ? '$(date +%H:%M)' : k === 'user' ? '$USER' : '${' + k + '}') + '"';
const shRun = b => b.replace(PH, (m, k) =>
  k === 'args' ? '"$@"' : k === 'date' ? '"$(date +%Y-%m-%d)"' : k === 'time' ? '"$(date +%H:%M)"' : k === 'user' ? '"$USER"' : '"${' + k + '}"');

function posix(cmds, zsh) {
  const L = [
    '# Wygenerowane przez Prism. Nie edytuj ręcznie.',
    zsh ? 'for __n in ${=__TC_NAMES}; do unfunction "$__n" 2>/dev/null; done'
        : 'for __n in $__TC_NAMES; do unset -f "$__n" 2>/dev/null; done',
    '__TC_NAMES=' + sq(cmds.map(c => c.name).join(' '))
  ];
  for (const c of cmds) {
    L.push(`unalias ${c.name} 2>/dev/null`, `function ${c.name} {`);
    L.push(c.type === 'text' ? `  printf '%s\\n' ${shText(c.body)}` : (shRun(c.body).trim() || ':'));
    L.push('}');
  }
  L.push(`function komendy { printf '%s\\n' ${sq(listing(cmds))}; }`);
  L.push('function pomoc { komendy; }');
  return L.join('\n') + '\n';
}

const POSIX_BUILTINS = `
__tc_msg() {
  if [ -n "$PRISM_INBOX" ] && [ -d "$PRISM_INBOX" ]; then printf '%s\\n' "$1" > "$PRISM_INBOX/sh-$$-$RANDOM$RANDOM.msg"
  else printf '\\033]7777;%s\\007' "$1"; fi
}
function settings { __tc_msg "panel;$1"; }
function ustawienia { __tc_msg "panel;$1"; }
function tutorial { __tc_msg "tutorial;"; }
function motyw { __tc_msg "theme;$*"; }
function krycie { __tc_msg "opacity;$1"; }
function czcionka { __tc_msg "font;$1"; }
function dodaj-komende {
  local t=text
  if [ "$1" = "-u" ] || [ "$1" = "--uruchom" ]; then t=run; shift; fi
  if [ $# -lt 2 ]; then echo 'użycie: dodaj-komende [-u] NAZWA "treść"' >&2; return 1; fi
  local n="$1"; shift
  __tc_msg "add;$(printf '%s\\t%s\\t%s' "$t" "$n" "$*" | base64 | tr -d '\\n')"
  echo "Dodano komendę $n. Działa od następnego polecenia."
}
`;

function bashInit(dir) {
  return `# Prism: start bash
if [ -f ~/.bashrc ]; then . ~/.bashrc; elif [ -f ~/.bash_profile ]; then . ~/.bash_profile; fi
__TC_DIR=${sq(dir)}
__TC_VER=
${POSIX_BUILTINS}
__tc_reload() {
  local v; read -r v < "$__TC_DIR/version" 2>/dev/null
  if [ "$v" != "$__TC_VER" ]; then __TC_VER=$v; . "$__TC_DIR/commands.bash"; fi
}
__tc_reload
PROMPT_COMMAND="__tc_reload\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`;
}

function zshFiles(dir) {
  const real = 'REAL="${TC_REAL_ZDOTDIR:-$HOME}"';
  return {
    '.zshenv': `${real}; [ -f "$REAL/.zshenv" ] && source "$REAL/.zshenv"\n`,
    '.zprofile': `${real}; [ -f "$REAL/.zprofile" ] && source "$REAL/.zprofile"\n`,
    '.zshrc': `# Prism: start zsh
ZDOTDIR="\${TC_REAL_ZDOTDIR:-$HOME}"
[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"
__TC_DIR=${sq(dir)}
__TC_VER=
${POSIX_BUILTINS}
__tc_reload() {
  local v; v=$(<"$__TC_DIR/version") 2>/dev/null
  if [[ "$v" != "$__TC_VER" ]]; then __TC_VER=$v; source "$__TC_DIR/commands.zsh"; fi
}
__tc_reload
autoload -Uz add-zsh-hook && add-zsh-hook precmd __tc_reload
`
  };
}

// ---------- PowerShell ----------
const psq = s => "'" + String(s).replace(/['‘’‚‛]/g, '$&$&') + "'";
const psText = b => '"' + b.replace(/[`"$“”„]/g, '`$&').replace(PH, (m, k) =>
  k === 'args' ? "$($args -join ' ')" : k === 'date' ? "$(Get-Date -Format 'yyyy-MM-dd')" : k === 'time' ? "$(Get-Date -Format 'HH:mm')"
  : k === 'user' ? '$([Environment]::UserName)' : '$($args[' + (k - 1) + '])') + '"';
const psRun = b => b.replace(PH, (m, k) =>
  k === 'args' ? '@args' : k === 'date' ? "(Get-Date -Format 'yyyy-MM-dd')" : k === 'time' ? "(Get-Date -Format 'HH:mm')"
  : k === 'user' ? '([Environment]::UserName)' : '$args[' + (k - 1) + ']');

function powershell(cmds) {
  const L = [
    '# Wygenerowane przez Prism. Nie edytuj ręcznie.',
    'foreach ($n in @($global:__TC_NAMES)) { if ($n) { Remove-Item -Path "function:\\$n" -ErrorAction SilentlyContinue } }',
    '$global:__TC_NAMES = @(' + cmds.map(c => psq(c.name)).join(', ') + ')'
  ];
  for (const c of cmds) {
    L.push(`Remove-Item -Path ${psq('alias:\\' + c.name)} -Force -ErrorAction SilentlyContinue`, `function global:${c.name} {`);
    L.push(c.type === 'text' ? `  Write-Output ${psText(c.body)}` : (psRun(c.body).trim() || '$null'));
    L.push('}');
  }
  L.push(`function global:komendy { Write-Output ${psq(listing(cmds))} }`);
  L.push('function global:pomoc { komendy }');
  return L.join('\r\n') + '\r\n';
}

function psInit(dir) {
  return `# Prism: start PowerShell
$global:__TC_DIR = ${psq(dir)}
$global:__TC_VER = ''
function global:__tc_msg([string]$s) {
  if ($env:PRISM_INBOX -and (Test-Path -LiteralPath $env:PRISM_INBOX)) {
    $f = Join-Path $env:PRISM_INBOX ('ps-{0}-{1}.msg' -f $PID, [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($f, "$s\`n")
  } else { Write-Host -NoNewline "$([char]27)]7777;$s$([char]7)" }
}
function global:settings { __tc_msg "panel;$($args[0])" }
function global:ustawienia { __tc_msg "panel;$($args[0])" }
function global:tutorial { __tc_msg 'tutorial;' }
function global:motyw { __tc_msg "theme;$($args -join ' ')" }
function global:krycie { __tc_msg "opacity;$($args[0])" }
function global:czcionka { __tc_msg "font;$($args[0])" }
function global:dodaj-komende {
  $t = 'text'; $a = @($args)
  if ($a.Count -gt 0 -and ($a[0] -eq '-u' -or $a[0] -eq '--uruchom')) { $t = 'run'; $a = @($a | Select-Object -Skip 1) }
  if ($a.Count -lt 2) { Write-Host 'użycie: dodaj-komende [-u] NAZWA "treść"'; return }
  $s = "$t\`t$($a[0])\`t$((@($a | Select-Object -Skip 1)) -join ' ')"
  __tc_msg ("add;" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)))
  Write-Host "Dodano komendę $($a[0]). Działa od następnego polecenia."
}
function global:__tc_reload {
  try { $v = [IO.File]::ReadAllText((Join-Path $global:__TC_DIR 'version')).Trim() } catch { return }
  if ($v -ne $global:__TC_VER) { $global:__TC_VER = $v; . (Join-Path $global:__TC_DIR 'commands.ps1') }
}
__tc_reload
$global:__TC_PROMPT = $function:prompt
function global:prompt { __tc_reload; & $global:__TC_PROMPT }
`.replace(/\n/g, '\r\n');
}

// ---------- cmd (doskey) ----------
const dk = b => b.replace(/[$<>|]/g, ch => ({ '$': '$$', '<': '$L', '>': '$G', '|': '$B' }[ch])).replace(PH, (m, k) =>
  k === 'args' ? '$*' : k === 'date' ? '%DATE%' : k === 'time' ? '%TIME:~0,5%' : k === 'user' ? '%USERNAME%' : (+k <= 9 ? '$' + k : ''));
const echoLines = text => text.split('\n').map(l => l.trim() ? 'echo ' + dk(l) : 'echo.').join(' $T ');

function doskey(cmds) {
  const L = cmds.map(c => c.name + '=' + (c.type === 'text' ? echoLines(c.body) : dk(c.body.trim()).replace(/\s*[;\n]\s*/g, ' $T ')));
  const msg = m => `echo ${m}$G"%PRISM_INBOX%\\cmd-%RANDOM%%RANDOM%.msg"`;
  L.push('settings=' + msg('panel;$1'), 'ustawienia=' + msg('panel;$1'), 'tutorial=' + msg('tutorial;'));
  L.push('krycie=' + msg('opacity;$1'), 'czcionka=' + msg('font;$1'), 'motyw=' + msg('theme;$1'));
  const help = listing(cmds, false) + '\n\nKomendy Prism: settings, krycie 0-100, czcionka 10-28, motyw NAZWA, tutorial\n(dodawanie komend z terminala działa w PowerShell)';
  L.push('komendy=' + echoLines(help), 'pomoc=' + echoLines(help));
  return L.join('\r\n') + '\r\n';
}

// ---------- zapis ----------
function writeAll(dir, list, platform = process.platform) {
  const cmds = clean(list);
  const shDir = platform === 'win32' ? dir.replace(/\\/g, '/') : dir;
  fs.mkdirSync(path.join(dir, 'zsh'), { recursive: true });
  const BOM = '﻿';
  const files = {
    'commands.bash': posix(cmds, false),
    'commands.zsh': posix(cmds, true),
    'init.bash': bashInit(shDir),
    'commands.ps1': BOM + powershell(cmds),
    'init.ps1': BOM + psInit(dir),
    'macros.doskey': doskey(cmds)
  };
  for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), s);
  for (const [f, s] of Object.entries(zshFiles(shDir))) fs.writeFileSync(path.join(dir, 'zsh', f), s);
  fs.writeFileSync(path.join(dir, 'version'), String(Date.now()) + '\n'); // na końcu: sygnał dla otwartych kart
  return cmds;
}

module.exports = { writeAll, clean, validName, RESERVED: [...RESERVED], _gen: { posix, powershell, doskey } };
