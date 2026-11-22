'use strict';
// Prism desktop: the dock and the menu bar.
//
// Dock: pinned apps + running windows (grouped by program), click to open/focus/minimize, right-click menu,
//       magnification, optional auto-hide. While it is on, the Windows taskbar is set to auto-hide.
// Menu bar: Prism menu, GlazeWM workspaces, active app, clock, CPU, memory, battery, network.
// Both reserve screen space (the desktop "work area"), so maximized windows don't cover them.
// Everything is restored when turned off or when Prism quits.
const { BrowserWindow, screen, ipcMain, Menu, nativeImage, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const win32 = require('./win32');
const { Glaze } = require('./glaze');

const exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const NAMES = { explorer: 'File Explorer', msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', brave: 'Brave', code: 'VS Code', windowsterminal: 'Terminal', prism: 'Prism',
  notepad: 'Notepad', spotify: 'Spotify', discord: 'Discord', slack: 'Slack', teams: 'Teams', 'ms-teams': 'Teams', outlook: 'Outlook', winword: 'Word', excel: 'Excel',
  powerpnt: 'PowerPoint', steam: 'Steam', obs64: 'OBS', vlc: 'VLC', systemsettings: 'Settings', taskmgr: 'Task Manager', mspaint: 'Paint', notepad__: '' };
const prettyName = exe => { const b = path.basename(exe || '', '.exe'); return NAMES[b.toLowerCase()] || (b ? b.charAt(0).toUpperCase() + b.slice(1) : 'App'); };
const keyOf = exe => (exe || '').toLowerCase();
const isUri = s => /^[a-z][a-z0-9+.-]+:/i.test(s || '');

function defaultPinned() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || '';
  const browser = [
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf, 'Mozilla Firefox\\firefox.exe')
  ].find(exists);
  const windir = process.env.SystemRoot || 'C:\\Windows';
  return [
    { name: 'File Explorer', path: path.join(windir, 'explorer.exe') },
    browser && { name: prettyName(browser), path: browser },
    { name: 'Prism', path: process.execPath, prism: true },
    { name: 'Settings', path: 'ms-settings:', icon: path.join(windir, 'ImmersiveControlPanel\\SystemSettings.exe') }
  ].filter(Boolean);
}

class Desktop {
  constructor({ preload, rendererDir, getConfig, getCss, saveGui, onPrism, onMenu }) {
    Object.assign(this, { preload, rendererDir, getConfig, getCss, saveGui, onPrism, onMenu });
    this.ticks = 0;
    screen.on('display-metrics-changed', (e, d, changed) => { if (!changed || changed.includes('bounds') || changed.includes('scaleFactor')) this.relayoutSoon(); });
    screen.on('display-added', () => this.relayoutSoon());
    screen.on('display-removed', () => this.relayoutSoon());
    this.dock = null; this.bar = null; this.poll = null; this.icons = new Map(); this.items = [];
    this.statePath = path.join(app.getPath('userData'), 'desktop-state.json');
    this.state = this.readState();
    this.glaze = new Glaze();
    this.glaze.on('workspaces', ws => this.send('bar', 'bar:workspaces', ws));
    this.glaze.on('state', on => this.send('bar', 'bar:glaze', on));
    this.cpuPrev = os.cpus();
    this.lastFg = null;
    this.ipc();
  }
  readState() { try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch { return {}; } }
  writeState() { try { fs.writeFileSync(this.statePath, JSON.stringify(this.state)); } catch {} }
  send(which, ch, data) { const w = this[which]; if (w && !w.isDestroyed()) w.webContents.send(ch, data); }
  ownHwnds() { return new Set([this.dock, this.bar].filter(w => w && !w.isDestroyed()).map(win32.hwndOf)); }

  // ---------- apply config ----------
  apply() {
    const cfg = this.getConfig();
    const want = { dock: !!cfg.dock.enabled && win32.available(), bar: !!cfg.bar.enabled && win32.available() };
    if (want.dock && !this.dock) { this.dock = this.makeWindow('dock'); this.dockRegistered = false; }
    if (!want.dock && this.dock) { if (this.dockRegistered) win32.appbarRemove(win32.hwndOf(this.dock)); this.dockRegistered = false; this.dock.destroy(); this.dock = null; }
    if (want.bar && !this.bar) { this.bar = this.makeWindow('bar'); this.barRegistered = false; this.glaze.start(); }
    if (!want.bar && this.bar) { if (this.barRegistered) win32.appbarRemove(win32.hwndOf(this.bar)); this.barRegistered = false; this.bar.destroy(); this.bar = null; this.glaze.stop(); }
    this.taskbar(want.dock && cfg.dock.hideTaskbar);
    this.layout();
    if (this.dock || this.bar) { if (!this.poll) this.poll = setInterval(() => this.tick(), 900); this.tick(); }
    else { clearInterval(this.poll); this.poll = null; }
    this.send('dock', 'desk:config', { config: cfg, css: this.getCss() });
    this.send('bar', 'desk:config', { config: cfg, css: this.getCss() });
    return want;
  }
  makeWindow(kind) {
    const w = new BrowserWindow({
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: kind === 'bar', title: kind === 'dock' ? 'Prism Dock' : 'Prism Menu Bar',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(this.rendererDir, `${kind}.html`));
    w.webContents.on('did-finish-load', () => { this.send(kind, 'desk:config', { config: this.getConfig(), css: this.getCss() }); if (kind === 'dock') this.pushItems(true); else this.pushBar(); });
    w.once('ready-to-show', () => { w.showInactive(); if (kind === 'bar' && this.getConfig().terminal.blur) win32.blurBehind(win32.hwndOf(w), 'acrylic', 0x01000000); });
    if (kind === 'dock') w.setIgnoreMouseEvents(true, { forward: true });
    // Windows tells app bars when the screen layout changes (ABN_POSCHANGED = 1)
    try { w.hookWindowMessage(0x0401, wParam => { if (wParam.readUInt32LE(0) === 1) this.relayoutSoon(); }); } catch {}
    w.on('closed', () => { if (this[kind] === w) this[kind] = null; });
    return w;
  }
  // force: re-register app bars even if nothing changed (Windows asked us to)
  layout(force = false) {
    const cfg = this.getConfig(), d = screen.getPrimaryDisplay(), b = d.bounds, sf = d.scaleFactor;
    const same = (k, r) => { const j = JSON.stringify(r); if (!force && this[k] === j) return true; this[k] = j; return false; };
    const px = r => ({ left: Math.round(r.x * sf), top: Math.round(r.y * sf), right: Math.round((r.x + r.width) * sf), bottom: Math.round((r.y + r.height) * sf) });
    const dip = r => ({ x: Math.round(r.left / sf), y: Math.round(r.top / sf), width: Math.round((r.right - r.left) / sf), height: Math.round((r.bottom - r.top) / sf) });
    this.restoreWorkArea(); // from versions that set the work area directly
    if (this.bar) {
      const h = Math.round(cfg.bar.height), want = { x: b.x, y: b.y, width: b.width, height: h };
      const hwnd = win32.hwndOf(this.bar);
      if (cfg.bar.reserveSpace) {
        if (!same('barRect', [want, this.barRegistered])) {
          const got = win32.appbar(hwnd, 'top', px(want), !this.barRegistered);
          this.barRegistered = true;
          this.bar.setBounds(got ? dip(got) : want);
        }
      } else {
        if (this.barRegistered) { win32.appbarRemove(hwnd); this.barRegistered = false; }
        this.bar.setBounds(want);
      }
    }
    if (this.dock) {
      // the window is taller than the dock so magnified icons fit; only the dock itself is reserved
      const dockH = Math.round(cfg.dock.iconSize * Math.max(1, cfg.dock.magnification) + 46);
      const reserve = Math.round(cfg.dock.iconSize + 22);
      this.dock.setBounds({ x: b.x, y: b.y + b.height - dockH, width: b.width, height: dockH });
      const hwnd = win32.hwndOf(this.dock);
      if (cfg.dock.reserveSpace && !cfg.dock.autohide) {
        const r = { x: b.x, y: b.y + b.height - reserve, width: b.width, height: reserve };
        if (!same('dockRect', [r, this.dockRegistered])) { win32.appbar(hwnd, 'bottom', px(r), !this.dockRegistered); this.dockRegistered = true; }
      } else if (this.dockRegistered) { win32.appbarRemove(hwnd); this.dockRegistered = false; }
    }
  }
  // at most one forced re-layout per second, so two app bars can't keep notifying each other
  relayoutSoon() {
    clearTimeout(this.relayT);
    const wait = Math.max(250, 1000 - (Date.now() - (this.lastForced || 0)));
    this.relayT = setTimeout(() => { this.lastForced = Date.now(); this.layout(true); }, wait);
  }
  restoreWorkArea() {
    if (!this.state.workArea) return;
    win32.setWorkArea(this.state.workArea);
    delete this.state.workArea; this.writeState();
  }
  taskbar(hide) {
    if (hide) {
      if (this.state.taskbarWasAutohide === undefined) { const prev = win32.taskbarAutohide(); if (prev !== null) { this.state.taskbarWasAutohide = prev; this.writeState(); } }
      win32.taskbarAutohide(true);
    } else if (this.state.taskbarWasAutohide !== undefined) {
      win32.taskbarAutohide(this.state.taskbarWasAutohide);
      delete this.state.taskbarWasAutohide; this.writeState();
    }
  }
  // Called on quit, and on start-up after a crash: puts the taskbar and work area back.
  restore() {
    clearInterval(this.poll); this.poll = null;
    this.glaze.stop();
    for (const k of ['dock', 'bar']) {
      if (this[k] && !this[k].isDestroyed()) { if (this[k + 'Registered']) win32.appbarRemove(win32.hwndOf(this[k])); this[k].destroy(); }
      this[k] = null; this[k + 'Registered'] = false;
    }
    this.taskbar(false);
    this.restoreWorkArea();
  }

  // ---------- polling ----------
  tick() {
    if (++this.ticks % 10 === 0) this.layout();
    if (this.dock) this.pushItems(false);
    if (this.bar) this.pushBar();
    // hide over full-screen apps (videos, games)
    const d = screen.getPrimaryDisplay(), sf = d.scaleFactor, b = d.bounds;
    // Prism's own windows only count when they really are full screen (F11)
    const mine = new Set(BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !w.isFullScreen()).map(win32.hwndOf));
    this.fullscreen = win32.fullscreenApp(mine, { left: Math.round(b.x * sf), top: Math.round(b.y * sf), right: Math.round((b.x + b.width) * sf), bottom: Math.round((b.y + b.height) * sf) });
    const full = !!this.fullscreen;
    for (const w of [this.dock, this.bar]) if (w && !w.isDestroyed()) { if (full && w.isVisible()) w.hide(); else if (!full && !w.isVisible()) w.showInactive(); }
  }
  windows() { return win32.listWindows(this.ownHwnds()); }
  async icon(item) {
    const src = item.icon || item.path;
    if (!src || isUri(src)) return null;
    if (this.icons.has(src)) return this.icons.get(src);
    let url = null;
    try { const img = await nativeImage.createThumbnailFromPath(src, { width: 128, height: 128 }); if (!img.isEmpty()) url = img.toDataURL(); } catch {}
    if (!url) { try { const img = await app.getFileIcon(src, { size: 'large' }); if (!img.isEmpty()) url = img.toDataURL(); } catch {} }
    this.icons.set(src, url);
    return url;
  }
  async pushItems(force) {
    const cfg = this.getConfig();
    const pinned = Array.isArray(cfg.dock.pinned) ? cfg.dock.pinned : defaultPinned();
    const wins = this.windows();
    const groups = new Map();
    for (const w of wins) { const k = keyOf(w.exe); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
    const items = [];
    for (const p of pinned) {
      const k = p.prism ? keyOf(process.execPath) : keyOf(p.path);
      const ws = groups.get(k) || []; groups.delete(k);
      items.push({ key: k || p.path, name: p.name || prettyName(p.path), path: p.path, icon: p.icon, prism: !!p.prism, pinned: true, windows: ws });
    }
    if (cfg.dock.showRunning) for (const [k, ws] of groups) items.push({ key: k, name: /applicationframehost/.test(k) ? ws[0].title : prettyName(ws[0].exe), path: ws[0].exe, pinned: false, windows: ws, prism: k === keyOf(process.execPath) });
    for (const it of items) { it.running = it.windows.length > 0; it.focused = it.windows.some(w => w.focused); it.iconUrl = await this.icon(it); }
    const sig = JSON.stringify(items.map(i => [i.key, i.running, i.focused, i.windows.length, !!i.iconUrl]));
    this.items = items;
    if (force || sig !== this.lastSig) { this.lastSig = sig; this.send('dock', 'dock:items', items.map(({ windows, ...i }) => ({ ...i, count: windows.length }))); }
  }
  pushBar() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    cpus.forEach((c, i) => { const p = this.cpuPrev[i]?.times || c.times; for (const k in c.times) total += c.times[k] - p[k]; idle += c.times.idle - p.idle; });
    this.cpuPrev = cpus;
    const fg = win32.foreground();
    let appName = this.lastFg;
    if (fg && !this.ownHwnds().has(fg)) {
      const w = this.windows().find(x => x.hwnd === fg);
      if (w) appName = { name: /applicationframehost/i.test(w.exe) ? w.title : prettyName(w.exe), title: w.title };
    }
    this.lastFg = appName;
    this.send('bar', 'bar:stats', { cpu: total ? Math.round(100 * (1 - idle / total)) : 0, mem: Math.round(100 * (1 - os.freemem() / os.totalmem())), memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(), app: appName, glaze: this.glaze.connected, workspaces: this.glaze.workspaces });
  }

  // ---------- actions ----------
  launch(it) {
    if (it.prism) return this.onPrism('open');
    if (isUri(it.path)) return shell.openExternal(it.path);
    try { spawn(it.path, it.args || [], { detached: true, stdio: 'ignore', cwd: os.homedir() }).unref(); } catch { shell.openPath(it.path); }
  }
  activate(key) {
    const it = this.items.find(i => i.key === key); if (!it) return;
    if (it.prism && !it.windows.length) return this.onPrism('open');
    if (!it.windows.length) { this.send('dock', 'dock:bounce', key); return this.launch(it); }
    const focusedIdx = it.windows.findIndex(w => w.focused);
    if (focusedIdx >= 0 && it.windows.length === 1) return win32.minimize(it.windows[0].hwnd);
    const next = it.windows[(focusedIdx + 1) % it.windows.length];
    win32.focus(next.hwnd);
    setTimeout(() => this.pushItems(false), 150);
  }
  menu(key) {
    const it = this.items.find(i => i.key === key); if (!it) return;
    const cfg = this.getConfig();
    const pinned = Array.isArray(cfg.dock.pinned) ? cfg.dock.pinned : defaultPinned();
    const tpl = [];
    for (const w of it.windows) tpl.push({ label: (w.minimized ? '◦ ' : '') + (w.title.length > 60 ? w.title.slice(0, 57) + '…' : w.title), click: () => win32.focus(w.hwnd) });
    if (it.windows.length) tpl.push({ type: 'separator' });
    tpl.push({ label: it.prism ? 'New Prism window' : 'Open new window', click: () => it.prism ? this.onPrism('new') : this.launch(it) });
    if (it.pinned) tpl.push({ label: 'Remove from Dock', click: () => this.saveGui({ dock: { pinned: pinned.filter(p => (p.prism ? keyOf(process.execPath) : keyOf(p.path)) !== key) } }) });
    else if (it.path) tpl.push({ label: 'Keep in Dock', click: () => this.saveGui({ dock: { pinned: [...pinned, { name: it.name, path: it.path }] } }) });
    if (it.windows.length) tpl.push({ type: 'separator' }, { label: it.windows.length > 1 ? `Close ${it.windows.length} windows` : 'Close', click: () => it.windows.forEach(w => win32.close(w.hwnd)) });
    tpl.push({ type: 'separator' }, { label: 'Dock settings…', click: () => this.onPrism('settings', 'dock') });
    Menu.buildFromTemplate(tpl).popup({ window: this.dock });
  }
  ipc() {
    ipcMain.on('dock:activate', (e, key) => this.activate(key));
    ipcMain.on('dock:menu', (e, key) => this.menu(key));
    ipcMain.on('dock:mouse', (e, inside) => { if (this.dock) this.dock.setIgnoreMouseEvents(!inside, { forward: true }); });
    ipcMain.on('bar:workspace', (e, name) => this.glaze.focusWorkspace(name));
    ipcMain.on('bar:menu', () => this.onMenu(this.bar));
    ipcMain.on('bar:open', (e, what) => {
      if (what === 'clock') shell.openExternal('ms-actioncenter:');
      else if (what === 'network') shell.openExternal('ms-settings:network');
      else if (what === 'battery') shell.openExternal('ms-settings:batterysaver');
      else if (what === 'cpu' || what === 'memory') spawn('taskmgr.exe', [], { detached: true, stdio: 'ignore' }).unref();
    });
  }
}

module.exports = { Desktop, defaultPinned, prettyName };
