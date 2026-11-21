'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  create: (id, profileId, cols, rows) => ipcRenderer.invoke('pty:create', id, profileId, cols, rows),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  kill: id => ipcRenderer.send('pty:kill', id),
  onData: f => ipcRenderer.on('pty:data', (e, m) => f(m)),
  onExit: f => ipcRenderer.on('pty:exit', (e, m) => f(m)),
  onWinState: f => ipcRenderer.on('win:state', (e, m) => f(m)),
  win: a => ipcRenderer.send('win', a),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: t => ipcRenderer.send('clip:write', t),
  openExternal: u => ipcRenderer.send('open', u)
});
