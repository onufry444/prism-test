'use strict';
// Preload for terminal windows.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const on = ch => f => ipcRenderer.on(ch, (e, m) => f(m));
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  init: () => ipcRenderer.invoke('app:init'),
  setConfig: patch => ipcRenderer.invoke('config:set', patch),
  onConfig: on('config:changed'),
  create: (id, profileId, cols, rows, cwd) => ipcRenderer.invoke('pty:create', id, profileId, cols, rows, cwd),
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
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    save: t => ipcRenderer.invoke('themes:save', t),
    remove: id => ipcRenderer.invoke('themes:delete', id)
  },
  prismState: () => ipcRenderer.invoke('prism:state'),
  prismRun: (cmd, arg) => ipcRenderer.invoke('prism:run', cmd, arg),
  onPrismLog: on('prism:log'),
  pickApp: () => ipcRenderer.invoke('app:pick-app'),
  pickImage: () => ipcRenderer.invoke('app:pick-image'),
  runningApps: () => ipcRenderer.invoke('app:running-apps'),
  dockDefaults: () => ipcRenderer.invoke('app:dock-defaults'),
  openFile: which => ipcRenderer.send('app:open-file', which),
  menu: () => ipcRenderer.send('app:menu'),
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  win: a => ipcRenderer.send('win', a),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: t => ipcRenderer.send('clip:write', t),
  openExternal: u => ipcRenderer.send('open', u)
});
