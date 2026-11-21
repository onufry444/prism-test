'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = ch => f => ipcRenderer.on(ch, (e, m) => f(m));

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  onSettingsChanged: on('settings:changed'),
  create: (id, profileId, cols, rows) => ipcRenderer.invoke('pty:create', id, profileId, cols, rows),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  kill: id => ipcRenderer.send('pty:kill', id),
  onData: on('pty:data'),
  onExit: on('pty:exit'),
  onShellMsg: on('shell:msg'),
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
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  win: a => ipcRenderer.send('win', a),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: t => ipcRenderer.send('clip:write', t),
  openExternal: u => ipcRenderer.send('open', u)
});
