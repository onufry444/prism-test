'use strict';
// Preload of the hidden window that listens to what the PC is playing (for the visualizer).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('audio', {
  bands: b => ipcRenderer.send('audio:bands', b),
  error: m => ipcRenderer.send('audio:error', m)
});
