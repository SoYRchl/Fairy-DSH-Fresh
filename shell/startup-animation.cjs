'use strict';
// Startup animation gate (phase 2-C parity with the reference shell).
//
// The reference plays a bundled startup VIDEO (media/startup-default.mp4)
// while the backend boots, with these safety properties (all kept):
//   - a stalled or crashed splash renderer must never block entry;
//   - closing / skipping the splash means "skip", not "quit the app";
//   - the main window inherits the splash bounds, so there is no visual jump;
//   - "waitForEnd" (off by default) is the only setting that holds entry.
// Video IMPORT (custom mp4 via ffmpeg) stays phase-3 work: the settings
// fields already exist so the renderer contract will not change.
//
// This module OWNS its IPC ('startup:data' / 'startup:playback-finished' /
// 'startup:dismiss'); main.js must not register the same channels.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ENTRY_TIMEOUT_MS = 270000; // 60s video at 0.25x = 240s, plus margin

function createStartupAnimation({ app, BrowserWindow, ipcMain, getMainWindow }) {
  const configFile = path.join(app.getPath('userData'), 'startup-animation.json');
  const defaults = { enabled: true, speed: 1, muted: true, waitForEnd: false };
  const settings = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
        speed: typeof raw.speed === 'number' && raw.speed >= 0.25 && raw.speed <= 3
          ? raw.speed : defaults.speed,
        muted: typeof raw.muted === 'boolean' ? raw.muted : defaults.muted,
        waitForEnd: typeof raw.waitForEnd === 'boolean' ? raw.waitForEnd : defaults.waitForEnd,
      };
    } catch {
      return { ...defaults };
    }
  })();

  const mediaDir = path.join(__dirname, 'media');
  const defaultVideo = path.join(mediaDir, 'startup-default.mp4');
  const data = () => ({
    ...settings,
    custom: false,
    url: pathToFileURL(defaultVideo).href,
  });

  let splash = null;
  let disposed = false;
  let pendingMain = null;
  let entered = false;
  let released = false;
  let playbackDone = false;
  let entryTimer = null;

  function clearTimer() {
    if (entryTimer) clearTimeout(entryTimer);
    entryTimer = null;
  }

  function getBounds() {
    return splash && !splash.isDestroyed() ? splash.getBounds() : null;
  }

  function destroySplash() {
    clearTimer();
    const w = splash;
    splash = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  function tryEnter() {
    if (disposed || entered || !pendingMain || pendingMain.isDestroyed()) return;
    // Only "waitForEnd" holds the main window back until the video finished.
    if (!released && settings.enabled && settings.waitForEnd && !playbackDone
      && splash && !splash.isDestroyed()) return;
    const main = pendingMain;
    pendingMain = null;
    entered = true;
    const bounds = getBounds();
    // A main window that went fullscreen before being shown must keep its
    // fullscreen geometry -- setBounds would silently break it.
    if (bounds && !main.isDestroyed() && !main.isFullScreen()) {
      try { main.setBounds(bounds); } catch {}
    }
    main.show();
    destroySplash();
  }

  function release() {
    released = true;
    clearTimer();
    tryEnter();
  }

  // Called only from the real main window's ready-to-show event.
  function mainReady(main) {
    pendingMain = main;
    tryEnter();
  }

  function open(intended) {
    if (disposed || !settings.enabled) return null;
    if (splash && !splash.isDestroyed()) return splash;
    const w = new BrowserWindow({
      width: (intended && intended.width) || 1320,
      height: (intended && intended.height) || 900,
      x: intended ? intended.x : undefined,
      y: intended ? intended.y : undefined,
      show: false,
      frame: false,
      transparent: true,
      roundedCorners: true,
      hasShadow: true,
      resizable: false,
      backgroundColor: '#05090d',
      title: 'Fairy \u6b63\u5728\u542f\u52a8',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    splash = w;
    released = false;
    entered = false;
    playbackDone = false;
    // A corrupt/stalled splash must never indefinitely block entry.
    entryTimer = setTimeout(release, ENTRY_TIMEOUT_MS);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.once('ready-to-show', () => {
      if (!disposed && !w.isDestroyed() && !released) w.show();
    });
    // Hiding instead of closing keeps window-all-closed from quitting early.
    w.on('close', (event) => {
      if (!disposed && splash === w) {
        event.preventDefault();
        w.hide();
        release();
      }
    });
    w.on('closed', () => {
      if (splash === w) {
        splash = null;
        release();
      }
    });
    w.webContents.on('render-process-gone', () => {
      if (splash === w) {
        w.hide();
        release();
      }
    });
    w.webContents.on('did-fail-load', (_event, code, _desc, _url, isMainFrame) => {
      if (splash === w && isMainFrame && code !== -3) release();
    });
    w.loadFile(path.join(__dirname, 'startup.html')).catch(() => {
      if (!w.isDestroyed()) w.hide();
      if (splash === w) release();
    });
    return w;
  }

  function dismiss() {
    released = true;
    clearTimer();
    tryEnter();
  }

  function focus() {
    if (splash && !splash.isDestroyed() && !released) {
      splash.show();
      splash.focus();
      return true;
    }
    return false;
  }

  function dispose() {
    disposed = true;
    clearTimer();
    pendingMain = null;
    if (splash && !splash.isDestroyed()) splash.destroy();
    splash = null;
    disposeIpc();
  }

  const handlers = {
    'startup:data': (event) => {
      // Only the splash (or the main window) may ask for animation data.
      const main = getMainWindow();
      const local = splash && !splash.isDestroyed() && event.sender === splash.webContents;
      if (!local && (!main || main.isDestroyed() || event.sender !== main.webContents)) {
        throw new Error('reject');
      }
      return data();
    },
    'startup:playback-finished': (event, reason) => {
      const main = getMainWindow();
      const local = splash && !splash.isDestroyed() && event.sender === splash.webContents;
      if (!local || !['ended', 'failed'].includes(reason)) throw new Error('reject');
      if (reason === 'ended') playbackDone = true;
      release();
      return true;
    },
    'startup:dismiss': (event) => {
      const main = getMainWindow();
      const local = splash && !splash.isDestroyed() && event.sender === splash.webContents;
      if (!local && (!main || main.isDestroyed() || event.sender !== main.webContents)) {
        throw new Error('reject');
      }
      dismiss();
      return true;
    },
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(name, handler);

  function disposeIpc() {
    for (const name of Object.keys(handlers)) ipcMain.removeHandler(name);
  }

  return { open, mainReady, focus, dismiss, dispose };
}

module.exports = { createStartupAnimation };
