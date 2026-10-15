// Preload for the Fairy-DSH-Fresh shell. Context isolation is on (and the
// renderer is sandboxed), so the page only gets these narrow bridges -- no
// Node access. `fairyShell` serves the main window chrome; `fairyStartup`
// serves the splash renderer.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairyShell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
  isMaximized: () => ipcRenderer.invoke('shell:is-maximized'),
});

contextBridge.exposeInMainWorld('fairyStartup', {
  get: () => ipcRenderer.invoke('startup:data'),
  finished: (reason) => ipcRenderer.invoke('startup:playback-finished', reason),
  dismiss: () => ipcRenderer.invoke('startup:dismiss'),
});
