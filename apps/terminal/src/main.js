'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, globalShortcut, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const pty = require('@lydell/node-pty');
const shells = require('./shells');
const { Config, CONFIG_FILE, STYLE_FILE, CONFIG_DIR, ensureFiles } = require('./config');
const { translate } = require('./translate');
const win32 = require('./win32');
const { Desktop, prettyName } = require('./desktop');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const argv = process.argv;
// --smoke FILE: self-test without a person (used by CI); writes results to FILE and quits.
const SMOKE_OUT = (() => { const i = argv.indexOf('--smoke'); return i < 0 ? null : path.resolve(argv[i + 1] || 'smoke.json'); })();
app.setPath('userData', SMOKE_OUT ? fs.mkdtempSync(path.join(os.tmpdir(), 'prism-smoke-')) : path.join(app.getPath('appData'), 'Prism'));

const DATA = app.getPath('userData');
const SCRIPTS = path.join(DATA, 'shell');
const INBOX = path.join(DATA, 'inbox');
const STATIC_SHELL = path.join(__dirname, 'shell');
// Engine (prism.ps1 + themes): next to Prism.exe when installed, the repository root in development.
const ENGINE = app.isPackaged ? path.join(path.dirname(process.execPath), 'engine') : path.resolve(__dirname, '..', '..', '..');
const LOCAL = IS_WIN && !SMOKE_OUT ? path.join(process.env.LOCALAPPDATA || DATA, 'Prism') : path.join(DATA, 'local');
const USER_THEMES = path.join(LOCAL, 'themes');
const PIPE = `prism-${process.pid}`;
const BIN = path.join(process.env.LOCALAPPDATA || '', 'Prism', 'bin');

const config = new Config(path.join(DATA, 'settings.json'));
const ptys = new Map(); // id -> { p, wc }
const PROFILES = shells.detectProfiles();
let desktop = null;
let quitting = false;

const exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const terminals = () => BrowserWindow.getAllWindows().filter(w => w.prismTerminal && !w.isDestroyed());
const broadcast = (ch, data) => terminals().forEach(w => w.webContents.send(ch, data));

// ---------- shells ----------
function writeShells() { try { shells.writeAll(SCRIPTS, config.get(), STATIC_SHELL); } catch (e) { console.error('Prism: writing shell files failed', e); } }
function launch(profile) {
  const f = n => path.join(SCRIPTS, n);
  const slash = p => IS_WIN ? p.replace(/\\/g, '/') : p;
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Prism', PRISM_INBOX: profile.kind === 'bash' ? slash(INBOX) : INBOX };
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
function spawnShell(profile, cols, rows, cwd) {
  const { args, env } = launch(profile);
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  return pty.spawn(profile.cmd, args, { name: 'xterm-256color', cols: Math.max(cols, 2), rows: Math.max(rows, 2), cwd: dir, env });
}

// ---------- translation server: the PowerShell profile asks before running each line ----------
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
        const r = translate(String(req.line ?? ''), { ps7: !!req.ps7, last: req.last || '', env: toArr(req.env), vars: toArr(req.vars) });
        sock.write(JSON.stringify({ line: r.line, changed: r.changed }) + '\n');
        if (r.changed && config.get().shell.translateNotify) broadcast('term:translated', { from: req.line, to: r.line, dialects: r.dialects });
      }
    });
  });
  server.on('error', e => console.error('Prism: translation pipe error', e.message));
  server.listen(`\\\\.\\pipe\\${PIPE}`);
}

// ---------- messages from shell commands (settings, prism alias, prism opacity...) ----------
const smokeMsgs = [];
function onShellMessage(msg) {
  if (SMOKE_OUT) smokeMsgs.push(msg);
  const i = msg.indexOf(';'), cmd = i < 0 ? msg : msg.slice(0, i), arg = i < 0 ? '' : msg.slice(i + 1).trim();
  const cfg = config.get();
  if (cmd === 'add') {
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
  try { fs.watch(INBOX, () => drainInbox()); } catch {}
  setInterval(drainInbox, 600);
}

// ---------- config ----------
let lastShellSig = '', lastDeskSig = '', lastLogin = null;
function setConfig(patch) {
  // picking a color scheme clears custom colors; applying a theme replaces them
  if (patch.terminal && ('scheme' in patch.terminal || patch.terminal.colors)) config.gui.terminal = { ...(config.gui.terminal || {}), colors: {} };
  config.setGui(patch);
  onConfigChanged();
  return config.get();
}
function onConfigChanged() {
  const cfg = config.get();
  const shellSig = JSON.stringify([cfg.aliases, cfg.prompt, cfg.shell]);
  if (shellSig !== lastShellSig) { lastShellSig = shellSig; writeShells(); }
  const deskSig = JSON.stringify([cfg.dock, cfg.bar, cfg.terminal.colors, cfg.terminal.blur]) + config.css;
  if (desktop && deskSig !== lastDeskSig) { lastDeskSig = deskSig; desktop.apply(); }
  const login = !!(cfg.startup.launchAtLogin || cfg.dock.enabled || cfg.bar.enabled);
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

// ---------- themes ----------
const THEME_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
function listThemes() {
  const out = new Map();
  for (const [dir, builtIn] of [[path.join(ENGINE, 'themes'), true], [USER_THEMES, false]]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'schema.json'); } catch {}
    for (const f of files) {
      const p = path.join(dir, f), t = readJson(p);
      if (t && t.id && t.name && t.colors) out.set(t.id, { id: t.id, builtIn, path: p, theme: t });
    }
  }
  return [...out.values()];
}
function validateTheme(t) {
  if (!THEME_ID.test(t.id || '')) return 'Theme id: lowercase letters, digits and dashes.';
  if (!t.name || typeof t.name !== 'string') return 'The theme needs a name.';
  const c = t.colors || {};
  if (!['dark', 'light'].includes(c.mode)) return 'Pick a mode: dark or light.';
  for (const [k, v] of Object.entries(c)) if (k !== 'mode' && !HEX.test(v)) return `Color ${k} must look like #RRGGBB.`;
  for (const k of ['background', 'text', 'accent']) if (!c[k]) return `Missing color: ${k}.`;
  const resolvable = v => HEX.test(v) || HEX.test(c[v] || '');
  for (const v of (t.wallpaper?.colors || [])) if (!resolvable(v)) return `Unknown wallpaper color: ${v}`;
  for (const k of ['focused', 'inactive']) { const v = t.windows?.border?.[k]; if (v && !resolvable(v)) return `Unknown border color: ${v}`; }
  return null;
}
function saveTheme(theme) {
  const t = JSON.parse(JSON.stringify(theme));
  delete t.$schema;
  const err = validateTheme(t);
  if (err) return { ok: false, error: err };
  fs.mkdirSync(USER_THEMES, { recursive: true });
  const wp = t.wallpaper;
  if (wp?.type === 'image' && wp.path) {
    let src = wp.path;
    if (!path.isAbsolute(src)) src = [path.join(USER_THEMES, src), path.join(ENGINE, 'themes', src)].find(exists) || src;
    if (!exists(src)) return { ok: false, error: 'The wallpaper image was not found.' };
    const name = `${t.id}-wallpaper${path.extname(src).toLowerCase() || '.png'}`;
    const dest = path.join(USER_THEMES, name);
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    wp.path = name;
  }
  const p = path.join(USER_THEMES, t.id + '.json');
  fs.writeFileSync(p, JSON.stringify(t, null, 2));
  return { ok: true, path: p, theme: t };
}
// The parts of a desktop theme that belong to the app: terminal colors, prompt, dock, menu bar.
function themeToConfig(t) {
  const c = t.colors || {}, e = t.effects || {}, f = t.fonts || {};
  const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return {
    terminal: clean({ scheme: t.terminal?.scheme || 'prism', opacity: e.opacity, blur: e.blur, radius: e.radius, fontSize: f.size,
      font: f.mono ? `"${f.mono}", "Cascadia Mono", Consolas, monospace` : undefined,
      colors: clean({ ...(t.terminal?.palette || {}), background: c.background, foreground: c.text, accent: c.accent }) }),
    prompt: { colors: clean({ path: c.accent, git: c.accent2 || c.accent, symbol: c.accent2 || c.accent, muted: c.muted }) },
    dock: { enabled: false, ...(t.dock || {}) },
    bar: { enabled: false, ...(t.bar || {}) }
  };
}
let lastThemeStamp = null;
function watchCurrentTheme() {
  const file = path.join(LOCAL, 'current.json');
  const check = () => {
    const cur = readJson(file);
    const stamp = cur ? `${cur.id}|${cur.applied}` : 'none';
    if (stamp === lastThemeStamp) return;
    const first = lastThemeStamp === null;
    lastThemeStamp = stamp;
    if (first && desktop.state.themeStamp === stamp) return; // already applied before this start
    desktop.state.themeStamp = stamp; desktop.writeState();
    if (!cur) { if (!first) setConfig({ dock: { enabled: false }, bar: { enabled: false } }); return; }
    const t = (cur.path && readJson(cur.path)) || listThemes().find(x => x.id === cur.id)?.theme;
    if (t) setConfig(themeToConfig(t));
  };
  check();
  fs.watchFile(file, { interval: 800 }, check);
}

// ---------- prism.ps1 (changes to Windows) ----------
let running = null;
function runPrism(cmd, arg, sender) {
  return new Promise(resolve => {
    if (!IS_WIN) return resolve({ code: -1, error: 'Desktop themes work on Windows 11 only.' });
    if (running) return resolve({ code: -1, error: 'Prism is already applying a change. Please wait.' });
    if (!['apply', 'restore'].includes(cmd)) return resolve({ code: -1, error: 'Unknown command.' });
    const script = path.join(ENGINE, 'installer', 'prism.ps1');
    if (!exists(script)) return resolve({ code: -1, error: `Prism engine not found: ${script}` });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, cmd];
    if (arg) args.push(arg);
    running = spawn('powershell.exe', args, { windowsHide: true });
    const send = d => { if (sender && !sender.isDestroyed()) sender.send('prism:log', d.toString('utf8')); };
    running.stdout.on('data', send);
    running.stderr.on('data', send);
    running.on('error', e => { running = null; resolve({ code: -1, error: e.message }); });
    running.on('close', code => { running = null; resolve({ code }); });
  });
}
function win11() { return IS_WIN && parseInt(os.release().split('.')[2] || '0', 10) >= 22000; }
function prismState() {
  return { current: readJson(path.join(LOCAL, 'current.json')), hasBackup: exists(path.join(LOCAL, 'backup.json')), isWin: IS_WIN, win11: win11(), version: app.getVersion(), engine: ENGINE };
}

// ---------- terminal windows ----------
function openTerminal({ show = true, settings = false } = {}) {
  const cfg = config.get();
  const w = new BrowserWindow({
    width: 1180, height: 740, minWidth: 560, minHeight: 360, show: false, title: 'Prism',
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
  w.on('closed', () => { for (const [id, t] of ptys) if (t.wc === wc) { try { t.p.kill(); } catch {} ptys.delete(id); } });
  return w;
}
function onPrismAction(what, arg) {
  if (what === 'open') { const w = terminals()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else openTerminal(); }
  else if (what === 'new') openTerminal();
  else if (what === 'settings') { const w = terminals()[0]; if (w) { w.show(); w.focus(); w.webContents.send('app:command', `settings ${arg || ''}`.trim()); } else openTerminal({ settings: arg || true }); }
}
function prismMenu(win) {
  const themes = listThemes();
  const cur = prismState().current;
  const sender = terminals()[0]?.webContents;
  Menu.buildFromTemplate([
    { label: 'New Prism window', click: () => openTerminal() },
    { label: 'Settings…', click: () => onPrismAction('settings') },
    { type: 'separator' },
    { label: 'Desktop theme', submenu: themes.map(t => ({ label: t.theme.name, type: 'radio', checked: cur?.id === t.id, click: () => runPrism('apply', t.path, sender) })) },
    { label: 'Restore original Windows look', click: () => runPrism('restore', null, sender) },
    { type: 'separator' },
    { label: 'Hide menu bar', click: () => setConfig({ bar: { enabled: false } }) },
    { label: 'Quit Prism', click: () => { quitting = true; app.quit(); } }
  ]).popup({ window: win });
}

// ---------- IPC ----------
ipcMain.handle('app:init', e => ({
  ...payload(), profiles: PROFILES, platform: process.platform, version: app.getVersion(), translateAvailable: IS_WIN,
  startup: { openSettings: BrowserWindow.fromWebContents(e.sender)?.openSettingsOnLoad || false }
}));
ipcMain.handle('config:set', (e, patch) => setConfig(patch));
ipcMain.handle('pty:create', (e, id, profileId, cols, rows, cwd) => {
  const profile = profileFor(profileId);
  const wc = e.sender;
  let p;
  try { p = spawnShell(profile, cols, rows, cwd); } catch (err) {
    setTimeout(() => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data: `\r\n\x1b[31mCould not start ${profile.cmd}: ${err.message}\x1b[0m\r\n` }); }, 50);
    return { ok: false, profile };
  }
  ptys.set(id, { p, wc });
  p.onData(data => { if (!wc.isDestroyed()) wc.send('pty:data', { id, data }); });
  p.onExit(({ exitCode }) => { ptys.delete(id); if (!wc.isDestroyed()) wc.send('pty:exit', { id, exitCode }); });
  return { ok: true, profile, pid: p.pid };
});
ipcMain.on('pty:write', (e, id, d) => ptys.get(id)?.p.write(d));
ipcMain.on('pty:resize', (e, id, c, r) => { try { ptys.get(id)?.p.resize(Math.max(c, 2), Math.max(r, 2)); } catch {} });
ipcMain.on('pty:kill', (e, id) => { try { ptys.get(id)?.p.kill(); } catch {} ptys.delete(id); });
ipcMain.handle('themes:list', () => listThemes());
ipcMain.handle('themes:save', (e, t) => { try { return saveTheme(t); } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('themes:delete', (e, id) => {
  const item = listThemes().find(t => t.id === id);
  if (!item || item.builtIn) return { ok: false, error: 'Only your own themes can be deleted.' };
  fs.unlinkSync(item.path);
  return { ok: true };
});
ipcMain.handle('prism:state', () => prismState());
ipcMain.handle('prism:run', (e, cmd, arg) => runPrism(cmd, arg, e.sender));
ipcMain.handle('app:pick-app', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Add an app to the Dock', properties: ['openFile'], filters: [{ name: 'Apps', extensions: ['exe', 'lnk', 'bat', 'cmd'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app:pick-image', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app:dock-defaults', () => require('./desktop').defaultPinned());
ipcMain.handle('app:running-apps', () => [...new Map(win32.listWindows().filter(w => w.exe).map(w => [w.exe.toLowerCase(), { name: prettyName(w.exe), path: w.exe }])).values()]);
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

// ---------- self-test (CI) ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
function runPty(profile, lines, firstWait) {
  return new Promise(resolve => {
    let out = '', done = false;
    const p = spawnShell(profile, 140, 40);
    const finish = () => { if (done) return; done = true; try { p.kill(); } catch {} resolve(out); };
    p.onData(d => { out += d; });
    p.onExit(finish);
    (async () => { await wait(firstWait); for (const l of lines) { p.write(l + '\r'); await wait(2500); } setTimeout(finish, 3000); })();
    setTimeout(finish, 120000);
  });
}
async function runSmoke() {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); };
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
      await P.openSettings('themes');
      await new Promise(s => setTimeout(s, 800));
      r.cards = document.querySelectorAll('.tcard[data-theme]').length;
      r.preview = !!document.querySelector('#sPreview .desk');
      r.sections = {};
      for (const s of P.sectionIds) { P.goSection(s); await new Promise(x => setTimeout(x, 80)); r.sections[s] = document.querySelector('#sContent').children.length; }
      P.closeSettings();
      return r;
    })()`);
    check('window: xterm loaded', ui.terminal === 'function', ui);
    check('window: first tab runs a shell with a prompt', ui.tabs >= 1 && /❯|>/.test(ui.text), ui.text);
    check('window: no tutorial', !ui.tour, ui);
    check('settings: desktop themes listed', ui.cards >= 3, ui);
    check('settings: desktop preview', ui.preview, ui);
    check('settings: every section renders', Object.values(ui.sections).length >= 8 && Object.values(ui.sections).every(n => n > 0), ui.sections);
    check('window: no console errors', errors.length === 0, errors);

    // 2. shells: aliases, Prism commands, Linux commands, translation through the pipe
    const testable = PROFILES.filter(p => ['pwsh', 'cmd', 'bash'].includes(p.kind) && p.id !== 'prism');
    for (const prof of testable) {
      await wait(1000); drainInbox(); smokeMsgs.length = 0;
      const lines = prof.kind === 'cmd' ? ['aliases', 'settings dock', 'exit']
        : prof.kind === 'bash' ? ['prism alias', 'settings dock', 'prism alias smk "echo smoke"', 'Get-Date -Format yyyy', 'exit']
        : ['prism alias', 'settings dock', 'prism alias smk "echo smoke"', 'echo A1 && echo B$(2)', 'cmd /c exit 1 && echo NOT$("PRINTED")', 'ls -la ~', 'echo %USERNAME%', 'exit'];
      const out = await runPty(prof, lines, prof.kind === 'pwsh' ? 7000 : 3000);
      await wait(1200); drainInbox();
      const plain = out.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
      check(`${prof.name}: alias list`, /gs\s+git status/.test(plain), plain.slice(-2000));
      check(`${prof.name}: settings command reaches Prism`, smokeMsgs.includes('panel;dock'), smokeMsgs);
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
    // 3. desktop: dock and menu bar
    if (IS_WIN) {
      check('win32: window list works', win32.listWindows().some(x => x.title === 'Prism'), win32.listWindows().map(x => `${x.title} (${path.basename(x.exe)})`));
      const taskbar = win32.taskbarAutohide();
      const waBefore = win32.getWorkArea();
      setConfig({ dock: { enabled: true }, bar: { enabled: true } });
      await wait(6000);
      check('dock: window open', !!desktop.dock && desktop.dock.isVisible(), { exists: !!desktop.dock, bounds: desktop.dock && desktop.dock.getBounds(), hiddenFor: desktop.fullscreen || null, fg: win32.className(win32.foreground()) });
      check('dock: pinned apps listed', desktop.items.filter(i => i.pinned).length >= 3, desktop.items.map(i => i.name));
      check('dock: Prism shows as running', desktop.items.some(i => i.prism && i.running), desktop.items.map(i => [i.name, i.running]));
      check('dock: icons loaded', desktop.items.filter(i => i.iconUrl).length >= 2, desktop.items.map(i => [i.name, !!i.iconUrl]));
      check('bar: window open', !!desktop.bar && desktop.bar.isVisible(), { exists: !!desktop.bar, bounds: desktop.bar && desktop.bar.getBounds(), hiddenFor: desktop.fullscreen || null, fg: win32.className(win32.foreground()) });
      const wa = win32.getWorkArea(), sf = screen.getPrimaryDisplay().scaleFactor;
      check('bar: reserves screen space', wa && wa.top >= Math.round(config.get().bar.height * sf) - 1, { wa, waBefore });
      if (taskbar !== null) check('dock: taskbar set to auto-hide', win32.taskbarAutohide() === true, null);
      const barText = await desktop.bar.webContents.executeJavaScript('document.querySelector(".menubar").innerText');
      check('bar: shows clock and stats', /\d{2}:\d{2}/.test(barText) && /%/.test(barText), barText);
      if (process.env.PRISM_EXPECT_GLAZE) {
        await wait(4000);
        const ws = await desktop.bar.webContents.executeJavaScript('document.querySelectorAll(".ws").length');
        check('bar: GlazeWM workspaces', ws >= 1, { ws, connected: desktop.glaze.connected });
      }
      setConfig({ dock: { enabled: false }, bar: { enabled: false } });
      await wait(1500);
      if (taskbar !== null) check('dock off: taskbar restored', win32.taskbarAutohide() === taskbar, null);
      const waAfter = win32.getWorkArea();
      check('dock off: work area restored', JSON.stringify(waAfter) === JSON.stringify(waBefore), { waBefore, waAfter });
    }
    // 4. engine themes
    const themes = listThemes();
    check('themes: loaded from engine', themes.length >= 3, themes.map(t => t.id));
    for (const t of themes) check(`theme ${t.id}: valid`, !validateTheme(t.theme), validateTheme(t.theme));
  } catch (err) {
    check('exception', false, String(err && err.stack || err));
  }
  const ok = checks.every(c => c.ok);
  fs.writeFileSync(SMOKE_OUT, JSON.stringify({ ok, checks }, null, 2));
  desktop?.restore();
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
    lastShellSig = JSON.stringify([config.get().aliases, config.get().prompt, config.get().shell]);
    writeShells();
    watchInbox();
    startPipe();
    desktop = new Desktop({
      preload: path.join(__dirname, 'preload-desktop.js'), rendererDir: path.join(__dirname, 'renderer'),
      getConfig: () => config.get(), getCss: () => config.css, saveGui: patch => setConfig(patch), onPrism: onPrismAction, onMenu: prismMenu
    });
    config.onChange(() => onConfigChanged());
    if (SMOKE_OUT) return runSmoke();
    config.watch();
    watchCurrentTheme();
    onConfigChanged();
    if (!argv.includes('--background')) openTerminal({ settings: argv.includes('--settings') });
    app.on('activate', () => { if (!terminals().length) openTerminal(); });
  });
  app.on('window-all-closed', () => {
    if (SMOKE_OUT) return;
    const cfg = config.get();
    if (!quitting && (cfg.dock.enabled || cfg.bar.enabled)) return; // the dock and menu bar keep running
    if (!IS_MAC) app.quit();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); desktop?.restore(); });
}
