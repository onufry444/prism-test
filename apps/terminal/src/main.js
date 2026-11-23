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
const { startHandoffServer } = require('./handoff');
const { Toys } = require('./toys');
const { Updater, repoName } = require('./updater');
const prismApi = require('./api');
const { Plugins } = require('./plugins');
const { Themes } = require('./themes');
const toysMod = require('./toys');
const { Integration, runSpecForFile } = require('./integrate');
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
let elevator = null, toys = null;
let quitting = false;

const terminals = () => BrowserWindow.getAllWindows().filter(w => w.prismTerminal && !w.isDestroyed());
const broadcast = (ch, data) => terminals().forEach(w => w.webContents.send(ch, data));

// ---------- shells ----------
function writeShells() { try { shells.writeAll(SCRIPTS, { ...config.get(), _commands: [...(plugins ? plugins.names() : []), 'plugin', 'ssh', 'theme'] }, STATIC_SHELL); } catch (e) { console.error('Prism: writing shell files failed', e); } }
function launch(profile, tab) {
  const f = n => path.join(SCRIPTS, n);
  const slash = p => IS_WIN ? p.replace(/\\/g, '/') : p;
  const forShell = p => profile.kind === 'bash' ? slash(p) : p;
  const env = {
    ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Prism', TERM_PROGRAM_VERSION: app.getVersion(),
    PRISM_INBOX: forShell(INBOX), PRISM_RESULTS: forShell(RESULTS), PRISM_TAB: tab || '', PRISM_PID: String(process.pid), PRISM_ELEVATED: ELEVATED ? '1' : '0',
    PRISM_API: prismApi.pipeName()
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
// A tab that runs one program instead of a shell ("prism run", "Run in Prism").
function spawnRun(run, cols, rows) {
  const { env } = launch({ kind: 'other' }, '');
  const cwd = run.cwd && fs.existsSync(run.cwd) ? run.cwd : os.homedir();
  const opts = { name: 'xterm-256color', cols: Math.max(cols, 2), rows: Math.max(rows, 2), cwd, env };
  try { return pty.spawn(run.file, run.args || [], opts); }
  catch (e) { if (run.fallback) return pty.spawn(run.fallback, run.args || [], opts); throw e; }
}
function spawnShell(profile, cols, rows, cwd, tab) {
  const { args, env } = launch(profile, tab);
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  return pty.spawn(profile.cmd, args, { name: 'xterm-256color', cols: Math.max(cols, 2), rows: Math.max(rows, 2), cwd: dir, env });
}
// hold: keep the tab open after the program ends ('always', or 'error' = only when it failed), until a key is pressed
function attach(id, p, wc, profile, cols, rows, hold) {
  const t = { p, wc, profile, cols, rows, ended: false };
  ptys.set(id, t);
  p.onData(data => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data }); });
  p.onExit(({ exitCode }) => {
    elevator?.kill(id); toys?.stop(id);
    if (wc.isDestroyed()) return ptys.delete(id);
    if (hold === 'always' || (hold === 'error' && exitCode)) {
      t.ended = true;
      wc.send('pty:data', { id, data: `\r\n\x1b[90m[${exitCode ? `exited with code ${exitCode}` : 'finished'} · press any key to close]\x1b[0m` });
    } else { ptys.delete(id); wc.send('pty:exit', { id, exitCode }); }
  });
}
function endHeld(id) { const t = ptys.get(id); if (!t || !t.ended) return false; ptys.delete(id); if (!t.wc.isDestroyed()) t.wc.send('pty:exit', { id, exitCode: 0 }); return true; }

// ---------- consoles handed over by Windows (Prism as the default terminal) ----------
const waitingConsoles = new Map(); // tab id -> console, until a window picks it up
let lastTerminal = null;
function onHandedOffConsole(con) {
  const id = require('crypto').randomUUID();
  const title = con.hello.title || path.basename(con.hello.exe || '', '.exe') || 'console';
  waitingConsoles.set(id, con);
  con.onExit(() => { if (waitingConsoles.get(id) === con) setTimeout(() => waitingConsoles.delete(id), 30000); });
  if (SMOKE_OUT) smokeHandoffs.push({ id, title, exe: con.hello.exe });
  const w = (lastTerminal && !lastTerminal.isDestroyed() && lastTerminal) || terminals()[0];
  if (w) { w.webContents.send('tab:open', { adopt: { id, title } }); if (!SMOKE_OUT) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } }
  else openTerminal({ open: { adopt: { id, title } } });
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
const smokeMsgs = [], smokeHandoffs = [];
function onShellMessage(msg) {
  if (SMOKE_OUT) smokeMsgs.push(msg);
  const i = msg.indexOf(';'), cmd = i < 0 ? msg : msg.slice(0, i), arg = i < 0 ? '' : msg.slice(i + 1).trim();
  const cfg = config.get();
  if (cmd === 'cwd') { const j = arg.indexOf(';'); const t = ptys.get(arg.slice(0, j)); if (t) t.cwd = arg.slice(j + 1); return; }
  if (cmd === 'elevate' || cmd === 'toy') {
    let req; try { req = JSON.parse(Buffer.from(arg, 'base64').toString('utf8')); } catch { return; }
    if (cmd === 'elevate') elevator.start(req); else toys.start(req);
  }
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
let lastShellSig = '', lastLogin = null, lastPluginSig = null;
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
  const pluginSig = JSON.stringify(cfg.plugins || {});
  if (plugins && pluginSig !== lastPluginSig) { const first = lastPluginSig === null; lastPluginSig = pluginSig; if (!first) { plugins.load(); lastShellSig = ''; } }
  if (shellSig !== lastShellSig) { lastShellSig = shellSig; writeShells(); }
  const login = !!cfg.startup.launchAtLogin;
  if (login !== lastLogin && !SMOKE_OUT && app.isPackaged) { lastLogin = login; app.setLoginItemSettings({ openAtLogin: login, args: ['--background'] }); }
  registerShortcut();
  applyIntegration();
  broadcast('config:changed', payload());
}
function payload() {
  return {
    config: config.get(), css: config.css, overridden: config.overridden, error: config.error, files: { config: CONFIG_FILE, style: STYLE_FILE, dir: CONFIG_DIR },
    // color schemes from your themes folder, the theme store and plugins (they join the built-in ones)
    themes: { ...(plugins ? plugins.schemes : {}), ...(themes ? themes.user : {}) },
    plugins: plugins ? plugins.list.map(p => ({ name: p.name, dir: path.basename(p.dir), version: p.version, description: p.description, author: p.author, enabled: p.enabled, commands: p.commands, animations: p.animations, schemes: p.schemes, error: p.error })) : []
  };
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

// ---------- session: windows, tabs, panes and their recent output come back after a restart ----------
const SESSION_FILE = path.join(DATA, 'session.json');
const sessions = new Map(); // webContents id -> { snapshot, bounds, maximized }
const restoredCwd = new Map(); // pane id from the last session -> its folder
let sessionDirty = false;
function withCwds(node) {
  if (!node) return node;
  if (node.pane) return { ...node, cwd: ptys.get(node.pane)?.cwd || restoredCwd.get(node.pane) || null };
  return { ...node, a: withCwds(node.a), b: withCwds(node.b) };
}
ipcMain.on('session:save', (e, snap) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && snap && Array.isArray(snap.tabs)) {
    sessions.set(e.sender.id, { snapshot: { ...snap, tabs: snap.tabs.map(t => ({ ...t, root: withCwds(t.root) })) }, bounds: w.getNormalBounds(), maximized: w.isMaximized() });
    sessionDirty = true;
  }
  e.returnValue = true;
});
function writeSession(force) {
  if (SMOKE_OUT || (!sessionDirty && !force)) return;
  sessionDirty = false;
  const windows = [...sessions.values()].filter(s => s.snapshot.tabs.length);
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify({ version: 1, windows })); } catch (e) { console.error('Prism: saving the session failed', e.message); }
}
function loadSession() {
  if (!config.get().startup.restoreTabs) return [];
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const walk = n => { if (!n) return; if (n.pane) { if (n.cwd) restoredCwd.set(n.pane, n.cwd); } else { walk(n.a); walk(n.b); } };
    for (const w of s.windows || []) for (const t of w.snapshot.tabs || []) walk(t.root);
    return (s.windows || []).filter(w => w.snapshot && w.snapshot.tabs && w.snapshot.tabs.length);
  } catch { return []; }
}
setInterval(() => writeSession(), 30000);

// ---------- terminal windows ----------
function openTerminal({ show = true, settings = false, open = null, restore = null } = {}) {
  const cfg = config.get();
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.max(560, Math.min(1180, wa.width - 80)), height = Math.max(360, Math.min(740, wa.height - 60));
  // a restored window goes back where it was, if that place is still on a screen
  const rb = restore && restore.bounds;
  const onScreen = rb && screen.getAllDisplays().some(d => rb.x < d.workArea.x + d.workArea.width - 40 && rb.x + rb.width > d.workArea.x + 40 && rb.y >= d.workArea.y - 10 && rb.y < d.workArea.y + d.workArea.height - 40);
  const pos = onScreen ? { x: rb.x, y: rb.y, width: Math.max(560, rb.width), height: Math.max(360, rb.height) } : { width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2) };
  const w = new BrowserWindow({
    ...pos,
    minWidth: 560, minHeight: 360, show: false, title: 'Prism',
    frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  w.prismTerminal = true;
  w.openSettingsOnLoad = settings;
  w.openOnLoad = open; // the first tab: a program, a folder or a handed-off console instead of a shell
  w.restoreOnLoad = restore && restore.snapshot;
  if (restore && restore.maximized) w.once('ready-to-show', () => w.maximize());
  w.on('focus', () => { lastTerminal = w; });
  lastTerminal = w;
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
  // closing one of several windows forgets it; closing the last one (or quitting) keeps it for next time
  // (decided on close; the window still saves itself while it unloads, so the entry is dropped after that)
  const wcId = wc.id;
  w.on('close', () => { w.forgetSession = !quitting && terminals().length > 1; });
  w.on('closed', () => { if (w.forgetSession) { sessions.delete(wcId); sessionDirty = true; } });
  w.on('closed', () => { for (const [id, t] of ptys) if (t.wc === wc) { elevator?.kill(id); try { t.p.kill(); } catch {} ptys.delete(id); } });
  return w;
}
// What a launch asks for: --run <base64 JSON from `prism run`>, --run-file <path> (Explorer), --cwd <folder>
function openRequest(args, workingDir) {
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const b = val('--run');
    if (b) { const r = JSON.parse(Buffer.from(b, 'base64').toString('utf8')); if (r && r.file) return { run: r }; }
  } catch {}
  // prism.cmd writes `run COMMAND...` to a file (see install.ps1); cmd.exe runs it, so .cmd tools and PATH work
  const cf = val('--run-cmdfile');
  if (cf && /prism-run-\d+\.txt$/i.test(cf) && fs.existsSync(cf)) {
    let line = ''; try { line = fs.readFileSync(cf, 'latin1').trim(); fs.unlinkSync(cf); } catch {}
    line = line.replace(/^run\s*/i, '');
    if (line) {
      const cwd = val('--run-cwd') || workingDir;
      return { run: { file: 'cmd.exe', args: `/d /s /c "${line}"`, cwd: cwd && fs.existsSync(cwd) ? path.resolve(cwd) : os.homedir(), title: line.split(/\s+/)[0].replace(/"/g, '') } };
    }
  }
  const f = val('--run-file');
  if (f && fs.existsSync(f)) return { run: runSpecForFile(f, PROFILES) };
  const d = val('--cwd');
  if (d && fs.existsSync(d)) return { cwd: d.replace(/"$/, '') };
  return null;
}
function openTab(req) {
  const w = (lastTerminal && !lastTerminal.isDestroyed() && lastTerminal) || terminals()[0];
  if (!w) return openTerminal({ open: req });
  if (w.isMinimized()) w.restore();
  w.show(); w.focus();
  w.webContents.send('tab:open', req);
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
  ...payload(), profiles: PROFILES, platform: process.platform, osRelease: os.release(), version: app.getVersion(), translateAvailable: IS_WIN, elevated: ELEVATED,
  startup: { openSettings: BrowserWindow.fromWebContents(e.sender)?.openSettingsOnLoad || false, open: BrowserWindow.fromWebContents(e.sender)?.openOnLoad || null, restore: BrowserWindow.fromWebContents(e.sender)?.restoreOnLoad || null }
}));
ipcMain.handle('config:set', (e, patch) => setConfig(patch));
ipcMain.handle('pty:create', (e, id, profileId, cols, rows, cwd, run, cwdFrom) => {
  // a split starts in the folder of the pane it came from; a restored pane in its saved folder
  if (!cwd && cwdFrom) cwd = ptys.get(cwdFrom)?.cwd || restoredCwd.get(cwdFrom) || null;
  const wc = e.sender;
  if (run) {
    const profile = { id: 'run', name: run.title || path.basename(String(run.file)), kind: 'run', cmd: run.file };
    try { attach(id, spawnRun(run, cols, rows), wc, profile, cols, rows, 'always'); return { ok: true, profile }; }
    catch (err) { setTimeout(() => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data: `\x1b[31mCould not start ${run.file}: ${err.message}\x1b[0m\r\n` }); }, 50); return { ok: false, profile }; }
  }
  const profile = profileFor(profileId);
  let p;
  try { p = spawnShell(profile, cols, rows, cwd, id); } catch (err) {
    setTimeout(() => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data: `\r\n\x1b[31mCould not start ${profile.cmd}: ${err.message}\x1b[0m\r\n` }); }, 50);
    return { ok: false, profile };
  }
  attach(id, p, wc, profile, cols, rows);
  return { ok: true, profile, pid: p.pid };
});
// while an admin command runs in a tab, its keys go to that command
ipcMain.handle('pty:adopt', (e, id, cols, rows) => {
  const con = waitingConsoles.get(id);
  if (!con) return { ok: false };
  waitingConsoles.delete(id);
  const profile = { id: 'console', name: con.hello.title || path.basename(con.hello.exe || '', '.exe') || 'console', kind: 'console', cmd: con.hello.exe };
  attach(id, con, e.sender, profile, cols, rows, 'error');
  con.resize(cols, rows);
  return { ok: true, profile };
});
// while sudo or a toy runs in a tab, its keys go there instead of the shell
ipcMain.on('pty:write', (e, id, d) => { if (endHeld(id)) return; if (toys?.input(id, d)) return; if (!elevator?.input(id, d)) ptys.get(id)?.p.write(d); });
ipcMain.on('pty:resize', (e, id, c, r) => {
  const t = ptys.get(id); if (!t) return;
  t.cols = c; t.rows = r;
  try { t.p.resize(Math.max(c, 2), Math.max(r, 2)); } catch {}
  elevator?.resize(id, c, r);
  toys?.resize(id, c, r);
});
ipcMain.on('pty:kill', (e, id) => { toys?.stop(id); elevator?.kill(id); try { ptys.get(id)?.p.kill(); } catch {} ptys.delete(id); });
ipcMain.handle('app:pick-image', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('app:open-file', (e, which) => {
  ensureFiles();
  const f = { config: CONFIG_FILE, style: STYLE_FILE, dir: CONFIG_DIR, data: DATA, plugins: path.join(CONFIG_DIR, 'plugins') }[which];
  if (which === 'plugins') fs.mkdirSync(f, { recursive: true });
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
// resizing a frameless, transparent window from its edges (see .rz in the window)
const resizeFrom = new Map(), lastResize = [];
ipcMain.handle('win:resize-start', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isMaximized()) resizeFrom.set(e.sender.id, w.getBounds()); return true; });
ipcMain.on('win:resize', (e, edge, dx, dy) => {
  const w = BrowserWindow.fromWebContents(e.sender), b = resizeFrom.get(e.sender.id);
  if (!w || !b || w.isMaximized()) return;
  // not getMinimumSize(): Windows reports the current size there for transparent windows
  const minW = 560, minH = 360;
  let { x, y, width, height } = b;
  if (/e/.test(edge)) width = Math.max(minW, b.width + dx);
  if (/s/.test(edge)) height = Math.max(minH, b.height + dy);
  if (/w/.test(edge)) { width = Math.max(minW, b.width - dx); x = b.x + b.width - width; }
  if (/n/.test(edge)) { height = Math.max(minH, b.height - dy); y = b.y + b.height - height; }
  const want = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  if (SMOKE_OUT) lastResize.push({ edge, dx, dy, from: b, want });
  w.setBounds(want);
  // some Windows setups ignore a move and a resize in one call on transparent windows: do them one by one
  const got = w.getBounds();
  if (got.x !== want.x || got.y !== want.y || got.width !== want.width || got.height !== want.height) {
    w.setPosition(want.x, want.y); w.setSize(want.width, want.height);
  }
});
ipcMain.on('app:menu', e => prismMenu(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (e, t) => clipboard.writeText(String(t)));
ipcMain.on('open', (e, url) => { if (/^(https?:\/\/|ms-settings:)/.test(url)) shell.openExternal(url); });

let integration = null, lastWindowsSig = null;
function startIntegration() {
  if (!IS_WIN) return;
  integration = new Integration({
    exe: process.execPath,
    exeArgs: app.isPackaged ? [] : [app.getAppPath()],
    handoffExe: app.isPackaged ? path.join(path.dirname(process.execPath), 'prism-handoff.exe') : path.join(__dirname, '..', 'native', 'build', 'prism-handoff.exe'),
    dataDir: DATA
  });
  startHandoffServer(onHandedOffConsole);
}
// registry follows the settings; the result is shown in Settings > Windows
function applyIntegration(force) {
  if (!integration || (SMOKE_OUT && !process.env.PRISM_TEST_HANDOFF)) return;
  const sig = JSON.stringify(config.get().windows);
  if (sig === lastWindowsSig && !force) return;
  lastWindowsSig = sig;
  const r = integration.apply(config.get());
  for (const [k, v] of Object.entries(r)) if (v && !v.ok) notify(v.error);
  broadcast('integration:changed', integration.status(false));
}
ipcMain.handle('integration:status', () => integration ? integration.status() : null);

// What your PC is playing, for the visualizer: a hidden window records the system sound ("loopback")
// and sends the loudness of 96 frequency bands about 30 times a second. Nothing is saved or sent anywhere.
function startAudio(onBands, onError) {
  if (!IS_WIN) { onError('The visualizer needs Windows (it records what the PC is playing).'); return () => {}; }
  const { session, desktopCapturer } = require('electron');
  const ses = session.fromPartition('prism-audio');
  ses.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(src => cb(src.length ? { video: src[0], audio: 'loopback' } : {})).catch(() => cb({}));
  });
  const w = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { session: ses, preload: path.join(__dirname, 'renderer', 'audio-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const onB = (e, b) => { if (e.sender === w.webContents && Array.isArray(b)) onBands(b); };
  const onE = (e, m) => { if (e.sender === w.webContents) onError(String(m)); };
  ipcMain.on('audio:bands', onB); ipcMain.on('audio:error', onE);
  w.loadFile(path.join(__dirname, 'renderer', 'audio.html')).then(() => w.webContents.executeJavaScript('start()', true)).catch(e => onError(e.message));
  return () => { ipcMain.removeListener('audio:bands', onB); ipcMain.removeListener('audio:error', onE); if (!w.isDestroyed()) w.destroy(); };
}
// ---------- plugins and themes ----------
let plugins = null, themes = null;
function startPluginsAndThemes() {
  plugins = new Plugins({
    dir: path.join(CONFIG_DIR, 'plugins'),
    disabled: () => (config.get().plugins && config.get().plugins.disabled) || [],
    builtin: new Set([...Object.keys(toysMod.NAMES), 'toys', 'imgcat', 'plugin', 'ssh', 'theme', 'sudo', 'settings', 'prism']),
    fetch: (url, opts) => require('electron').net.fetch(url, opts),
    onChange: () => { writeShells(); broadcast('config:changed', payload()); }
  }).load();
  themes = new Themes({ dir: path.join(CONFIG_DIR, 'themes'), fetch: (url, opts) => require('electron').net.fetch(url, opts), repo: () => (updater ? updater.repo() : repoName()) });
  themes.load();
  if (!SMOKE_OUT) { plugins.watch(); themes.watch(() => broadcast('config:changed', payload())); }
}
ipcMain.handle('themes:store', () => themes.store());
ipcMain.handle('themes:install', async (e, id) => { await themes.install(id); broadcast('config:changed', payload()); return true; });
ipcMain.handle('themes:save', (e, id, theme) => { themes.save(id, theme); broadcast('config:changed', payload()); return true; });
ipcMain.handle('themes:remove', (e, id) => { themes.remove(id); broadcast('config:changed', payload()); return true; });
ipcMain.handle('plugins:install', async (e, spec) => { const p = await plugins.install(spec); return { name: p.name }; });
ipcMain.handle('plugins:remove', (e, name) => plugins.remove(name));
ipcMain.handle('ssh:import', () => readSshConfig());
// Hosts from ~/.ssh/config (wildcard entries are skipped)
function readSshConfig() {
  let text = ''; try { text = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8'); } catch { return []; }
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = /^(\S+)\s*=?\s*(.+)$/.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'host') { cur = null; for (const name of v.split(/\s+/)) if (!/[*?!]/.test(name)) { cur = { name, host: name, user: '', port: 22, identityFile: '' }; out.push(cur); } }
    else if (cur && k === 'hostname') cur.host = v;
    else if (cur && k === 'user') cur.user = v;
    else if (cur && k === 'port') cur.port = parseInt(v, 10) || 22;
    else if (cur && k === 'identityfile') cur.identityFile = v.replace(/^~/, os.homedir());
  }
  return out;
}
// how a saved server is opened: a tab running OpenSSH (built into Windows 10 and 11)
function sshSpec(h) {
  const args = [];
  if (h.port && +h.port !== 22) args.push('-p', String(h.port));
  if (h.identityFile) args.push('-i', h.identityFile);
  args.push((h.user ? h.user + '@' : '') + h.host);
  return { file: 'ssh.exe', args, title: h.name, ssh: h.name };
}
function sshHost(name) { return ((config.get().ssh || {}).hosts || []).find(h => h.name === name || h.host === name); }

function startToys() {
  toys = new Toys({
    plugins,
    // commands answered with text: pictures, plugins, saved servers, themes
    extra: {
      imgcat: async (tab, args, cwd) => {
        if (!args.length) return 'usage: imgcat FILE...\n';
        const t = ptys.get(tab); if (!t || !t.wc.send) return 'imgcat works in a Prism pane.\n';
        const api = new prismApi.PrismApi({}), out = [];
        for (const f of args) {
          try {
            const img = api.image({ path: f, cwd: cwd || t.cwd || os.homedir() });
            const r = await new Promise((resolve, reject) => { const rid = ++apiSeq; apiWaiting.set(rid, { resolve, reject, wc: t.wc }); t.wc.send('api:request', { rid, pane: tab, op: 'image', payload: img }); });
            out.push('\n'.repeat(r.rows || 1));
          } catch (e) { out.push(`imgcat: ${f}: ${e.message}\n`); }
        }
        return out.join('');
      },
      plugin: async (tab, args) => {
        const [sub, ...rest] = args;
        if (sub === 'install' && rest[0]) { const p = await plugins.install(rest[0]); return `Installed ${p.name}. Its commands work in new tabs: ${[...(p.commands || []), ...(p.animations || [])].join(', ') || '(none)'}\nPlugins run with your rights: only install plugins you trust.\n`; }
        if (sub === 'remove' && rest[0]) return `Removed ${plugins.remove(rest[0])}.\n`;
        const list = plugins.list.map(p => `  ${p.name.padEnd(18)} ${p.enabled ? '' : '(off) '}${p.error ? 'error: ' + p.error : [...p.commands, ...p.animations].join(', ')}`).join('\n');
        return (list || '  no plugins yet') + `\n\nprism plugin install OWNER/REPO · prism plugin remove NAME · folder: ${plugins.host.dir}\n`;
      },
      ssh: async (tab, args) => {
        const hosts = (config.get().ssh || {}).hosts || [];
        if (!args[0]) return hosts.length ? hosts.map(h => `  ${h.name.padEnd(18)} ${h.user ? h.user + '@' : ''}${h.host}${h.port && +h.port !== 22 ? ':' + h.port : ''}`).join('\n') + '\n' : 'No saved servers yet. Add them in Settings › SSH.\n';
        const h = sshHost(args[0]) || { name: args[0], host: args[0] };
        const t = ptys.get(tab); if (t && t.wc.send) t.wc.send('tab:open', { run: sshSpec(h) });
        return '';
      },
      theme: async (tab, args) => {
        const [sub, id] = args;
        if (sub === 'install' && id) { await themes.install(id); broadcast('config:changed', payload()); return `Installed ${id}. Pick it in Settings › Appearance, or: prism scheme ${id}\n`; }
        const list = await themes.store();
        return 'Theme store:\n' + list.map(t => `  ${t.id.padEnd(18)} ${t.installed ? '✓ ' : ''}${t.name}${t.author ? ' by ' + t.author : ''}`).join('\n') + '\n\nprism theme install NAME\n';
      }
    },
    resultsDir: RESULTS,
    version: app.getVersion(),
    display: () => { const d = screen.getPrimaryDisplay(); return `${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)}${d.scaleFactor !== 1 ? ` (scaled ${Math.round(d.scaleFactor * 100)}%)` : ''}`; },
    audio: startAudio,
    fetch: (url, opts) => require('electron').net.fetch(url, opts),
    tab: id => {
      const t = ptys.get(id);
      return t && { cols: t.cols, rows: t.rows, profile: t.profile, send: data => { if (!t.wc.isDestroyed()) t.wc.send('pty:data', { id, data }); } };
    }
  });
}
// ---------- Prism API: programs in a pane show images, charts, buttons, forms (src/api.js, renderer/widgets.js) ----------
const apiWaiting = new Map(); let apiSeq = 0;
function startApi() {
  if (!IS_WIN && !process.env.PRISM_API_TEST) return;
  new prismApi.PrismApi({
    pane: id => {
      const t = ptys.get(id);
      if (!t || t.wc.isDestroyed() || !t.wc.send) return null;
      return {
        request: (op, payload) => new Promise((resolve, reject) => {
          const rid = ++apiSeq;
          apiWaiting.set(rid, { resolve, reject, wc: t.wc });
          t.wc.send('api:request', { rid, pane: id, op, payload });
        })
      };
    },
    notify: (title, body) => {
      const { Notification } = require('electron');
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
      else notify(`${title}: ${body}`);
    },
    progress: (id, value, state) => {
      const t = ptys.get(id); if (!t || t.wc.isDestroyed()) return;
      if (t.wc.send) t.wc.send('api:progress', { pane: id, value, state });
      const w = BrowserWindow.fromWebContents(t.wc);
      if (w) w.setProgressBar(value === null ? -1 : value / 100, { mode: state === 'error' ? 'error' : state === 'paused' ? 'paused' : 'normal' });
    }
  }).start();
}
ipcMain.on('api:reply', (e, rid, result, error) => {
  const w = apiWaiting.get(rid); if (!w) return;
  apiWaiting.delete(rid);
  if (error) w.reject(new Error(error)); else w.resolve(result || {});
});
// a closed window answers nothing: its open requests end
app.on('web-contents-created', (e, wc) => wc.once('destroyed', () => { for (const [rid, w] of apiWaiting) if (w.wc === wc) { apiWaiting.delete(rid); w.reject(new Error('the window was closed')); } }));

// ---------- updates (Settings > About) ----------
let updater = null, updateToastFor = null;
function startUpdater() {
  updater = new Updater({
    version: app.getVersion(), exe: process.execPath, dataDir: DATA,
    fetch: (url, opts) => require('electron').net.fetch(url, opts),
    quit: () => { quitting = true; app.quit(); },
    emit: s => {
      broadcast('update:state', s);
      if (s.status === 'available' && updateToastFor !== s.latest) { updateToastFor = s.latest; notify(`Prism ${s.latest} is available. Update in Settings › About.`); }
    }
  });
  const last = updater.lastResult();
  if (last) setTimeout(() => notify(last.message), 2500);
  const auto = () => { if (config.get().startup.checkUpdates !== false) updater.check(); };
  setTimeout(auto, 8000);
  setInterval(auto, 12 * 3600 * 1000);
}
ipcMain.handle('update:state', () => updater ? { ...updater.state, canInstall: updater.canInstall() } : null);
ipcMain.handle('update:check', async () => updater ? { ...(await updater.check()), canInstall: updater.canInstall() } : null);
ipcMain.handle('update:install', () => updater ? updater.install() : null);

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
      // a slow machine can take a while to load the profile: wait for the prompt before typing
      for (let t = 0; t < 40000 && !out.includes('\u276f'); t += 500) await wait(500);
      for (const l of lines) { const [text, ms] = Array.isArray(l) ? l : [l, 2500]; if (!toys.input(id, text) && !elevator.input(id, text + '\r')) p.write(text + '\r'); await wait(ms); }
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
    {
      const b0 = w.getBounds();
      await w.webContents.executeJavaScript(`window.api.resizeStart().then(() => window.api.resizeTo('se', -100, -80))`);
      await wait(500);
      const b1 = w.getBounds();
      await w.webContents.executeJavaScript(`window.api.resizeStart().then(() => window.api.resizeTo('nw', 30, 20))`);
      await wait(500);
      const b2 = w.getBounds();
      w.setBounds({ x: b2.x + 5, y: b2.y + 5, width: b2.width - 5, height: b2.height - 5 }); await wait(300);
      const b3 = w.getBounds(); // diagnostics: move and resize in one call
      check('window: resizes from its edges', b1.width === b0.width - 100 && b1.height === b0.height - 80 && b2.x === b1.x + 30 && b2.width === b1.width - 30 && b2.y === b1.y + 20, { b0, b1, b2, b3, calls: lastResize });
    }

    // resizing must not duplicate or garble what is on screen (ConPTY repaints after a resize)
    {
      const buf = `(() => { const b = window.Prism.active.term.buffer.active; return Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\\n'); })()`;
      await w.webContents.executeJavaScript(`window.Prism.typeInActive('1..40 | ForEach-Object { "ROW_$_" + ("." * 30) }\\r')`);
      await wait(2500);
      for (const [edge, dx, dy] of [['se', -260, -160], ['se', 0, 0], ['se', -120, -60], ['se', 0, 0]]) {
        await w.webContents.executeJavaScript(`window.api.resizeStart().then(() => window.api.resizeTo('${edge}', ${dx}, ${dy}))`);
        await wait(700);
      }
      await wait(1500);
      const text = await w.webContents.executeJavaScript(buf);
      const rows = (text.match(/^ROW_\d+\.+$/gm) || []);
      const counts = {}; rows.forEach(r => { const n = r.match(/\d+/)[0]; counts[n] = (counts[n] || 0) + 1; });
      const dup = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);
      check('window: content intact after resizing', Object.keys(counts).length === 40 && !dup.length, { found: Object.keys(counts).length, duplicated: dup, tail: text.slice(-1500) });
    }

    // split panes: a second shell next to the first, in the same folder
    {
      const id = await w.webContents.executeJavaScript(`window.Prism.split('row').then(p => p && p.id)`);
      await wait(6000);
      await w.webContents.executeJavaScript(`window.Prism.typeInActive('echo PANE_$((2+3))\\r')`);
      await wait(2500);
      const r = await w.webContents.executeJavaScript(`(() => { const P = window.Prism, p = P.paneById(${JSON.stringify(id)}), b = p && p.term.buffer.active; return { panes: P.tab.panes.length, focused: P.active === p, cols: p && p.term.cols, text: b ? Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\\n') : '' }; })()`);
      check('panes: split right runs a second shell', r.panes === 2 && r.focused && /\bPANE_5\b/.test(r.text), r);
      await w.webContents.executeJavaScript(`window.Prism.split('col').then(() => true)`);
      await wait(1500);
      const n = await w.webContents.executeJavaScript(`window.Prism.tab.panes.length`);
      check('panes: split down', n === 3, n);
      // the session remembers the layout and the folders
      const snap = await w.webContents.executeJavaScript(`JSON.stringify(window.Prism.snapshot())`).then(JSON.parse);
      const root = snap.tabs[0] && snap.tabs[0].root;
      check('session: remembers panes and output', root && root.dir === 'row' && root.b && root.b.dir === 'col' && root.a.lines.some(l => /ROW_40/.test(l)), JSON.stringify(snap).slice(0, 1500));
    }

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

    // updates: the release check answers (CI sets PRISM_TEST_REPO to the repository being built)
    if (process.env.PRISM_TEST_REPO) {
      const u = new Updater({ version: '0.0.1', exe: process.execPath, dataDir: DATA, fetch: (url, o) => require('electron').net.fetch(url, o), quit: () => {}, emit: () => {} });
      const s = await u.check();
      check('update: finds the latest release', s.status === 'available' && /^\d+\.\d+\.\d+/.test(s.latest) && !!s.asset, s);
    }

    // toys: fetch prints through the shell, animations draw in the tab and stop on q
    for (const prof of testable.filter(p => p.kind === 'pwsh' || p.kind === 'cmd').slice(0, 2)) {
      const out = await runPty(prof, [['fetch', 6000], ['lava', 3000], ['q', 2500], ['matrix', 2500], ['q', 2500], ['visualizer', 5000], ['q', 2500], ['echo AFTER_TOYS', 2500], 'exit'], prof.kind === 'pwsh' ? 7000 : 3000);
      const plain = plainOf(out);
      check(`${prof.name}: fetch`, /Terminal: Prism/.test(plain) && /Memory: /.test(plain), plain.slice(0, 3000));
      check(`${prof.name}: lava draws and quits`, /t theme · q quit/.test(plain) && (out.match(/\x1b\[\?1049l/g) || []).length >= 2, plain.slice(-1500));
      check(`${prof.name}: visualizer starts`, /Listening|Play some music|sound|Audio/.test(plain), plain.slice(-1500));
      check(`${prof.name}: shell works after toys`, /AFTER_TOYS/.test(plain.split('echo AFTER_TOYS').pop() || ''), plain.slice(-800));
    }
    check('toys: nothing left running', toys.sessions.size === 0, [...toys.sessions.keys()]);
    // more toys, and a plugin command (CI puts examples/plugins/hello in the plugins folder)
    {
      const ps = testable.find(p => p.kind === 'pwsh');
      const out = plainOf(await runPty(ps, [['cowsay Prism moo', 5000], ['snake', 2500], ['q', 2000], ['hello Ada', 5000], ['fire', 2500], ['q', 2000], ['weather Warsaw', 12000], ['echo AFTER_MORE', 2500], 'exit'], 7000));
      check('toys: cowsay', /< Prism moo >/.test(out) && /\(o o\)/.test(out), out.slice(0, 1500));
      check('toys: snake starts and quits', /snake · score 0/.test(out), out.slice(-2000));
      check('toys: weather answers', /Weather|°|wttr\.in|weather service|internet/i.test(out.split('weather Warsaw').pop() || ''), (out.split('weather Warsaw').pop() || '').slice(0, 1200));
      check('plugins: example plugin loaded', plugins.list.some(p => p.name === 'hello' && p.commands.includes('hello') && p.animations.includes('fire')), plugins.list);
      check('plugins: plugin command runs', /Hello, Ada! This is Prism/.test(out), out.slice(-3000));
      check('plugins: plugin animation runs', /\x1b\[\?1049h|AFTER_MORE/.test(out) && /AFTER_MORE/.test(out.split('echo AFTER_MORE').pop() || ''), out.slice(-800));
    }

    // Prism API: a program in the pane asks for a picture, a chart, buttons, a form, progress and a title
    if (IS_WIN) {
      const paneId = await w.webContents.executeJavaScript('window.Prism.active.id');
      const sock = net.connect(prismApi.pipeName());
      await new Promise(r => sock.once('connect', r));
      sock.setEncoding('utf8');
      let ibuf = ''; const answers = new Map();
      sock.on('data', d => { ibuf += d; let i; while ((i = ibuf.indexOf('\n')) >= 0) { const m = JSON.parse(ibuf.slice(0, i)); ibuf = ibuf.slice(i + 1); answers.get(m.id)?.(m); } });
      let n = 0;
      const ask = (op, f = {}) => new Promise(res => { const id = ++n; answers.set(id, res); sock.write(JSON.stringify({ id, op, tab: paneId, ...f }) + '\n'); });
      const hello = await ask('hello');
      check('api: hello', hello.ok && hello.version >= 1 && hello.ops.includes('image'), hello);
      const img = await ask('image', { data: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAATklEQVR4nO3PUQkAIBTAwJfTJIY1jCH8OITBAtxmr/N1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2AXfTcMT7uhRvAAAAAElFTkSuQmCC' });
      const chartA = await ask('chart', { type: 'bar', title: 'Test', labels: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 3, 2] }], height: 8 });
      await wait(800);
      const shown = await w.webContents.executeJavaScript(`document.querySelectorAll('.pwidget img').length`);
      check('api: image and chart are drawn in the pane', img.ok && img.rows > 0 && chartA.ok && chartA.rows >= 4 && chartA.rows <= 8 && shown >= 2, { img, chartA, shown });
      const chosen = ask('choose', { prompt: 'Pick', options: ['red', 'green', 'blue'] });
      await wait(800);
      await w.webContents.executeJavaScript(`(() => { const b = document.querySelector('.pchoose button[data-i="1"]'); b && b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return !!b; })()`);
      const ch = await Promise.race([chosen, wait(5000).then(() => ({ timeout: true }))]);
      check('api: buttons answer with the choice', ch.ok && ch.choice === 'green', ch);
      const formP = ask('form', { title: 'Login', fields: [{ name: 'user', label: 'User' }, { name: 'remember', label: 'Remember me', type: 'checkbox' }] });
      await wait(800);
      await w.webContents.executeJavaScript(`(() => { const f = document.querySelector('.pform form'); if (!f) return false; f.querySelector('#pf0').value = 'ada'; f.querySelector('#pf1').checked = true; f.requestSubmit(); return true; })()`);
      const fr = await Promise.race([formP, wait(5000).then(() => ({ timeout: true }))]);
      check('api: form returns the values', fr.ok && fr.values && fr.values.user === 'ada' && fr.values.remember === true, fr);
      await ask('progress', { value: 60 }); await ask('title', { text: 'API title' });
      await wait(500);
      const tabUi = await w.webContents.executeJavaScript(`({ pg: !!document.querySelector('.tab.on .pg'), title: document.querySelector('.tab.on .t').textContent })`);
      check('api: progress and title', tabUi.pg && tabUi.title === 'API title', tabUi);
      await ask('progress', { value: null });
      const bad = await ask('image', { tab: 'nope', data: 'AAAA' });
      check('api: refuses bad requests', !bad.ok && !!bad.error, bad);
      sock.destroy();
      // imgcat from the shell
      const pngFile = path.join(os.tmpdir(), 'prism-test.png');
      fs.writeFileSync(pngFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAATklEQVR4nO3PUQkAIBTAwJfTJIY1jCH8OITBAtxmr/N1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjx2AXfTcMT7uhRvAAAAAElFTkSuQmCC', 'base64'));
      const before = await w.webContents.executeJavaScript(`document.querySelectorAll('.pwidget img').length`);
      await w.webContents.executeJavaScript(`window.Prism.typeInActive(${JSON.stringify('imgcat ' + pngFile + '\r')})`);
      await wait(6000);
      const after = await w.webContents.executeJavaScript(`document.querySelectorAll('.pwidget img').length`);
      check('api: imgcat shows a picture', after > before, { before, after });
    }

    // theme store (from this repository) and saved SSH servers
    if (process.env.PRISM_TEST_REPO) {
      let list = []; try { list = await themes.store(); } catch (e) { list = [{ error: e.message }]; }
      check('themes: the store lists themes', list.length >= 10 && list.every(t => t.id && t.preview), list.slice(0, 2));
      try { await themes.install('aurora'); } catch {}
      check('themes: install from the store', !!themes.user.aurora && payload().themes.aurora, Object.keys(themes.user));
    }
    if (IS_WIN) {
      setConfig({ ssh: { hosts: [{ name: 'nowhere', host: '127.0.0.1', port: 1 }] } });
      await wait(400);
      const id = await w.webContents.executeJavaScript(`window.Prism.openSsh('nowhere').then(p => p && p.id)`);
      await wait(6000);
      const r = await w.webContents.executeJavaScript(`(() => { const p = window.Prism.paneById(${JSON.stringify(id)}), b = p && p.term.buffer.active; return { title: p && p.title, text: b ? Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\\n') : '' }; })()`);
      check('ssh: a saved server opens a tab with OpenSSH', /ssh|connect|refused/i.test(r.text) && /exited with code/.test(r.text), r);
    }


    // 3. a tab that runs one program, and stays open with its exit code
    {
      const id = await w.webContents.executeJavaScript(`window.Prism.newTab(null, null, { run: { file: 'cmd.exe', args: '/d /s /c "echo RUN_OK & exit 4"', title: 'runtest' } }).then(t => t.id)`);
      await wait(4000);
      const r = await w.webContents.executeJavaScript(`(() => { const t = window.Prism.paneById(${JSON.stringify(id)}); const b = t && t.term.buffer.active; return { title: t && t.title, text: b ? Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\\n') : '' }; })()`);
      check('run: program output in its own tab', /RUN_OK/.test(r.text) && !!r.title, r); // the program may set its own title
      check('run: tab stays open with the exit code', /exited with code 4/.test(r.text), r.text.slice(-300));
      await w.webContents.executeJavaScript(`window.Prism.typeInActive('x')`);
      await wait(800);
      const left = await w.webContents.executeJavaScript(`!!window.Prism.paneById(${JSON.stringify(id)})`);
      check('run: a key closes the finished tab', !left, left);
    }

    // 4. Prism as the default terminal: a console started like from Explorer must land in a Prism tab
    if (IS_WIN && process.env.PRISM_TEST_HANDOFF) {
      const st0 = integration.status();
      setConfig({ windows: { defaultTerminal: true } });
      await wait(500);
      const st = integration.status();
      check('default terminal: registry set', st.defaultTerminal.active, { before: st0, after: st });
      if (process.env.PRISM_TEST_HANDOFF_HKLM) {
        // CI runs elevated, and Windows ignores per-user COM registrations for elevated processes
        const ls = require('child_process').spawnSync('reg.exe', ['add', 'HKLM\\Software\\Classes\\CLSID\\{682C9CD9-030D-4029-BA37-7DD6F909FDF8}\\LocalServer32', '/ve', '/d', `"${integration.host.handoffExe}"`, '/f'], { encoding: 'utf8' });
        console.log('HKLM registration:', ls.status, ls.stderr);
      }
      const before = smokeHandoffs.length;
      if (process.env.PRISM_TEST_HANDOFF_LOG) require('child_process').spawnSync('reg.exe', ['add', 'HKCU\\Software\\Prism', '/v', 'HandoffLog', '/d', process.env.PRISM_TEST_HANDOFF_LOG, '/f']);
      // `start` gives the program a new console, as when it is opened from Explorer
      require('child_process').spawn('cmd.exe', ['/d /c start "" cmd.exe /d /c "echo HANDOFF_OK & ping -n 4 127.0.0.1 >nul & exit 3"'], { windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore' });
      for (let i = 0; i < 60 && smokeHandoffs.length === before; i++) await wait(500);
      const got = smokeHandoffs[before];
      check('default terminal: Windows hands the console to Prism', !!got, { handoffs: smokeHandoffs, log: (() => { try { return fs.readFileSync(process.env.PRISM_TEST_HANDOFF_LOG || '', 'utf8').slice(-3000); } catch { return null; } })() });
      if (got) {
        await wait(7000);
        const r = await w.webContents.executeJavaScript(`(() => { const t = window.Prism.paneById(${JSON.stringify(got.id)}); const b = t && t.term.buffer.active; return { tab: !!t, title: t && t.title, text: b ? Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) || '').join('\\n') : '' }; })()`);
        check('default terminal: console output in the tab', r.tab && /HANDOFF_OK/.test(r.text), r);
        check('default terminal: exit code shown', /exited with code 3/.test(r.text), r.text.slice(-300));
      }
      setConfig({ windows: { defaultTerminal: false } });
      await wait(500);
      check('default terminal: switched off again', !integration.status(false).defaultTerminal.active, integration.status(false));
    }

    // 5. administrator rights on demand (CI runs elevated; PRISM_TEST_ELEVATE makes Prism go through the real helper anyway)
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
  app.on('second-instance', (e, args, workingDirectory) => {
    const req = openRequest(args, workingDirectory);
    if (req) return openTab(req);
    if (args.includes('--settings')) onPrismAction('settings');
    else if (!args.includes('--background')) { if (terminals().some(w => w.isVisible())) openTerminal(); else onPrismAction('open'); }
  });
  app.whenReady().then(() => {
    startPluginsAndThemes();
    lastShellSig = JSON.stringify([config.get().aliases, config.get().prompt, config.get().shell, config.get().admin]);
    writeShells();
    watchInbox();
    startPipe();
    startElevator();
    startToys();
    startIntegration();
    startApi();
    config.onChange(() => onConfigChanged());
    if (SMOKE_OUT) return runSmoke();
    undoOldDesktop();
    startUpdater();
    config.watch();
    onConfigChanged();
    const req = openRequest(argv, process.cwd());
    const last = req || argv.includes('--background') ? [] : loadSession();
    if (last.length) last.forEach((r, i) => openTerminal({ restore: r, settings: i === 0 && argv.includes('--settings') }));
    else if (!argv.includes('--background') || req) openTerminal({ settings: argv.includes('--settings'), open: req });
    app.on('activate', () => { if (!terminals().length) openTerminal(); });
  });
  app.on('window-all-closed', () => {
    if (SMOKE_OUT) return;
    if (!IS_MAC || quitting) app.quit();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); writeSession(true); });
}
