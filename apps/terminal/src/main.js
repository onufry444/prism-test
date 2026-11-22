'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, globalShortcut, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const pty = require('@lydell/node-pty');
const win32 = require('./win32');
const argv = process.argv;

// Prism.exe --elevate <request>: the window-less elevated helper that runs one admin command (see elevate.js).
// It must not touch the normal app at all (no single-instance lock, no windows, no shared profile files).
if (argv.includes('--elevate')) {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'prism-elevated-')));
  app.disableHardwareAcceleration();
  const done = code => { try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {} app.exit(code); };
  require('./elevate').runHelper(argv[argv.indexOf('--elevate') + 1], { pty, win32, exit: done });
  return;
}

const shells = require('./shells');
const { Config, CONFIG_FILE, STYLE_FILE, CONFIG_DIR, ensureFiles } = require('./config');
const { translate, needsAdmin, sudoRest } = require('./translate');
const { Elevator } = require('./elevate');
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// --smoke FILE: self-test without a person (used by CI); writes results to FILE and quits.
const SMOKE_OUT = (() => { const i = argv.indexOf('--smoke'); return i < 0 ? null : path.resolve(argv[i + 1] || 'smoke.json'); })();
app.setPath('userData', SMOKE_OUT ? fs.mkdtempSync(path.join(os.tmpdir(), 'prism-smoke-')) : path.join(app.getPath('appData'), 'Prism'));

const DATA = app.getPath('userData');
const SCRIPTS = path.join(DATA, 'shell');
const INBOX = path.join(DATA, 'inbox');
const RESULTS = path.join(DATA, 'results');
const STATIC_SHELL = path.join(__dirname, 'shell');
const PIPE = `prism-${process.pid}`;
const BIN = path.join(process.env.LOCALAPPDATA || '', 'Prism', 'bin');
// Prism running as administrator: every tab already is, so sudo just runs the command. (Tests can pretend otherwise.)
const ELEVATED = IS_WIN && win32.isElevated() && !process.env.PRISM_TEST_ELEVATE;

const config = new Config(path.join(DATA, 'settings.json'));
const ptys = new Map(); // tab id -> { p, wc, profile, cols, rows }
const PROFILES = shells.detectProfiles();
let elevator = null;
let quitting = false;

const terminals = () => BrowserWindow.getAllWindows().filter(w => w.prismTerminal && !w.isDestroyed());
const broadcast = (ch, data) => terminals().forEach(w => w.webContents.send(ch, data));

// ---------- shells ----------
function writeShells() { try { shells.writeAll(SCRIPTS, config.get(), STATIC_SHELL); } catch (e) { console.error('Prism: writing shell files failed', e); } }
function launch(profile, tab) {
  const f = n => path.join(SCRIPTS, n);
  const slash = p => IS_WIN ? p.replace(/\\/g, '/') : p;
  const forShell = p => profile.kind === 'bash' ? slash(p) : p;
  const env = {
    ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Prism', TERM_PROGRAM_VERSION: app.getVersion(),
    PRISM_INBOX: forShell(INBOX), PRISM_RESULTS: forShell(RESULTS), PRISM_TAB: tab || '', PRISM_PID: String(process.pid), PRISM_ELEVATED: ELEVATED ? '1' : '0'
  };
  delete env.PRISM_TEST_ELEVATE;
  if (IS_WIN) env.PRISM_PIPE = PIPE;
  if (IS_WIN && fs.existsSync(BIN) && !(env.Path || env.PATH || '').toLowerCase().includes(BIN.toLowerCase())) env.Path = `${BIN};${env.Path || env.PATH || ''}`;
  switch (profile.kind) {
    case 'bash': return { args: ['--rcfile', slash(f('init.bash')), '-i'], env };
    case 'zsh': return { args: IS_MAC ? ['-l', '-i'] : ['-i'], env: { ...env, TC_REAL_ZDOTDIR: process.env.ZDOTDIR || os.homedir(), ZDOTDIR: f('zsh') } };
    case 'pwsh': return { args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${f('init.ps1').replace(/'/g, "''")}'`], env };
    // a string is passed as the raw command line (an array would break the quotes around the path)
    case 'cmd': return { args: `/K "${f('init.cmd')}"`, env };
    default: return { args: [], env };
  }
}
function profileFor(id) { return PROFILES.find(p => p.id === id) || PROFILES.find(p => p.id === config.get().shell.default) || PROFILES[0]; }
function spawnShell(profile, cols, rows, cwd, tab) {
  const { args, env } = launch(profile, tab);
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  return pty.spawn(profile.cmd, args, { name: 'xterm-256color', cols: Math.max(cols, 2), rows: Math.max(rows, 2), cwd: dir, env });
}
function attach(id, p, wc, profile, cols, rows) {
  ptys.set(id, { p, wc, profile, cols, rows });
  p.onData(data => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data }); });
  p.onExit(({ exitCode }) => { ptys.delete(id); elevator?.kill(id); if (!wc.isDestroyed()) wc.send('pty:exit', { id, exitCode }); });
}

// ---------- each line typed in PowerShell passes through here before it runs ----------
// sudo, "this needs admin" and bash/cmd syntax translation.
function handleLine(req) {
  const cfg = config.get();
  const ctx = { ps7: !!req.ps7, last: req.last || '', env: req.env, vars: req.vars };
  const tr = line => cfg.shell.translate ? translate(line, ctx) : { line, changed: false, dialects: [] };
  const rest = sudoRest(req.line);
  if (rest !== null && rest.trim()) {
    const cmd = tr(rest).line;
    return { line: ELEVATED ? cmd : `__prism_sudo ${psq(cmd)}`, changed: true, quiet: true };
  }
  const r = tr(req.line);
  if (!ELEVATED && cfg.admin.ask && needsAdmin(req.line)) {
    // asks first; runs it elevated, or here as typed when you say no
    return { line: `if (__prism_ask_admin ${psq(r.line)}) { ${r.line} }`, changed: true, quiet: true };
  }
  return r;
}
function startPipe() {
  if (!IS_WIN) return;
  const server = net.createServer(sock => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let req; try { req = JSON.parse(line.replace(/^﻿/, '')); } catch { sock.write('{}\n'); continue; }
        const toArr = v => Array.isArray(v) ? v : v ? [v] : [];
        const r = handleLine({ line: String(req.line ?? ''), ps7: !!req.ps7, last: req.last || '', env: toArr(req.env), vars: toArr(req.vars) });
        sock.write(JSON.stringify({ line: r.line, changed: r.changed }) + '\n');
        if (r.changed && !r.quiet && config.get().shell.translateNotify) broadcast('term:translated', { from: req.line, to: r.line, dialects: r.dialects });
      }
    });
  });
  server.on('error', e => console.error('Prism: translation pipe error', e.message));
  server.listen(`\\\\.\\pipe\\${PIPE}`);
}

// ---------- messages from shell commands (settings, prism alias, sudo...) ----------
const smokeMsgs = [];
function onShellMessage(msg) {
  if (SMOKE_OUT) smokeMsgs.push(msg);
  const i = msg.indexOf(';'), cmd = i < 0 ? msg : msg.slice(0, i), arg = i < 0 ? '' : msg.slice(i + 1).trim();
  const cfg = config.get();
  if (cmd === 'elevate') { let req; try { req = JSON.parse(Buffer.from(arg, 'base64').toString('utf8')); } catch { return; } elevator.start(req); }
  else if (cmd === 'add') {
    try {
      const [type, name, ...body] = Buffer.from(arg, 'base64').toString('utf8').split('\t');
      if (!shells.validName(name)) return notify(`"${name}" can't be used as an alias name`);
      const aliases = cfg.aliases.filter(a => a.name !== name).concat([{ name, type: type === 'text' ? 'text' : 'run', body: body.join('\t'), desc: '' }]);
      setConfig({ aliases });
    } catch {}
  } else if (cmd === 'remove') setConfig({ aliases: cfg.aliases.filter(a => a.name !== arg) });
  else if (cmd === 'opacity') { const v = Math.round(+arg); if (arg !== '' && v >= 0 && v <= 100) setConfig({ terminal: { opacity: v } }); else notify('Usage: prism opacity 0-100'); }
  else if (cmd === 'font') { const v = Math.round(+arg); if (v >= 8 && v <= 32) setConfig({ terminal: { fontSize: v } }); else notify('Usage: prism font-size 8-32'); }
  else if (cmd === 'reload') { config.load(); onConfigChanged(); notify('Configuration reloaded'); }
  else if (cmd === 'quit') { if (!SMOKE_OUT) { quitting = true; app.quit(); } }
  else broadcast('shell:msg', msg); // panel, scheme: handled by the window
}
function notify(text) { broadcast('toast', text); }
function drainInbox() {
  let files; try { files = fs.readdirSync(INBOX).filter(f => f.endsWith('.msg')).sort(); } catch { return; }
  for (const f of files) {
    const p = path.join(INBOX, f);
    let s; try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (!s.endsWith('\n')) continue; // still being written
    try { fs.unlinkSync(p); } catch {}
    s = s.replace(/^﻿/, '').trim();
    if (s) onShellMessage(s);
  }
}
function watchInbox() {
  fs.mkdirSync(INBOX, { recursive: true });
  fs.mkdirSync(RESULTS, { recursive: true });
  try { fs.watch(INBOX, () => drainInbox()); } catch {}
  setInterval(drainInbox, 400);
  // results nobody picked up (a tab closed while waiting)
  try { for (const f of fs.readdirSync(RESULTS)) fs.unlinkSync(path.join(RESULTS, f)); } catch {}
}

// ---------- config ----------
let lastShellSig = '', lastLogin = null;
function setConfig(patch) {
  // picking a color scheme clears custom colors
  if (patch.terminal && 'scheme' in patch.terminal) config.gui.terminal = { ...(config.gui.terminal || {}), colors: {} };
  config.setGui(patch);
  onConfigChanged();
  return config.get();
}
function onConfigChanged() {
  const cfg = config.get();
  const shellSig = JSON.stringify([cfg.aliases, cfg.prompt, cfg.shell, cfg.admin]);
  if (shellSig !== lastShellSig) { lastShellSig = shellSig; writeShells(); }
  const login = !!cfg.startup.launchAtLogin;
  if (login !== lastLogin && !SMOKE_OUT && app.isPackaged) { lastLogin = login; app.setLoginItemSettings({ openAtLogin: login, args: ['--background'] }); }
  registerShortcut();
  broadcast('config:changed', payload());
}
function payload() {
  return { config: config.get(), css: config.css, overridden: config.overridden, error: config.error, files: { config: CONFIG_FILE, style: STYLE_FILE, dir: CONFIG_DIR } };
}
let shortcut = null;
function registerShortcut() {
  const k = config.get().keys.toggleWindow;
  if (k === shortcut || SMOKE_OUT) return;
  if (shortcut) try { globalShortcut.unregister(shortcut.replace(/Ctrl/g, 'CommandOrControl')); } catch {}
  shortcut = k;
  if (k) try { globalShortcut.register(k.replace(/Ctrl/g, 'CommandOrControl'), toggleTerminal); } catch {}
}
function toggleTerminal() {
  const w = terminals()[0];
  if (!w) return openTerminal();
  if (w.isFocused()) w.hide(); else { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
}

// Prism 0.3 could hide the taskbar and reserve screen space for its dock; put that back if it is still set.
function undoOldDesktop() {
  const file = path.join(DATA, 'desktop-state.json');
  let st; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  try {
    if (typeof st.taskbarWasAutohide === 'boolean') win32.taskbarAutohide(st.taskbarWasAutohide);
    if (st.workArea) win32.setWorkArea(st.workArea);
  } catch {}
  try { fs.unlinkSync(file); } catch {}
}

// ---------- terminal windows ----------
function openTerminal({ show = true, settings = false } = {}) {
  const cfg = config.get();
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.max(560, Math.min(1180, wa.width - 80)), height = Math.max(360, Math.min(740, wa.height - 60));
  const w = new BrowserWindow({
    width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2),
    minWidth: 560, minHeight: 360, show: false, title: 'Prism',
    frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  w.prismTerminal = true;
  w.openSettingsOnLoad = settings;
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  w.once('ready-to-show', () => {
    if (cfg.terminal.blur) win32.blurBehind(win32.hwndOf(w), 'blur');
    if (show) { w.show(); w.focus(); } else w.showInactive();
  });
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.on('maximize', () => w.webContents.send('win:state', true));
  w.on('unmaximize', () => w.webContents.send('win:state', false));
  const wc = w.webContents;
  w.on('closed', () => { for (const [id, t] of ptys) if (t.wc === wc) { elevator?.kill(id); try { t.p.kill(); } catch {} ptys.delete(id); } });
  return w;
}
function onPrismAction(what, arg) {
  if (what === 'open') { const w = terminals()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else openTerminal(); }
  else if (what === 'settings') { const w = terminals()[0]; if (w) { w.show(); w.focus(); w.webContents.send('app:command', `settings ${arg || ''}`.trim()); } else openTerminal({ settings: arg || true }); }
}
function prismMenu(win) {
  Menu.buildFromTemplate([
    { label: 'New window', click: () => openTerminal() },
    { label: 'Settings…', click: () => onPrismAction('settings') },
    { type: 'separator' },
    { label: 'Open config.jsonc', click: () => { ensureFiles(); shell.openPath(CONFIG_FILE); } },
    { label: 'Report a problem', click: () => shell.openExternal('https://github.com/onufry444/prism/issues') },
    { type: 'separator' },
    { label: 'Quit Prism', click: () => { quitting = true; app.quit(); } }
  ]).popup({ window: win });
}

// ---------- IPC ----------
ipcMain.handle('app:init', e => ({
  ...payload(), profiles: PROFILES, platform: process.platform, version: app.getVersion(), translateAvailable: IS_WIN, elevated: ELEVATED,
  startup: { openSettings: BrowserWindow.fromWebContents(e.sender)?.openSettingsOnLoad || false }
}));
ipcMain.handle('config:set', (e, patch) => setConfig(patch));
ipcMain.handle('pty:create', (e, id, profileId, cols, rows, cwd) => {
  const profile = profileFor(profileId);
  const wc = e.sender;
  let p;
  try { p = spawnShell(profile, cols, rows, cwd, id); } catch (err) {
    setTimeout(() => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data: `\r\n\x1b[31mCould not start ${profile.cmd}: ${err.message}\x1b[0m\r\n` }); }, 50);
    return { ok: false, profile };
  }
  attach(id, p, wc, profile, cols, rows);
  return { ok: true, profile, pid: p.pid };
});
// while an admin command runs in a tab, its keys go to that command
ipcMain.on('pty:write', (e, id, d) => { if (!elevator?.input(id, d)) ptys.get(id)?.p.write(d); });
ipcMain.on('pty:resize', (e, id, c, r) => {
  const t = ptys.get(id); if (!t) return;
  t.cols = c; t.rows = r;
  try { t.p.resize(Math.max(c, 2), Math.max(r, 2)); } catch {}
  elevator?.resize(id, c, r);
});
ipcMain.on('pty:kill', (e, id) => { elevator?.kill(id); try { ptys.get(id)?.p.kill(); } catch {} ptys.delete(id); });
ipcMain.handle('app:pick-image', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('app:open-file', (e, which) => {
  ensureFiles();
  const f = { config: CONFIG_FILE, style: STYLE_FILE, dir: CONFIG_DIR, data: DATA }[which];
  if (f) shell.openPath(f);
});
ipcMain.on('win', (e, a) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  if (a === 'min') w.minimize();
  else if (a === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
  else if (a === 'close') w.close();
  else if (a === 'new') openTerminal();
  else if (a === 'relaunch') { app.relaunch(); quitting = true; app.exit(0); }
});
ipcMain.on('app:menu', e => prismMenu(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (e, t) => clipboard.writeText(String(t)));
ipcMain.on('open', (e, url) => { if (/^(https?:\/\/|ms-settings:)/.test(url)) shell.openExternal(url); });

function startElevator() {
  elevator = new Elevator({
    exe: process.execPath,
    exeArgs: app.isPackaged ? [] : [app.getAppPath()],
    resultsDir: RESULTS,
    initScript: path.join(SCRIPTS, 'init.ps1'),
    mode: () => config.get().admin.mode,
    tab: id => {
      const t = ptys.get(id);
      return t && { cols: t.cols, rows: t.rows, profile: t.profile, send: data => { if (!t.wc.isDestroyed()) t.wc.send('pty:data', { id, data }); } };
    },
    onState: (id, on) => { const t = ptys.get(id); if (t && !t.wc.isDestroyed()) t.wc.send('pty:admin', { id, on }); }
  });
}

// ---------- self-test (CI) ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
// runs lines in a real shell, wired up like a tab (so sudo can find it); a line can be [text, ms to wait after]
function runPty(profile, lines, firstWait) {
  return new Promise(resolve => {
    let out = '', done = false;
    const id = 'smoke-' + Math.random().toString(36).slice(2);
    const wc = { isDestroyed: () => false, send: (ch, m) => { if (ch === 'pty:data' && m.id === id) out += m.data; } };
    const p = spawnShell(profile, 140, 40, null, id);
    attach(id, p, wc, profile, 140, 40);
    const finish = () => { if (done) return; done = true; try { p.kill(); } catch {} ptys.delete(id); resolve(out); };
    p.onExit(finish);
    (async () => {
      await wait(firstWait);
      for (const l of lines) { const [text, ms] = Array.isArray(l) ? l : [l, 2500]; if (!elevator.input(id, text + '\r')) p.write(text + '\r'); await wait(ms); }
      setTimeout(finish, 3000);
    })();
    setTimeout(finish, 240000);
  });
}
async function runSmoke() {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); };
  const plainOf = s => s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
  try {
    writeShells();
    // 1. terminal window and settings
    const errors = [];
    const w = openTerminal({ show: true });
    w.webContents.on('console-message', (e, level, message) => {
      const lv = e && e.level !== undefined ? e.level : level, msg = e && e.message !== undefined ? e.message : message;
      if (lv === 'error' || lv === 3) errors.push(msg);
    });
    w.webContents.on('preload-error', (e, p, err) => errors.push('preload: ' + err.message));
    await new Promise(r => w.webContents.once('did-finish-load', r));
    await wait(9000);
    const ui = await w.webContents.executeJavaScript(`(async () => {
      const P = window.Prism, r = { terminal: typeof Terminal, tabs: document.querySelectorAll('.tab').length };
      const b = P.active && P.active.term.buffer.active;
      r.text = b ? Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\\n').trim().slice(-600) : '';
      r.tour = !!document.querySelector('#tour');
      P.openSettings('terminal');
      await new Promise(s => setTimeout(s, 500));
      r.sections = {};
      for (const s of P.sectionIds) { P.goSection(s); await new Promise(x => setTimeout(x, 80)); r.sections[s] = document.querySelector('#sContent').children.length; }
      P.closeSettings();
      return r;
    })()`);
    check('window: xterm loaded', ui.terminal === 'function', ui);
    check('window: first tab runs a shell with a prompt', ui.tabs >= 1 && /❯|>/.test(ui.text), ui.text);
    check('window: no tutorial', !ui.tour, ui);
    check('settings: every section renders', Object.values(ui.sections).length >= 7 && Object.values(ui.sections).every(n => n > 0), ui.sections);
    check('window: no console errors', errors.length === 0, errors);

    // 2. shells: aliases, Prism commands, Linux commands, translation through the pipe
    const testable = PROFILES.filter(p => ['pwsh', 'cmd', 'bash'].includes(p.kind) && p.id !== 'prism');
    for (const prof of testable) {
      await wait(1000); drainInbox(); smokeMsgs.length = 0;
      const lines = prof.kind === 'cmd' ? ['aliases', 'settings keys', 'exit']
        : prof.kind === 'bash' ? ['prism alias', 'settings keys', 'prism alias smk "echo smoke"', 'Get-Date -Format yyyy', 'exit']
        : ['prism alias', 'settings keys', 'prism alias smk "echo smoke"', 'echo A1 && echo B$(2)', 'cmd /c exit 1 && echo NOT$("PRINTED")', 'ls -la ~', 'echo %USERNAME%', 'exit'];
      const out = await runPty(prof, lines, prof.kind === 'pwsh' ? 7000 : 3000);
      await wait(1200); drainInbox();
      const plain = plainOf(out);
      check(`${prof.name}: alias list`, /gs\s+git status/.test(plain), plain.slice(-2000));
      check(`${prof.name}: settings command reaches Prism`, smokeMsgs.includes('panel;keys'), smokeMsgs);
      if (prof.kind !== 'cmd') check(`${prof.name}: prism alias saves`, smokeMsgs.some(m => m.startsWith('add;')), smokeMsgs);
      if (prof.kind === 'bash') check(`${prof.name}: PowerShell commands run from bash`, /\b20\d\d\b/.test(plain.split('Get-Date -Format yyyy').pop() || ''), plain.slice(-800));
      if (prof.kind === 'pwsh') {
        check(`${prof.name}: && works`, /\bB2\b/.test(plain), plain.slice(-2500));
        check(`${prof.name}: && stops after a failure`, !/NOTPRINTED/.test(plain), plain.slice(-2500));
        check(`${prof.name}: ls -la (GNU style)`, /\n[d-][r-][h-][s-]\s+\S+\s+\w{3} \d{2}/.test(plain), plain.slice(-2500));
        check(`${prof.name}: %VAR% (cmd style)`, plain.toLowerCase().split('echo %username%').pop().includes(os.userInfo().username.toLowerCase()), plain.slice(-1200));
        check(`${prof.name}: prompt`, plain.includes('❯'), plain.slice(-600));
      }
    }

    // 3. administrator rights on demand (CI runs elevated; PRISM_TEST_ELEVATE makes Prism go through the real helper anyway)
    if (IS_WIN && process.env.PRISM_TEST_ELEVATE) {
      const ps = PROFILES.find(p => p.kind === 'pwsh' && p.id !== 'prism');
      setConfig({ admin: { mode: 'inline', ask: true } });
      const out = plainOf(await runPty(ps, [
        ['sudo echo ELEV$(40+2) && echo CHAIN$(1+1)', 20000],
        ['echo CODE$LASTEXITCODE', 2500],
        ['sudo cmd /c exit 7', 15000],
        ['echo EXIT$LASTEXITCODE', 2500],
        ['Set-ExecutionPolicy Bypass -Scope LocalMachine -WhatIf', 2500],
        ['n', 4000],
        ['echo ALIVE', 2500],
        'exit'
      ], 7000));
      const after = s => out.split(s).slice(1).join(s);
      check('admin: sudo output shows in the same tab', /\bELEV42\b/.test(out) && /\bCHAIN2\b/.test(out), out.slice(-3000));
      check('admin: exit code comes back', /\bCODE0\b/.test(out) && /\bEXIT7\b/.test(out), out.slice(-3000));
      check('admin: asks before admin-only commands', /needs administrator rights/i.test(after('Set-ExecutionPolicy')), out.slice(-2000));
      check('admin: "n" runs it normally', /What if/i.test(after('Set-ExecutionPolicy')) && /\bALIVE\b/.test(after('echo ALIVE')), out.slice(-2000));
      const cmdP = PROFILES.find(p => p.kind === 'cmd');
      if (cmdP) {
        const co = plainOf(await runPty(cmdP, [['sudo echo CMDELEV', 15000], 'exit'], 3000));
        check('admin: sudo in cmd', /CMDELEV/.test(co.split('sudo echo CMDELEV').pop() || ''), co.slice(-1500));
      }
      check('admin: no helper left running', elevator.sessions.size === 0, [...elevator.sessions.keys()]);
    }
  } catch (err) {
    check('exception', false, String(err && err.stack || err));
  }
  const ok = checks.every(c => c.ok);
  fs.writeFileSync(SMOKE_OUT, JSON.stringify({ ok, checks }, null, 2));
  app.exit(ok ? 0 : 1);
}

// ---------- start ----------
if (!SMOKE_OUT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, args) => {
    if (args.includes('--settings')) onPrismAction('settings');
    else if (!args.includes('--background')) { if (terminals().some(w => w.isVisible())) openTerminal(); else onPrismAction('open'); }
  });
  app.whenReady().then(() => {
    lastShellSig = JSON.stringify([config.get().aliases, config.get().prompt, config.get().shell, config.get().admin]);
    writeShells();
    watchInbox();
    startPipe();
    startElevator();
    config.onChange(() => onConfigChanged());
    if (SMOKE_OUT) return runSmoke();
    undoOldDesktop();
    config.watch();
    onConfigChanged();
    if (!argv.includes('--background')) openTerminal({ settings: argv.includes('--settings') });
    app.on('activate', () => { if (!terminals().length) openTerminal(); });
  });
  app.on('window-all-closed', () => {
    if (SMOKE_OUT) return;
    if (!IS_MAC || quitting) app.quit();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
}
