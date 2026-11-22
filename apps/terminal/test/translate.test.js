// Unit tests for the bash/cmd -> PowerShell translator.
'use strict';
const assert = require('assert');
const { translate } = require('../src/translate');

const env = ['PATH', 'USERPROFILE', 'APPDATA', 'JAVA_HOME', 'USERNAME', 'TEMP'];
let n = 0;
function t(input, expected, opts = {}) {
  const r = translate(input, { env, vars: ['x', 'home', 'pwd', 'PSVersionTable'], ...opts });
  assert.strictEqual(r.line, expected, `\n  input:    ${input}\n  got:      ${r.line}\n  expected: ${expected}`);
  n++;
  return r;
}
const same = (input, opts) => { const r = t(input, input, opts); assert.strictEqual(r.changed, false, input); };

// left alone: PowerShell, plain commands, GNU-style commands handled by the Prism profile
same('Get-ChildItem -Recurse | Where-Object { $_.Length -gt 1kb }');
same('ls -la');
same('rm -rf node_modules');
same('git commit -m "fix: a && b"');
same("echo 'cost is $PATH'");
same('$x = 5; echo $x');
same('dir');
same('dir C:\\Windows');
same(' dir /s', {});
same('npm run build && npm test', { ps7: true });
same('Get-Process | where CPU -gt 10');
same('$env:PATH');
same('cd ..');

// && and || in Windows PowerShell 5.1
t('npm run build && npm test', 'npm run build; $__p = $?; if ($__p) { npm test; $__p = $? }');
t('make || echo failed', 'make; $__p = $?; if (-not $__p) { echo failed; $__p = $? }');
t('a && b || c', 'a; $__p = $?; if ($__p) { b; $__p = $? }; if (-not $__p) { c; $__p = $? }');
t('cd src && ls -la | grep foo', 'cd src; $__p = $?; if ($__p) { ls -la | grep foo; $__p = $? }');
t('a && b; c', 'a; $__p = $?; if ($__p) { b; $__p = $? }; c');

// variables
t('echo $PATH', 'echo $env:PATH');
t('echo "home is $USERPROFILE"', 'echo "home is $env:USERPROFILE"');
t('echo ${JAVA_HOME}/bin', 'echo $env:JAVA_HOME/bin');
t('echo $USER', 'echo $env:USERNAME');
t('echo %APPDATA%\\Code', 'echo $env:APPDATA\\Code');
t('echo $((2 + 3))', 'echo $(2 + 3)');
same('echo $HOME');
same('echo %notavar%');

// one-shot environment and redirections
t('NODE_ENV=production node app.js', "$env:NODE_ENV = 'production'; node app.js");
t('OUT=$TEMP/x run', '$env:OUT = "$env:TEMP/x"; run');
t('DEBUG="app:*" npm start', '$env:DEBUG = "app:*"; npm start');
t('FOO=bar', "$env:FOO = 'bar'");
t('cat log.txt 2>/dev/null', 'cat log.txt 2>$null');
t('build > /dev/null', 'build > $null');
t('build &>/dev/null', 'build *>$null');
t('sort < names.txt', 'Get-Content names.txt | sort');
t('make |& grep error', 'make 2>&1| grep error', { ps7: true });

// navigation
t('cd', 'Set-Location ~');
t('cd -', 'Set-Location $global:PRISM_OLDPWD');
same('cd -', { ps7: true });
t('..', 'Set-Location ..');
t('...', 'Set-Location ../..');
t('~', 'Set-Location ~');
t('cd /d D:\\work', 'Set-Location D:\\work');

// cmd
t('dir /s /b *.log', 'Get-ChildItem *.log -Recurse -Name');
t('dir /a', 'Get-ChildItem -Force');
t('dir /ad', 'Get-ChildItem -Directory');
t('del /f /q temp.txt', 'Remove-Item temp.txt -Force');
t('del /s /q *.tmp', 'Remove-Item *.tmp -Recurse -Force');
t('rd /s /q build', 'Remove-Item build -Recurse -Force');
t('rmdir /s dist', 'Remove-Item dist -Recurse -Force');
t('copy /y a.txt b.txt', 'Copy-Item a.txt b.txt -Force');
t('move /y a.txt old\\', 'Move-Item a.txt old\\ -Force');
t('set NODE_ENV=dev', "$env:NODE_ENV = 'dev'");
t('set GREETING=hello world', "$env:GREETING = 'hello world'");
t('set', 'Get-ChildItem env:');
t('set PATH', 'Get-ChildItem env:PATH*');
t('where python', 'where.exe python');
t('sc query wuauserv', 'sc.exe query wuauserv');
t('mklink /D link target', 'cmd /c mklink /D link target');
t('ver', 'cmd /c ver');
t('call build.bat', '& build.bat');
t('title My build', "$Host.UI.RawUI.WindowTitle = 'My build'");
t('title build', "$Host.UI.RawUI.WindowTitle = 'build'");
t('echo.', "Write-Output ''");
t('exit /b 1', 'exit 1');

// bash
t('source ./env.ps1', '. ./env.ps1');
t("alias ll='ls -l'", "prism alias ll 'ls -l'");
t('alias gs="git status"', 'prism alias gs "git status"');
t('alias', 'prism alias');
t('unalias ll', 'prism unalias ll');
t('export PATH="$PATH:/c/tools"', 'export PATH="$env:PATH;/c/tools"');
t('sudo !!', 'sudo winget upgrade --all', { last: 'winget upgrade --all' });
t('cat !$', 'cat notes.txt', { last: 'vim notes.txt' });

// dialect reporting
assert.deepStrictEqual(translate('dir /s', { env }).dialects, ['cmd']);
assert.deepStrictEqual(translate('a && b', { env }).dialects, ['bash']);
assert.deepStrictEqual(translate('ls', { env }).dialects, []);

// administrator rights
const { needsAdmin, sudoRest } = require('../src/translate');
for (const l of ['sfc /scannow', 'DISM /Online /Cleanup-Image /RestoreHealth', 'choco install git -y', 'Set-ExecutionPolicy RemoteSigned',
  'Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux', 'net user bob pw /add', 'reg add HKLM\\Software\\X /v a /d 1',
  'echo hi; sfc /scannow', 'netsh winsock reset', 'sc.exe create svc binPath= x', 'New-NetFirewallRule -DisplayName x', 'chkdsk C: /f', 'diskpart', 'net stop spooler']) {
  assert.ok(needsAdmin(l), 'needs admin: ' + l); n++;
}
for (const l of ['sfc /?', 'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser', 'choco list', 'reg add HKCU\\Software\\X', 'net user', 'sc query',
  'ls -la', 'echo sfc /scannow', 'git status', 'chkdsk C:', 'dism /?', 'Get-Service', '']) {
  assert.ok(!needsAdmin(l), 'no admin needed: ' + l); n++;
}
assert.strictEqual(sudoRest('sudo choco install x && echo y'), 'choco install x && echo y');
assert.strictEqual(sudoRest('  sudo   ls'), 'ls');
assert.strictEqual(sudoRest('sudo'), '');
assert.strictEqual(sudoRest('sudoku'), null);
assert.strictEqual(sudoRest('echo sudo x'), null);
n += 5;

console.log(`OK: ${n} translator cases passed`);
