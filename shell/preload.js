// Preload for the Fairy-DSH-Fresh shell. Context isolation is on (and the
// renderer is sandboxed), so the page only gets this narrow bridge -- no Node.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairyShell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
  isMaximized: () => ipcRenderer.invoke('shell:is-maximized'),
  // Splash only: skip the startup animation and reveal the main window.
  dismissStartup: () => ipcRenderer.send('startup:dismiss'),
});
