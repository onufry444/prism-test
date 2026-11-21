'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('@lydell/node-pty');
const commands = require('./commands');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const SCRIPTS = path.join(DATA, 'shell');

const DEFAULTS = {
  look: {
    preset: 'grafit', opacity: 78, bg: '#101216', fg: '#e7e5df', accent: '#7ee0b5', ansi: 'dark',
    font: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
    size: 15, lineHeight: 1.2, cursor: 'block', blink: true, padding: 14, radius: 12
  },
  desktopBlur: true,
  defaultProfile: null,
  commands: [
    { name: 'hej', type: 'text', body: 'Cześć {1}! Jest {time}, miłego dnia.', desc: 'przywitanie' },
    { name: 'gs', type: 'run', body: 'git status', desc: 'skrót do git status' }
  ]
};

let settings = loadSettings();
let win = null;
const ptys = new Map();

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...s, look: { ...DEFAULTS.look, ...(s.look || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ---------- profile (powłoki) ----------
const exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function which(cmd) {
  const exts = IS_WIN ? ['.exe', '.cmd', ''] : [''];
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const e of exts) {
    const p = path.join(d, cmd + e);
    if (exists(p)) return p;
  }
  return null;
}
function kindOf(file) {
  const b = path.basename(file).toLowerCase().replace(/\.exe$/, '');
  if (b === 'bash') return 'bash';
  if (b === 'zsh') return 'zsh';
  if (b === 'pwsh' || b === 'powershell') return 'pwsh';
  if (b === 'cmd') return 'cmd';
  return 'other';
}
function detectProfiles() {
  const list = [];
  if (IS_WIN) {
    const pw = which('pwsh');
    if (pw) list.push({ id: 'pwsh', name: 'PowerShell 7', cmd: pw, kind: 'pwsh' });
    list.push({ id: 'powershell', name: 'Windows PowerShell', cmd: 'powershell.exe', kind: 'pwsh' });
    list.push({ id: 'cmd', name: 'Wiersz poleceń', cmd: process.env.ComSpec || 'cmd.exe', kind: 'cmd' });
    const gb = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(exists);
    if (gb) list.push({ id: 'gitbash', name: 'Git Bash', cmd: gb, kind: 'bash' });
    if (which('wsl')) list.push({ id: 'wsl', name: 'WSL', cmd: 'wsl.exe', kind: 'other' });
  } else {
    let shells = [];
    try { shells = fs.readFileSync('/etc/shells', 'utf8').split('\n').map(s => s.trim()).filter(s => s.startsWith('/') && exists(s)); } catch {}
    if (process.env.SHELL) shells.unshift(process.env.SHELL);
    const seen = new Set();
    for (const s of shells) {
      const b = path.basename(s);
      if (seen.has(b) || ['sh', 'dash', 'rbash', 'nologin', 'false'].includes(b)) continue;
      seen.add(b);
      list.push({ id: b, name: b, cmd: s, kind: kindOf(s) });
    }
    if (!list.length) list.push({ id: 'sh', name: 'sh', cmd: '/bin/sh', kind: 'other' });
  }
  return list;
}
const PROFILES = detectProfiles();

function launch(profile) {
  const f = n => path.join(SCRIPTS, n);
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SzkloTerminal' };
  switch (profile.kind) {
    case 'bash': return { args: ['--rcfile', IS_WIN ? f('init.bash').replace(/\\/g, '/') : f('init.bash'), '-i'], env };
    case 'zsh': return { args: IS_MAC ? ['-l', '-i'] : ['-i'], env: { ...env, TC_REAL_ZDOTDIR: process.env.ZDOTDIR || os.homedir(), ZDOTDIR: f('zsh') } };
    case 'pwsh': return { args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${f('init.ps1').replace(/'/g, "''")}'`], env };
    case 'cmd': return { args: ['/K', `doskey /macrofile="${f('macros.doskey')}"`], env };
    default: return { args: [], env };
  }
}

// ---------- okno ----------
function win11() { return IS_WIN && parseInt(os.release().split('.')[2] || '0', 10) >= 22621; }

function createWindow() {
  const acrylic = settings.desktopBlur && win11();
  win = new BrowserWindow({
    width: 1040, height: 660, minWidth: 520, minHeight: 320,
    frame: false,
    ...(acrylic ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } : { transparent: true, backgroundColor: '#00000000' }),
    ...(IS_MAC && settings.desktopBlur ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('maximize', () => win.webContents.send('win:state', true));
  win.on('unmaximize', () => win.webContents.send('win:state', false));
  win.on('closed', () => { for (const p of ptys.values()) try { p.kill(); } catch {} ptys.clear(); win = null; });
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => ({
  settings, profiles: PROFILES, platform: process.platform, acrylicCapable: win11() || IS_MAC
}));
ipcMain.handle('settings:set', (e, next) => {
  const cmdsChanged = JSON.stringify(next.commands) !== JSON.stringify(settings.commands);
  settings = { ...settings, ...next, look: { ...settings.look, ...(next.look || {}) } };
  if (cmdsChanged) settings.commands = commands.writeAll(SCRIPTS, settings.commands);
  saveSettings();
  return settings;
});

ipcMain.handle('pty:create', (e, id, profileId, cols, rows) => {
  const profile = PROFILES.find(p => p.id === profileId) || PROFILES.find(p => p.id === settings.defaultProfile) || PROFILES[0];
  const { args, env } = launch(profile);
  let p;
  try {
    p = pty.spawn(profile.cmd, args, { name: 'xterm-256color', cols: Math.max(cols, 2), rows: Math.max(rows, 2), cwd: os.homedir(), env });
  } catch (err) {
    setTimeout(() => win?.webContents.send('pty:data', { id, data: `\r\n\x1b[31mNie udało się uruchomić ${profile.cmd}: ${err.message}\x1b[0m\r\n` }), 50);
    return { ok: false, profile };
  }
  ptys.set(id, p);
  p.onData(data => win?.webContents.send('pty:data', { id, data }));
  p.onExit(({ exitCode }) => { ptys.delete(id); win?.webContents.send('pty:exit', { id, exitCode }); });
  return { ok: true, profile };
});
ipcMain.on('pty:write', (e, id, d) => ptys.get(id)?.write(d));
ipcMain.on('pty:resize', (e, id, c, r) => { try { ptys.get(id)?.resize(Math.max(c, 2), Math.max(r, 2)); } catch {} });
ipcMain.on('pty:kill', (e, id) => { try { ptys.get(id)?.kill(); } catch {} ptys.delete(id); });

ipcMain.on('win', (e, a) => {
  if (!win) return;
  if (a === 'min') win.minimize();
  else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (a === 'close') win.close();
  else if (a === 'relaunch') { app.relaunch(); app.exit(0); }
});
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (e, t) => clipboard.writeText(String(t)));
ipcMain.on('open', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

app.whenReady().then(() => {
  settings.commands = commands.writeAll(SCRIPTS, settings.commands);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
