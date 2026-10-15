'use strict';
// Startup animation gate (phase 2-C scope: CSS-only splash).
//
// The reference shell shipped a video pipeline (custom mp4 import via a
// bundled ffmpeg). Per the plan that is phase-3 work; this module keeps the
// GATE (splash -> main handoff) and the same safety properties:
//   - a stalled or crashed splash renderer must never block entry;
//   - closing the splash means "skip", not "quit the app";
//   - the main window inherits the splash bounds, so there is no visual jump.
// The module surface (open/mainReady/focus/dismiss/dispose) was shaped so a
// video source can be added later without touching main.js again.
const fs = require('node:fs');
const path = require('node:path');

const ENTRY_TIMEOUT_MS = 120000; // backend wait is 90s; 120 covers the rest

function createStartupAnimation({ app, BrowserWindow, getMainWindow }) {
  const configFile = path.join(app.getPath('userData'), 'startup-animation.json');
  const defaults = { enabled: true };
  const settings = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled };
    } catch {
      return { ...defaults };
    }
  })();

  let splash = null;
  let disposed = false;
  let pendingMain = null;
  let entered = false;
  let released = false;
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
    if (!released && settings.enabled && splash && !splash.isDestroyed()) return;
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
  }

  return { open, mainReady, focus, dismiss, dispose };
}

module.exports = { createStartupAnimation };
