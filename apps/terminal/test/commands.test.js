// Test generatora komend: tworzy pliki startowe i uruchamia je w prawdziwym bash.
// Sprawdza własne komendy, listę komend i wiadomości do aplikacji przez folder PRISM_INBOX.
'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { execFileSync } = require('child_process');
const { writeAll } = require('../src/commands');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));
const inbox = path.join(dir, 'inbox');
fs.mkdirSync(inbox);
const cmds = [
  { name: 'hej', type: 'text', body: 'Cześć {1}! "cytat" $HOME `x` \\n {args}' },
  { name: 'dwa', type: 'run', body: 'echo pierwszy {1}; echo drugi' },
  { name: 'zla nazwa', type: 'text', body: 'x' },
  { name: 'settings', type: 'text', body: 'zarezerwowana' }
];
const ok = writeAll(dir, cmds, 'linux');
assert.deepStrictEqual(ok.map(c => c.name), ['hej', 'dwa'], 'odrzuca złe i zarezerwowane nazwy');

const input = ['hej Ola Ala', 'dwa X', 'komendy | head -3', 'settings terminal', 'dodaj-komende -u nowa "ls -la"', 'exit', ''].join('\n');
const out = execFileSync('bash', ['--rcfile', path.join(dir, 'init.bash'), '-i'], {
  input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: dir, PRISM_INBOX: inbox }
});
console.log(out);
assert.match(out, /Cześć Ola! "cytat" \$HOME `x` \\n Ola Ala/);
assert.match(out, /pierwszy X\ndrugi/);
assert.match(out, /Twoje komendy:/);

const msgs = fs.readdirSync(inbox).map(f => fs.readFileSync(path.join(inbox, f), 'utf8').trim()).sort();
console.log('wiadomości:', msgs);
assert.ok(msgs.includes('panel;terminal'), 'settings wysyła panel;terminal');
const add = msgs.find(m => m.startsWith('add;'));
assert.ok(add, 'dodaj-komende wysyła add;');
assert.strictEqual(Buffer.from(add.slice(4), 'base64').toString('utf8'), 'run\tnowa\tls -la');

const ps = fs.readFileSync(path.join(dir, 'commands.ps1'), 'utf8');
assert.match(ps, /function global:hej \{\r\n  Write-Output "Cześć \$\(\$args\[0\]\)! `"cytat`" `\$HOME ``x`` \\n \$\(\$args -join ' '\)"/);
const bat = fs.readFileSync(path.join(dir, 'init.cmd'), 'utf8');
console.log(bat.split('\r\n').slice(0, 4).join('\n'));
assert.ok(bat.startsWith('@chcp 65001 >nul\r\n'));
// hej: tekst z cudzysłowami, $, backtickiem i argumentami, wszystko zabezpieczone przed cmd
assert.ok(bat.includes('@doskey hej=@echo(Cześć $1! ^^^"cytat^^^" $$HOME `x` \\n $*\r\n'), 'makro hej');
assert.ok(bat.includes('@doskey dwa=@echo pierwszy $1 ^& echo drugi\r\n'), 'makro dwa');
assert.ok(bat.includes('@doskey settings=@echo(panel;$1^>^"%%PRISM_INBOX%%\\cmd-%%RANDOM%%%%RANDOM%%.msg^"\r\n'), 'makro settings');
console.log('OK: wszystkie testy generatora komend przeszły');
