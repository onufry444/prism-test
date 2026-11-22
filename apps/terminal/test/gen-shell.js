// Writes Prism shell startup files into a folder (used by the PowerShell tests on Windows CI).
'use strict';
const path = require('path');
const shells = require('../src/shells');
const { DEFAULTS, merge } = require('../src/config');
const dir = process.argv[2];
if (!dir) { console.error('usage: node gen-shell.js DIR'); process.exit(1); }
require('fs').mkdirSync(dir, { recursive: true });
const cfg = merge(JSON.parse(JSON.stringify(DEFAULTS)), { aliases: [
  { name: 'hello', type: 'text', body: 'Hello {1}! "q" $HOME' },
  { name: 'll2', type: 'run', body: 'ls -la' },
  { name: 'up2', type: 'run', body: 'cd .. && pwd' }
] });
shells.writeAll(dir, cfg, path.join(__dirname, '..', 'src', 'shell'));
console.log('shell files written to', dir);
