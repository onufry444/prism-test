'use strict';
// Preload for the dock and menu bar windows.
const { contextBridge, ipcRenderer } = require('electron');
const on = ch => f => ipcRenderer.on(ch, (e, m) => f(m));
contextBridge.exposeInMainWorld('desk', {
  platform: process.platform,
  onConfig: on('desk:config'),
  onItems: on('dock:items'),
  onBounce: on('dock:bounce'),
  activate: key => ipcRenderer.send('dock:activate', key),
  menu: key => ipcRenderer.send('dock:menu', key),
  mouse: inside => ipcRenderer.send('dock:mouse', inside),
  onStats: on('bar:stats'),
  onWorkspaces: on('bar:workspaces'),
  workspace: name => ipcRenderer.send('bar:workspace', name),
  prismMenu: () => ipcRenderer.send('bar:menu'),
  open: what => ipcRenderer.send('bar:open', what)
});
