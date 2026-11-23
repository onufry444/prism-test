'use strict';
// Preload for terminal windows.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const on = ch => f => ipcRenderer.on(ch, (e, m) => f(m));
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  init: () => ipcRenderer.invoke('app:init'),
  setConfig: patch => ipcRenderer.invoke('config:set', patch),
  onConfig: on('config:changed'),
  create: (id, profileId, cols, rows, cwd, run, cwdFrom) => ipcRenderer.invoke('pty:create', id, profileId, cols, rows, cwd, run, cwdFrom),
  // the window's tabs, panes and recent output, so they come back after a restart (sync while the window closes)
  saveSession: (s, sync) => (sync ? ipcRenderer.sendSync('session:save', s) : ipcRenderer.send('session:save', s)),
  adopt: (id, cols, rows) => ipcRenderer.invoke('pty:adopt', id, cols, rows),
  onOpenTab: on('tab:open'),
  integration: () => ipcRenderer.invoke('integration:status'),
  update: { state: () => ipcRenderer.invoke('update:state'), check: () => ipcRenderer.invoke('update:check'), install: () => ipcRenderer.invoke('update:install'), on: on('update:state') },
  onIntegration: on('integration:changed'),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  kill: id => ipcRenderer.send('pty:kill', id),
  onData: on('pty:data'),
  onExit: on('pty:exit'),
  onShellMsg: on('shell:msg'),
  onToast: on('toast'),
  onTranslated: on('term:translated'),
  onAppCommand: on('app:command'),
  onWinState: on('win:state'),
  pickImage: () => ipcRenderer.invoke('app:pick-image'),
  onAdmin: on('pty:admin'),
  openFile: which => ipcRenderer.send('app:open-file', which),
  menu: () => ipcRenderer.send('app:menu'),
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  win: a => ipcRenderer.send('win', a),
  resizeStart: () => ipcRenderer.invoke('win:resize-start'),
  resizeTo: (edge, dx, dy) => ipcRenderer.send('win:resize', edge, dx, dy),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: t => ipcRenderer.send('clip:write', t),
  openExternal: u => ipcRenderer.send('open', u)
});
