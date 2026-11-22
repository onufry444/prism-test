// Shell integration tests: generated startup files, aliases, Prism commands, config parsing.
// Runs the bash files in real bash; PowerShell files are tested on Windows in CI (test/profile.tests.ps1).
'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { execFileSync } = require('child_process');
const shells = require('../src/shells');
const { DEFAULTS, parseJsonc, merge } = require('../src/config');

// --- config.jsonc parsing
const parsed = parseJsonc(`// comment
{
  "a": 1, // trailing comment
  /* block
     comment */ "b": "x // not a comment", "c": [1, 2,],
}`);
assert.deepStrictEqual(parsed, { a: 1, b: 'x // not a comment', c: [1, 2] });
assert.deepStrictEqual(merge({ a: { b: 1, c: 2 }, l: [1] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] });
const template = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8').match(/const CONFIG_TEMPLATE = `([\s\S]*?)`;/)[1].replace(/\\\\/g, '\\');
assert.deepStrictEqual(parseJsonc(template), {}, 'template is valid JSONC with everything commented out');

// --- generated files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));
const inbox = path.join(dir, 'inbox'); fs.mkdirSync(inbox);
const cfg = merge(JSON.parse(JSON.stringify(DEFAULTS)), {
  aliases: [
    { name: 'hello', type: 'text', body: 'Hello {1}! "quoted" $HOME `tick` {args}' },
    { name: 'two', type: 'run', body: 'echo first {1}; echo second' },
    { name: 'll', type: 'run', body: 'ls -la' },
    { name: 'up', type: 'run', body: 'cd .. && ls' },
    { name: 'bad name', body: 'x' }, { name: 'settings', body: 'x' }, { name: 'empty', body: '  ' }
  ]
});
const ok = shells.writeAll(dir, cfg, path.join(__dirname, '..', 'src', 'shell'), 'linux');
assert.deepStrictEqual(ok.map(c => c.name), ['hello', 'two', 'll', 'up'], 'invalid and reserved names are skipped');

const input = ['hello Ann Bob', 'two X', 'type ll | head -3', 'll_out=$(declare -f ll); echo "$ll_out" | grep -c "ls -la \\"\\$@\\""',
  'prism alias', 'settings dock', 'prism alias gc "git commit -m"', 'Get-Nothing-Here', 'echo "PS1 set: ${PS1:+yes}"', 'exit', ''].join('\n');
let out;
try {
  out = execFileSync('bash', ['--rcfile', path.join(dir, 'init.bash'), '-i'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: dir, PRISM_INBOX: inbox } });
} catch (e) { out = e.stdout + e.stderr; }
console.log(out);
assert.match(out, /Hello Ann! "quoted" \$HOME `tick` Ann Bob/);
assert.match(out, /first X\nsecond/);
assert.match(out, /\n1\n/, 'single-command alias passes extra arguments');
assert.match(out, /hello\s+echo: Hello/);
assert.match(out, /PS1 set: yes/);
const msgs = fs.readdirSync(inbox).map(f => fs.readFileSync(path.join(inbox, f), 'utf8').trim()).sort();
console.log('messages:', msgs);
assert.ok(msgs.includes('panel;dock'));
const add = msgs.find(m => m.startsWith('add;'));
assert.strictEqual(Buffer.from(add.slice(4), 'base64').toString(), 'run\tgc\tgit commit -m');

// --- PowerShell output (syntax is checked on Windows)
const ps = fs.readFileSync(path.join(dir, 'aliases.ps1'), 'utf8');
assert.ok(ps.startsWith('﻿'), 'PowerShell files have a BOM for Windows PowerShell 5.1');
assert.match(ps, /function global:hello \{\r\n  Write-Output "Hello \$\(\$args\[0\]\)! `"quoted`" `\$HOME ``tick`` \$\(\$args -join ' '\)"/);
assert.match(ps, /function global:ll \{\r\n  ls -la @args\r\n\}/);
assert.match(ps, /function global:up \{\r\n  cd \.\.; \$__p = \$\?; if \(\$__p\) \{ ls; \$__p = \$\? \}\r\n\}/, 'bash && in alias bodies becomes PowerShell');
const conf = fs.readFileSync(path.join(dir, 'config.ps1'), 'utf8');
assert.match(conf, /translate = \$true/);
assert.match(conf, /segments = @\('path', 'git', 'venv', 'duration', 'status'\)/);
const bat = fs.readFileSync(path.join(dir, 'init.cmd'), 'utf8');
assert.ok(bat.startsWith('@chcp 65001 >nul\r\n'));
assert.ok(bat.includes('@doskey hello=@echo(Hello $1! ^^^"quoted^^^" $$HOME `tick` $*\r\n'), 'cmd text alias');
assert.ok(bat.includes('@doskey two=@echo first $1 ^& echo second\r\n'), 'cmd run alias');
assert.ok(bat.includes('@doskey ll=@ls -la $*\r\n'), 'cmd alias passes args');
assert.ok(bat.includes('@doskey settings=@echo(panel;$*^>^"%%PRISM_INBOX%%\\cmd-%%RANDOM%%%%RANDOM%%.msg^"\r\n'));
console.log('OK: shell integration tests passed');
