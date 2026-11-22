'use strict';
// Run one command with administrator rights, on request, while Prism itself stays a normal process.
//
//   shell tab ──(sudo / "Run as admin? y")──▶ inbox message "elevate;<request>"
//   Prism ──UAC──▶ Prism.exe --elevate <request>   (a second, elevated, window-less Prism)
//   the elevated helper runs the command in its own pseudo console and streams it back over two pipes;
//   meanwhile Prism shows that output in the tab and sends your keys to it instead of the shell.
//   When the command ends, Prism writes <results>/<id>.json and the waiting shell picks up the exit code.
//
// The helper only ever runs the command it was started with (the one the UAC prompt approved), and it only
// talks to the pipe served by the exact Prism process that asked (checked by process id and executable).
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const unb64 = s => Buffer.from(String(s || ''), 'base64').toString('utf8');
const psQuote = s => "'" + String(s).replace(/'/g, "''") + "'";
const psEncoded = script => Buffer.from(script, 'utf16le').toString('base64');

// How the elevated side runs the command, per shell kind. Returns { file, args } for node-pty (args may be a raw string).
function commandFor(req) {
  const cwd = req.cwd && fs.existsSync(req.cwd) ? req.cwd : os.homedir();
  if (req.kind === 'cmd') return { file: 'cmd.exe', args: `/d /s /c "cd /d "${cwd}" && ${req.cmd}"`, cwd };
  if (req.kind === 'bash') return { file: req.shell || 'bash.exe', args: ['-lc', `cd '${cwd.replace(/'/g, `'\\''`)}' && ${req.cmd}`], cwd };
  // PowerShell, with the Prism profile so Linux commands and aliases work the same as in the tab
  const script = [
    req.init ? `try { . ${psQuote(req.init)} } catch {}` : '',
    `Set-Location -LiteralPath ${psQuote(cwd)}`,
    '$global:LASTEXITCODE = 0',
    req.cmd,
    'if (-not $?) { if ($global:LASTEXITCODE) { exit $global:LASTEXITCODE } else { exit 1 } }',
    'exit $global:LASTEXITCODE'
  ].filter(Boolean).join('\n');
  return { file: req.shell || 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(script)], cwd };
}

// ------------------------------------------------------------------ the normal (non-elevated) Prism
class Elevator {
  // host: { exe, exeArgs, resultsDir, initScript, mode(), tab(key) -> { cols, rows, profile, send(data) } , onState(key, on) }
  constructor(host) { this.host = host; this.sessions = new Map(); }
  has(tab) { return this.sessions.has(tab); }
  input(tab, data) { const s = this.sessions.get(tab); if (!s) return false; s.send({ t: 'in', d: data }); return true; }
  resize(tab, cols, rows) { this.sessions.get(tab)?.send({ t: 'resize', c: cols, r: rows }); }
  kill(tab) { const s = this.sessions.get(tab); if (s) { s.send({ t: 'kill' }); s.finish({ code: 130, message: 'Stopped.' }); } }

  result(id, r) {
    try {
      fs.mkdirSync(this.host.resultsDir, { recursive: true });
      const f = path.join(this.host.resultsDir, `${id}.json`);
      fs.writeFileSync(f + '.tmp', JSON.stringify(r)); fs.renameSync(f + '.tmp', f);
    } catch (e) { console.error('Prism: could not write the elevation result', e.message); }
  }

  // req (from the shell): { id, tab, kind, cmd, cwd }
  start(req) {
    if (!/^[0-9a-f]{32}$/.test(req.id || '')) return;
    const tab = this.host.tab(req.tab);
    if (!tab) return this.result(req.id, { code: 1, message: 'Prism could not find the tab that asked.' });
    if (this.sessions.has(req.tab)) return this.result(req.id, { code: 1, message: 'An admin command is already running in this tab.' });
    const kind = ['cmd', 'bash'].includes(req.kind) ? req.kind : 'pwsh';
    const full = { kind, cmd: String(req.cmd || ''), cwd: String(req.cwd || ''), shell: kindShell(kind, tab.profile), init: kind === 'pwsh' ? this.host.initScript : '' };
    if (!full.cmd.trim()) return this.result(req.id, { code: 0 });
    if (this.host.mode() === 'window') return this.window(req.id, full);
    this.inline(req.id, req.tab, tab, full);
  }

  // A separate admin console window. Prism does not wait for it.
  window(id, full) {
    const c = commandFor(full);
    let file = c.file, args = c.args;
    if (full.kind === 'pwsh') args = ['-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(`Set-Location -LiteralPath ${psQuote(c.cwd)}\n${full.init ? `try { . ${psQuote(full.init)} } catch {}\n` : ''}${full.cmd}`)];
    else if (full.kind === 'cmd') args = `/d /k "cd /d "${c.cwd}" && ${full.cmd}"`;
    else args = ['-lc', `${full.cmd}; exec bash -i`];
    const list = Array.isArray(args) ? args.map(a => psQuote(/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(', ') : psQuote(args);
    runAs(`Start-Process -FilePath ${psQuote(file)} -WorkingDirectory ${psQuote(c.cwd)} -ArgumentList ${list} -Verb RunAs`, ok => {
      this.result(id, ok ? { code: 0, message: 'Running in a new administrator window.' } : { code: 1223, cancelled: true, message: 'Cancelled: Windows did not give administrator rights.' });
    });
  }

  inline(id, key, tab, full) {
    const base = 'prism-elev-' + crypto.randomBytes(16).toString('hex');
    const s = { out: null, in: null, buf: '', done: false, queue: [] };
    const servers = [];
    s.send = m => { const line = JSON.stringify(m) + '\n'; if (s.in) s.in.write(line); else s.queue.push(line); };
    s.finish = r => {
      if (s.done) return; s.done = true;
      clearTimeout(s.timer);
      servers.forEach(x => { try { x.close(); } catch {} });
      try { s.in?.destroy(); s.out?.destroy(); } catch {}
      this.sessions.delete(key);
      this.host.onState(key, false);
      this.result(id, r);
    };
    const serve = (suffix, onSock) => {
      const server = net.createServer(sock => {
        server.close(); // one client only
        if (s.done) return sock.destroy();
        sock.on('error', () => {});
        onSock(sock);
      });
      server.on('error', e => s.finish({ code: 1, message: 'Prism could not open the admin pipe: ' + e.message }));
      server.listen(`\\\\.\\pipe\\${base}-${suffix}`);
      servers.push(server);
    };
    serve('out', sock => {
      s.out = sock;
      sock.setEncoding('utf8');
      sock.on('data', d => {
        s.buf += d;
        let i;
        while ((i = s.buf.indexOf('\n')) >= 0) {
          const line = s.buf.slice(0, i); s.buf = s.buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.t === 'data') tab.send(m.d);
          else if (m.t === 'ready') { clearTimeout(s.timer); this.host.onState(key, true); }
          else if (m.t === 'exit') s.finish({ code: m.code | 0 });
          else if (m.t === 'error') s.finish({ code: 1, message: 'Admin helper: ' + m.message });
        }
      });
      sock.on('close', () => s.finish({ code: 1, message: 'The admin command ended unexpectedly.' }));
    });
    serve('in', sock => { s.in = sock; for (const l of s.queue.splice(0)) sock.write(l); });
    this.sessions.set(key, s);

    const req = { pipe: base, parent: process.pid, cols: tab.cols, rows: tab.rows, ...full };
    const args = [...this.host.exeArgs, '--elevate', Buffer.from(JSON.stringify(req), 'utf8').toString('base64')];
    runAs(`Start-Process -FilePath ${psQuote(this.host.exe)} -ArgumentList ${args.map(a => psQuote(/\s/.test(a) ? `"${a}"` : a)).join(', ')} -Verb RunAs`, ok => {
      if (!ok) return s.finish({ code: 1223, cancelled: true, message: 'Cancelled: Windows did not give administrator rights.' });
      s.timer = setTimeout(() => s.finish({ code: 1, message: 'The admin helper did not start.' }), 30000);
    });
  }
}

// The shell executable the elevated side should use for a tab's profile.
function kindShell(kind, profile) {
  if (kind === 'cmd') return 'cmd.exe';
  if (profile && profile.kind === kind) return profile.cmd;
  return kind === 'bash' ? 'bash.exe' : 'powershell.exe';
}

// Runs a Start-Process ... -Verb RunAs line; ok = false when the UAC prompt was declined or failed.
function runAs(line, done) {
  const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(`$ErrorActionPreference = 'Stop'\n${line}`)], { windowsHide: true });
  p.on('error', () => done(false));
  p.on('close', code => done(code === 0));
}

// ------------------------------------------------------------------ the elevated helper (Prism.exe --elevate)
function runHelper(arg, { pty, win32, exit }) {
  let req, out, inp;
  const fail = msg => { try { out && out.write(JSON.stringify({ t: 'error', message: msg }) + '\n'); } catch {} exit(1); };
  try { req = JSON.parse(unb64(arg)); } catch { return exit(2); }
  try {
    out = win32.pipeOpen(`\\\\.\\pipe\\${req.pipe}-out`);
    inp = win32.pipeOpen(`\\\\.\\pipe\\${req.pipe}-in`);
  } catch { return exit(3); }
  // only the Prism process that asked may receive output or send keys
  const me = process.execPath.toLowerCase();
  for (const p of [out, inp]) {
    if (p.serverPid !== req.parent || win32.exePath(p.serverPid).toLowerCase() !== me) { out.close(); inp.close(); return exit(4); }
  }
  const send = m => out.write(JSON.stringify(m) + '\n');
  let child;
  try {
    const c = commandFor(req);
    child = pty.spawn(c.file, c.args, { name: 'xterm-256color', cols: Math.max(2, req.cols | 0 || 120), rows: Math.max(2, req.rows | 0 || 30), cwd: c.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Prism', PRISM_ELEVATED: '1', CHERE_INVOKING: '1' } });
  } catch (e) { return fail(e.message); }
  send({ t: 'ready' });
  child.onData(d => send({ t: 'data', d }));
  // the input pipe is left to process exit: closing it while a read is pending could block
  child.onExit(({ exitCode }) => { send({ t: 'exit', code: exitCode }); setTimeout(() => { out.close(); exit(0); }, 50); });
  let buf = '';
  inp.readLoop(chunk => {
    if (chunk === null) { try { child.kill(); } catch {} return; }
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'in') child.write(String(m.d));
      else if (m.t === 'resize') { try { child.resize(Math.max(2, m.c | 0), Math.max(2, m.r | 0)); } catch {} }
      else if (m.t === 'kill') { try { child.kill(); } catch {} }
    }
  });
}

module.exports = { Elevator, runHelper, commandFor, b64, unb64 };
