'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const pty = require('@lydell/node-pty');
const commands = require('./commands');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// --smoke PLIK: test bez okna na ekranie (używany przez CI), zapisuje wynik do PLIK i kończy.
const SMOKE_OUT = (() => { const i = process.argv.indexOf('--smoke'); return i < 0 ? null : path.resolve(process.argv[i + 1] || 'smoke.json'); })();
app.setPath('userData', SMOKE_OUT ? fs.mkdtempSync(path.join(os.tmpdir(), 'prism-smoke-')) : path.join(app.getPath('appData'), 'Prism'));

const DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const SCRIPTS = path.join(DATA, 'shell');
const INBOX = path.join(DATA, 'inbox');
// Silnik (prism.ps1 + motywy): w zainstalowanej wersji obok Prism.exe, w wersji deweloperskiej w głównym folderze repozytorium.
const ENGINE = app.isPackaged ? path.join(path.dirname(process.execPath), 'engine') : path.resolve(__dirname, '..', '..', '..');
const LOCAL = IS_WIN && !SMOKE_OUT ? path.join(process.env.LOCALAPPDATA || DATA, 'Prism') : path.join(DATA, 'local');
const USER_THEMES = path.join(LOCAL, 'themes');

const DEFAULTS = {
  look: {
    preset: 'grafit', opacity: 78, bg: '#101216', fg: '#e7e5df', accent: '#7ee0b5', ansi: 'dark',
    font: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
    size: 15, lineHeight: 1.2, cursor: 'block', blink: true, padding: 14, radius: 12
  },
  desktopBlur: true,
  defaultProfile: null,
  onboarding: { welcomed: false, done: [], hidden: false },
  commands: [
    { name: 'hej', type: 'text', body: 'Cześć {1}! Jest {time}, miłego dnia.', desc: 'przywitanie' },
    { name: 'gs', type: 'run', body: 'git status', desc: 'skrót do git status' }
  ]
};

let win = null;
const ptys = new Map();

// ---------- ustawienia ----------
function normalize(s) {
  s = s && typeof s === 'object' ? s : {};
  const toArr = v => Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
  const ob = { ...DEFAULTS.onboarding, ...(s.onboarding || {}) };
  ob.done = toArr(ob.done).filter(x => typeof x === 'string');
  return {
    ...DEFAULTS, ...s,
    look: { ...DEFAULTS.look, ...(s.look || {}) },
    onboarding: ob,
    commands: 'commands' in s ? toArr(s.commands) : DEFAULTS.commands
  };
}
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
let settings = normalize(readJson(SETTINGS_FILE));
let lastWritten = '';
function saveSettings() {
  fs.mkdirSync(DATA, { recursive: true });
  lastWritten = JSON.stringify(settings, null, 2);
  fs.writeFileSync(SETTINGS_FILE, lastWritten);
}
// prism apply (PowerShell) też zapisuje ten plik: wtedy wczytujemy go i odświeżamy okno.
function watchSettings() {
  fs.watchFile(SETTINGS_FILE, { interval: 700 }, () => {
    let raw; try { raw = fs.readFileSync(SETTINGS_FILE, 'utf8'); } catch { return; }
    if (raw === lastWritten) return;
    let parsed; try { parsed = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { return; }
    lastWritten = raw;
    const before = JSON.stringify(settings.commands);
    settings = normalize(parsed);
    if (JSON.stringify(settings.commands) !== before) settings.commands = commands.writeAll(SCRIPTS, settings.commands);
    win?.webContents.send('settings:changed', settings);
  });
}

// ---------- wiadomości z powłoki (komendy settings, krycie, dodaj-komende…) ----------
const smokeMsgs = [];
function onShellMessage(msg) {
  if (SMOKE_OUT) smokeMsgs.push(msg);
  else win?.webContents.send('shell:msg', msg);
}
function drainInbox() {
  let files; try { files = fs.readdirSync(INBOX).filter(f => f.endsWith('.msg')).sort(); } catch { return; }
  for (const f of files) {
    const p = path.join(INBOX, f);
    let s; try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (!s.endsWith('\n')) continue; // plik jeszcze się zapisuje
    try { fs.unlinkSync(p); } catch {}
    s = s.replace(/^\uFEFF/, '').trim();
    if (s) onShellMessage(s);
  }
}
function watchInbox() {
  fs.mkdirSync(INBOX, { recursive: true });
  try { fs.watch(INBOX, () => drainInbox()); } catch {}
  setInterval(drainInbox, 600);
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
  const slash = p => IS_WIN ? p.replace(/\\/g, '/') : p;
  const env = {
    ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Prism',
    PRISM_INBOX: profile.kind === 'bash' ? slash(INBOX) : INBOX
  };
  switch (profile.kind) {
    case 'bash': return { args: ['--rcfile', slash(f('init.bash')), '-i'], env };
    case 'zsh': return { args: IS_MAC ? ['-l', '-i'] : ['-i'], env: { ...env, TC_REAL_ZDOTDIR: process.env.ZDOTDIR || os.homedir(), ZDOTDIR: f('zsh') } };
    case 'pwsh': return { args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${f('init.ps1').replace(/'/g, "''")}'`], env };
    // cmd: node-pty przekazuje napis jako gotową linię poleceń (tablica zepsułaby cudzysłowy wokół ścieżki)
    // chcp 65001: makra i polskie znaki w UTF-8
    case 'cmd': return { args: `/K chcp 65001 >nul & doskey /macrofile="${f('macros.doskey')}"`, env };
    default: return { args: [], env };
  }
}
function spawnShell(profile, cols, rows) {
  const { args, env } = launch(profile);
  return pty.spawn(profile.cmd, args, { name: 'xterm-256color', cols: Math.max(cols, 2), rows: Math.max(rows, 2), cwd: os.homedir(), env });
}

// ---------- motywy ----------
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
  if (!THEME_ID.test(t.id || '')) return 'Nazwa pliku motywu: małe litery, cyfry i myślniki.';
  if (!t.name || typeof t.name !== 'string') return 'Motyw musi mieć nazwę.';
  const c = t.colors || {};
  if (!['dark', 'light'].includes(c.mode)) return 'Wybierz tryb: ciemny albo jasny.';
  for (const [k, v] of Object.entries(c)) if (k !== 'mode' && !HEX.test(v)) return `Kolor ${k} musi mieć postać #RRGGBB.`;
  for (const k of ['background', 'text', 'accent']) if (!c[k]) return `Brakuje koloru ${k}.`;
  const resolvable = v => HEX.test(v) || HEX.test(c[v] || '');
  for (const v of (t.wallpaper?.colors || [])) if (!resolvable(v)) return `Nieznany kolor tapety: ${v}`;
  for (const k of ['focused', 'inactive']) { const v = t.windows?.border?.[k]; if (v && !resolvable(v)) return `Nieznany kolor ramki: ${v}`; }
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
    if (!exists(src)) return { ok: false, error: 'Nie mogę znaleźć obrazu tapety.' };
    const name = `${t.id}-tapeta${path.extname(src).toLowerCase() || '.png'}`;
    const dest = path.join(USER_THEMES, name);
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    wp.path = name;
  }
  const p = path.join(USER_THEMES, t.id + '.json');
  fs.writeFileSync(p, JSON.stringify(t, null, 2));
  return { ok: true, path: p, theme: t };
}

// ---------- prism.ps1 (zmiany w Windows) ----------
let running = null;
function runPrism(cmd, arg) {
  return new Promise(resolve => {
    if (!IS_WIN) return resolve({ code: -1, error: 'Zmiany systemu działają tylko w Windows 11.' });
    if (running) return resolve({ code: -1, error: 'Prism już coś zmienia, poczekaj chwilę.' });
    if (!['apply', 'restore'].includes(cmd)) return resolve({ code: -1, error: 'Nieznana komenda.' });
    const script = path.join(ENGINE, 'installer', 'prism.ps1');
    if (!exists(script)) return resolve({ code: -1, error: `Brak silnika Prism: ${script}` });
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, cmd];
    if (arg) args.push(arg);
    running = spawn('powershell.exe', args, { windowsHide: true });
    const send = d => win?.webContents.send('prism:log', d.toString('utf8'));
    running.stdout.on('data', send);
    running.stderr.on('data', send);
    running.on('error', e => { running = null; resolve({ code: -1, error: e.message }); });
    running.on('close', code => { running = null; resolve({ code }); });
  });
}
function prismState() {
  return {
    current: readJson(path.join(LOCAL, 'current.json')),
    hasBackup: exists(path.join(LOCAL, 'backup.json')),
    isWin: IS_WIN,
    win11: win11(),
    version: app.getVersion(),
    engine: ENGINE
  };
}

// ---------- okno ----------
function win11() { return IS_WIN && parseInt(os.release().split('.')[2] || '0', 10) >= 22000; }
function acrylicOk() { return IS_WIN && parseInt(os.release().split('.')[2] || '0', 10) >= 22621; }

function createWindow({ show = true } = {}) {
  const acrylic = settings.desktopBlur && acrylicOk();
  win = new BrowserWindow({
    width: 1180, height: 720, minWidth: 560, minHeight: 360, show,
    title: 'Prism',
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
  return win;
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => ({
  settings, profiles: PROFILES, platform: process.platform, acrylicCapable: acrylicOk() || IS_MAC,
  startup: { openSettings: process.argv.includes('--settings') }
}));
ipcMain.handle('settings:set', (e, next) => {
  const cmdsChanged = 'commands' in next && JSON.stringify(next.commands) !== JSON.stringify(settings.commands);
  settings = normalize({ ...settings, ...next, look: { ...settings.look, ...(next.look || {}) } });
  if (cmdsChanged) settings.commands = commands.writeAll(SCRIPTS, settings.commands);
  saveSettings();
  return settings;
});

ipcMain.handle('pty:create', (e, id, profileId, cols, rows) => {
  const profile = PROFILES.find(p => p.id === profileId) || PROFILES.find(p => p.id === settings.defaultProfile) || PROFILES[0];
  let p;
  try { p = spawnShell(profile, cols, rows); } catch (err) {
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

ipcMain.handle('themes:list', () => listThemes());
ipcMain.handle('themes:save', (e, t) => { try { return saveTheme(t); } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('themes:delete', (e, id) => {
  const item = listThemes().find(t => t.id === id);
  if (!item || item.builtIn) return { ok: false, error: 'Można usuwać tylko własne motywy.' };
  fs.unlinkSync(item.path);
  return { ok: true };
});
ipcMain.handle('prism:state', () => prismState());
ipcMain.handle('prism:run', (e, cmd, arg) => runPrism(cmd, arg));

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

// ---------- test dymny (CI) ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
function runPty(profile, lines) {
  return new Promise(resolve => {
    let out = '', done = false;
    const p = spawnShell(profile, 120, 40);
    const finish = () => { if (done) return; done = true; try { p.kill(); } catch {} resolve(out); };
    p.onData(d => { out += d; });
    p.onExit(finish);
    (async () => {
      await wait(profile.kind === 'pwsh' ? 6000 : 2500);
      for (const l of lines) { p.write(l + '\r'); await wait(2500); }
      setTimeout(finish, 4000);
    })();
    setTimeout(finish, 90000);
  });
}
async function runSmoke() {
  const checks = [];
  const check = (name, ok, info) => { checks.push({ name, ok: !!ok, info }); console.log(`${ok ? 'OK  ' : 'BŁĄD'} ${name}`); };
  try {
    settings.commands = commands.writeAll(SCRIPTS, settings.commands);
    // 1. Okno: renderer, karta z powłoką, ustawienia z motywami
    const errors = [];
    const w = createWindow({ show: false });
    w.webContents.on('console-message', (e, level, message) => {
      const lv = e && e.level !== undefined ? e.level : level, msg = e && e.message !== undefined ? e.message : message;
      if (lv === 'error' || lv === 3) errors.push(msg);
    });
    w.webContents.on('preload-error', (e, p, err) => errors.push('preload: ' + err.message));
    await new Promise(r => w.webContents.once('did-finish-load', r));
    await wait(8000);
    const ui = await w.webContents.executeJavaScript(`(async () => {
      const r = { terminal: typeof Terminal, tabs: document.querySelectorAll('.tab').length };
      r.screen = (window.Prism.active && window.Prism.active.term.buffer.active.length) || 0;
      await window.Prism.openSettings('theme');
      await new Promise(s => setTimeout(s, 500));
      r.cards = document.querySelectorAll('.tcard[data-theme]').length;
      r.preview = !!document.querySelector('#sPreview .desk');
      for (const s of ['colors','wallpaper','windows','taskbar','terminal','commands','about']) { window.Prism.goSection(s); }
      r.sections = document.querySelector('#sContent').children.length;
      r.tour = !document.querySelector('#tour').hidden || !document.querySelector('#settings').hidden;
      return r;
    })()`);
    check('okno: xterm załadowany', ui.terminal === 'function', ui);
    check('okno: pierwsza karta z powłoką', ui.tabs >= 1 && ui.screen > 0, ui);
    check('ustawienia: lista motywów', ui.cards >= 2, ui);
    check('ustawienia: podgląd pulpitu', ui.preview, ui);
    check('ustawienia: wszystkie sekcje się renderują', ui.sections > 0, ui);
    check('okno: brak błędów w konsoli', errors.length === 0, errors);

    // 2. Powłoki: własne komendy, lista komend, wiadomości do aplikacji
    const testable = PROFILES.filter(p => ['pwsh', 'cmd', 'bash'].includes(p.kind));
    for (const prof of testable) {
      await wait(1500); drainInbox(); smokeMsgs.length = 0;
      const lines = prof.kind === 'cmd' ? ['komendy', 'hej Ola', 'settings terminal', 'exit'] : ['komendy', 'hej Ola', 'settings terminal', 'dodaj-komende testowa "dziala"', 'exit'];
      const out = await runPty(prof, lines);
      await wait(1500); drainInbox();
      const plain = out.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
      check(`${prof.name}: lista komend`, plain.includes('Twoje komendy'), plain.slice(-1500));
      check(`${prof.name}: własna komenda hej`, plain.includes('Cześć Ola!'), plain.slice(-1500));
      check(`${prof.name}: settings otwiera ustawienia`, smokeMsgs.includes('panel;terminal'), smokeMsgs);
      if (prof.kind !== 'cmd') check(`${prof.name}: dodaj-komende`, smokeMsgs.some(m => m.startsWith('add;')), smokeMsgs);
    }
    // 3. Motywy z silnika są poprawne
    const themes = listThemes();
    check('motywy: wczytane z silnika', themes.length >= 2, themes.map(t => t.id));
    for (const t of themes) check(`motyw ${t.id}: poprawny`, !validateTheme(t.theme), validateTheme(t.theme));
  } catch (err) {
    check('wyjątek', false, String(err && err.stack || err));
  }
  const ok = checks.every(c => c.ok);
  fs.writeFileSync(SMOKE_OUT, JSON.stringify({ ok, checks }, null, 2));
  app.exit(ok ? 0 : 1);
}

// ---------- start ----------
if (!SMOKE_OUT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.webContents.send('app:command', argv.includes('--settings') ? 'settings' : 'new-tab');
  });
  app.whenReady().then(() => {
    settings.commands = commands.writeAll(SCRIPTS, settings.commands);
    watchInbox();
    if (SMOKE_OUT) return runSmoke();
    watchSettings();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!IS_MAC && !SMOKE_OUT) app.quit(); });
}
