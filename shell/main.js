// ---------------------------------------------------------------------------
// Fairy-DSH-Fresh standalone desktop shell (phase 2-C rewrite).
//
// Written from scratch after auditing the reference shell (755-line main.js of
// an untrusted installer package, used as ARCHITECTURE BLUEPRINT ONLY per
// docs/02 red line "borrow the shell design, never the binaries"). Hard-won
// facts discovered by that audit are kept as comments where they apply.
//
// Packaged layout (produced by tools/pack-shell.mjs):
//   <root>/Fairy-DSH-Fresh.exe          renamed official electron.exe
//   <root>/resources/app/               this directory (loaded as the app)
//   <root>/resources/runtime/node.exe   Node 22 for the backend process
//   <root>/resources/kernel/node_modules/@deepseek-ai/dsh   kernel 0.2.0-rc.2
//   <root>/resources/repo/              Fairy-DSH-Fresh repository snapshot
//   <root>/data/                        writable data (home, logs, state)
//
// Data directory rule: <root>/data when the package root is writable
// (portable zip), otherwise %LOCALAPPDATA%/Fairy-DSH-Fresh (NSIS install
// under Program Files must not write next to the exe).
//
// Lifecycle: recover links/mtimes -> spawn dsh hidden -> wait for the
// authenticated URL -> open a frameless window -> when the window closes,
// stop the backend we started (never an arbitrary port holder).
// ---------------------------------------------------------------------------
'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, dialog } = require('electron');
const { spawn, execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');

const IS_PACKAGED = app.isPackaged;
const PKG_ROOT = IS_PACKAGED
  ? path.dirname(app.getPath('exe'))
  : path.resolve(process.env.FAIRY_PKG_ROOT || path.resolve(__dirname, '..', '..'));

// --- optional overrides (config file first, then environment) ---------------
// data/shell.json: { "port": 3090, "home": "D:/some/home", "cornerRadius": 18,
//                    "cornerShape": "circle" }
// Environment: FAIRY_PORT, FAIRY_HOME, FAIRY_REPO_ROOT, FAIRY_NODE,
//              FAIRY_KERNEL_MODULES, FAIRY_DATA_DIR, FAIRY_SHELL_DIAG,
//              FAIRY_SHELL_RUN_INDEX
function argOrEnv(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : process.env[name.toUpperCase()] || null;
}

const RESOURCES = IS_PACKAGED ? process.resourcesPath : path.resolve(__dirname, '..');
const REPO = path.resolve(argOrEnv('fairy-repo-root')
  || (IS_PACKAGED ? path.join(RESOURCES, 'repo') : path.resolve(__dirname, '..')));
// Packaged: the bundled Node 22. Dev (unpackaged): a FAIRY_NODE override, or
// whatever `node` resolves to on PATH. Never process.execPath here -- when
// unpackaged that is electron.exe, not a standalone Node.
const nodeArg = argOrEnv('fairy-node');
const NODE_EXE = nodeArg
  ? path.resolve(nodeArg)
  : (IS_PACKAGED ? path.join(RESOURCES, 'runtime', 'node.exe') : 'node');
const KERNEL_MODULES = path.resolve(argOrEnv('fairy-kernel-modules')
  || (IS_PACKAGED ? path.join(RESOURCES, 'kernel', 'node_modules') : path.join(REPO, '..', 'kernel', 'node_modules')));
const DSH_BIN = path.join(KERNEL_MODULES, '@deepseek-ai', 'dsh', 'lib', 'bin.js');

// --- data directory (portable vs installed) ---------------------------------
function dirIsWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

const DATA_DIR = path.resolve(argOrEnv('fairy-data-dir')
  || (dirIsWritable(path.join(PKG_ROOT, 'data'))
    ? path.join(PKG_ROOT, 'data')
    : path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Fairy-DSH-Fresh')));
const USER_DATA = path.join(DATA_DIR, 'userData');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
app.setPath('userData', USER_DATA);
app.setPath('temp', TMP_DIR);
process.env.TEMP = TMP_DIR;
process.env.TMP = TMP_DIR;

const SHELL_LOG = path.join(DATA_DIR, 'shell.log');
function shellLog(line) {
  try {
    fs.appendFileSync(SHELL_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

// --- configuration -----------------------------------------------------------
const CONFIG = (() => {
  const defaults = {
    port: Number(argOrEnv('fairy-port')) || 3090,
    home: argOrEnv('fairy-home') || path.join(DATA_DIR, 'home'),
    cornerRadius: 18,
    cornerShape: 'circle',
  };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shell.json'), 'utf8'));
    if (Number.isFinite(Number(raw.port)) && Number(raw.port) > 0) defaults.port = Number(raw.port);
    if (typeof raw.home === 'string' && raw.home.trim()) defaults.home = path.resolve(raw.home.trim());
    if (Number.isFinite(Number(raw.cornerRadius)) && Number(raw.cornerRadius) > 0) {
      defaults.cornerRadius = Number(raw.cornerRadius);
    }
    if (raw.cornerShape === 'continuous') defaults.cornerShape = 'continuous';
  } catch {}
  return defaults;
})();
const HOME = path.resolve(CONFIG.home);
const PORT = CONFIG.port;
const LOG_FILE = path.join(HOME, 'launch.log');
const URL_FILE = path.join(HOME, 'launch.url');
const BACKEND_FILE = path.join(DATA_DIR, 'backend.json');

// --- diagnostics harness hook (phase 2-C acceptance, see shell/verify/) ------
const DIAG_DIR = process.env.FAIRY_SHELL_DIAG || null;
const RUN_INDEX = process.env.FAIRY_SHELL_RUN_INDEX || '0';
const diag = DIAG_DIR
  ? {
      dir: DIAG_DIR,
      record: {
        index: Number(RUN_INDEX) || 0,
        startedAt: new Date().toISOString(),
        recoveryMs: null,
        recoveryOk: null,
        readyToShowMs: null,
        pageUsableMs: null,
        pageUsable: null,
        pageUsableError: null,
        loadError: null,
        gpuGone: [],
        rendererGone: [],
        closedAtMs: null,
      },
      flush() {
        try {
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(path.join(this.dir, `run-${RUN_INDEX}.json`),
            JSON.stringify(this.record, null, 2));
        } catch {}
      },
    }
  : { record: null, flush() {} };
let rssTimer = null;

// --- backend state ------------------------------------------------------------
let dshChild = null;
let ownedBackendPid = null;
let backendReady = false;
let backendFailure = null;
let backendUrl = null;
let quitting = false;

function stopDsh() {
  const pid = ownedBackendPid;
  ownedBackendPid = null;
  if (!pid) return;
  // Never terminate an arbitrary process just because it holds our port.
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else if (dshChild) {
      dshChild.kill('SIGTERM');
    }
  } catch {}
  try { fs.unlinkSync(BACKEND_FILE); } catch {}
}

function failShell(error) {
  if (quitting) return;
  quitting = true;
  const message = (error && error.message ? error.message : String(error))
    .replace(/([?&]token=)[^\s&#]+/g, '$1<redacted>');
  shellLog(`[fail] ${message}`);
  if (diag.record) {
    diag.record.loadError = diag.record.loadError || message;
    diag.flush();
  }
  try {
    dialog.showErrorBox('Fairy \u542f\u52a8\u6216\u8fd0\u884c\u5931\u8d25',
      `${message}\n\n\u8bca\u65ad\u65e5\u5fd7\uff1a${SHELL_LOG}\n\u540e\u7aef\u65e5\u5fd7\uff1a${LOG_FILE}`);
  } catch {}
  stopDsh();
  app.quit();
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1200, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

// --- first-run recovery (portable zip loses junctions; git skews mtimes) ------
// Both tools are idempotent. restore-link-deps failures are fatal (plugins
// would not activate); mtime blessing failures only warn (they gate repo dev
// checks, not the running backend).
function runRecovery() {
  const t0 = Date.now();
  const tools = path.join(REPO, 'tools');
  const steps = [
    { file: 'restore-link-deps.mjs', args: [REPO, '--apply'], fatal: true },
    { file: 'bless-build-mtimes.mjs', args: [REPO, '--apply'], fatal: false },
  ];
  let ok = true;
  for (const step of steps) {
    const script = path.join(tools, step.file);
    if (!fs.existsSync(script)) {
      shellLog(`[recovery] missing tool: ${step.file}`);
      if (step.fatal) ok = false;
      continue;
    }
    try {
      const out = execFileSync(NODE_EXE, [script, ...step.args], {
        windowsHide: true, timeout: 120000, encoding: 'utf8',
      });
      shellLog(`[recovery] ${step.file}: ${String(out).trim().split('\n').pop()}`);
    } catch (error) {
      shellLog(`[recovery] ${step.file} failed: ${error && error.message}`);
      if (step.fatal) ok = false;
    }
  }
  if (diag.record) {
    diag.record.recoveryMs = Date.now() - t0;
    diag.record.recoveryOk = ok;
    diag.flush();
  }
  return ok;
}

// --- first-run home preparation ----------------------------------------------
// The kernel resolves its ACTIVE profile at <home>/profiles/<name>. On a
// fresh home it materializes a BARE profile there (no bundles -> no plugins,
// which users read as "nothing works"). The profile must be a junction into
// the packaged repo instead -- the same setup the dev launcher used to do
// manually. Also seed generic first-run preferences (no credentials: a fresh
// home intentionally ships none and shows the API-key onboarding).
function ensureHomeProfile() {
  const repoProfile = path.join(REPO, 'profiles', 'web');
  if (!fs.existsSync(repoProfile)) {
    throw new Error(`\u4ed3\u5185 profile \u7f3a\u5931\uff1a${repoProfile}`);
  }
  const homeProfiles = path.join(HOME, 'profiles');
  const homeProfile = path.join(homeProfiles, 'web');
  fs.mkdirSync(homeProfiles, { recursive: true });
  const link = () => fs.symlinkSync(repoProfile, homeProfile, 'junction');
  const st = fs.lstatSync(homeProfile, { throwIfNoEntry: false });
  if (!st) {
    link();
    return;
  }
  if (st.isSymbolicLink()) {
    // Wrong target (moved install)? Repair; otherwise leave untouched.
    try {
      if (fs.realpathSync(homeProfile).toLowerCase()
        === fs.realpathSync(repoProfile).toLowerCase()) return;
    } catch {}
    fs.unlinkSync(homeProfile);
    link();
    return;
  }
  // A bare profile dir from a previous broken run: replace it (it is tiny).
  fs.rmSync(homeProfile, { recursive: true, force: true });
  link();
  shellLog('[home] replaced the bare home profile with a junction to the repo profile');
}

function seedHomeSettings() {
  const seedFile = path.join(HOME, 'settings.yaml.imported');
  if (fs.existsSync(seedFile)) return;
  // Generic defaults only: suppress the welcome notice and switch the HDD
  // visuals on for a first run (mirrors the reference package's seed).
  fs.writeFileSync(seedFile, [
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    'fairy-visual:',
    '  enabled: true',
    '  mascotVisible: false',
    '',
  ].join('\r\n'), 'ascii');
  shellLog('[home] seeded settings.yaml.imported');
}

// --- backend lifecycle ---------------------------------------------------------
function backendEnv() {
  const env = {
    ...process.env,
    DSH_HOME: HOME,
    DSH_WORKSPACE_ROOT: path.join(REPO, 'fairy-voice'),
    DSH_FAIRY_REPO_ROOT: REPO,
    DSH_FAIRY_PROFILE_ROOT: path.join(REPO, 'profiles', 'web'),
    NODE_OPTIONS: '',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function startDsh() {
  if (path.isAbsolute(NODE_EXE) && !fs.existsSync(NODE_EXE)) {
    throw new Error(`\u5185\u7f6e Node.js \u7f3a\u5931\uff1a${NODE_EXE}`);
  }
  if (!fs.existsSync(DSH_BIN)) {
    throw new Error(`\u5185\u7f6e DSH \u5185\u6838\u7f3a\u5931\uff1a${DSH_BIN}`);
  }
  fs.mkdirSync(HOME, { recursive: true });
  // Fresh log per launch: the token must never be read from a previous run.
  fs.writeFileSync(LOG_FILE, '', 'utf8');
  const out = fs.openSync(LOG_FILE, 'a');
  let child;
  try {
    child = spawn(NODE_EXE, [DSH_BIN, 'web', '--port', String(PORT), '--no-open'], {
      env: backendEnv(), windowsHide: true, stdio: ['ignore', out, out], cwd: REPO,
    });
  } finally {
    // The child owns duplicated handles; the parent must not leak its copy.
    fs.closeSync(out);
  }
  dshChild = child;
  ownedBackendPid = child.pid || null;
  try {
    fs.writeFileSync(BACKEND_FILE, JSON.stringify({ pid: ownedBackendPid, port: PORT }));
  } catch {}
  child.on('error', (error) => {
    backendFailure = backendFailure || error;
    if (backendReady && !quitting) failShell(error);
  });
  child.on('exit', (code, signal) => {
    dshChild = null;
    backendFailure = backendFailure
      || new Error(`DSH \u540e\u7aef\u610f\u5916\u9000\u51fa\uff08code=${code}, signal=${signal || 'none'}\uff09\u3002`);
    if (backendReady && !quitting) failShell(backendFailure);
  });
}

// Read only this launch's bounded log tail, never reuse a previous token.
function findBackendUrl(port) {
  try {
    const size = fs.statSync(LOG_FILE).size;
    const offset = Math.max(0, size - 65536);
    if (size <= offset) return null;
    const buffer = Buffer.alloc(size - offset);
    const fd = fs.openSync(LOG_FILE, 'r');
    let text = '';
    try {
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      text = buffer.subarray(0, count).toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
    } finally {
      fs.closeSync(fd);
    }
    const re = new RegExp(
      `http://127\\.0\\.0\\.1:${port}/\\?token=[A-Za-z0-9._~%=-]+`,
    );
    return text.match(re)?.[0] || null;
  } catch {
    return null;
  }
}

function httpReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
      response.resume();
      // The authenticated root exchange returns a signed cookie and 303 ./.
      resolve(response.statusCode === 303 && response.headers.location === './'
        && !!response.headers['set-cookie']);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    if (backendFailure) throw backendFailure;
    const url = backendUrl || findBackendUrl(port);
    if (url && (await httpReady(url))) {
      if (backendFailure) throw backendFailure;
      backendUrl = url;
      try { fs.writeFileSync(URL_FILE, url); } catch {}
      return true;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

// --- window chrome -------------------------------------------------------------
// Real rounded corners need a transparent, frameless window. The clip must
// live on BODY only: clip-path on <html> is ignored by the compositor, and
// border-radius on both html and body produces two intersecting clips that
// read as a bevel. `contain: paint` is what clips DSH's positioned root.
//
// Frameless transparent windows on Windows misbehave in two ways, both
// verified by the reference shell: isMaximized() stays false after maximize(),
// and unmaximize() does not restore the previous size. So the shell drives the
// geometry itself and remembers the pre-maximize bounds. "Maximized" means
// REAL fullscreen: a normal maximize only fills the work area, leaving the
// taskbar visible.
const RADIUS = CONFIG.cornerRadius;
const SHAPE = CONFIG.cornerShape;

const SHELL_CSS = `
  html { background: transparent !important; }
  body {
    ${SHAPE === 'circle'
      ? `border-radius: ${RADIUS}px !important;
    contain: paint !important;
    background-clip: padding-box !important;`
      : '/* continuous curvature: clipped by the computed polygon instead */'}
  }
  #fairy-drag-strip {
    position: fixed; top: 0; left: 0; right: 0; height: 8px;
    -webkit-app-region: drag; z-index: 2147483000;
  }
  /* Window buttons sit in the session header gap and fade in on hover. */
  #fairy-shell-corner {
    position: fixed; top: 10px; right: 220px; width: 160px; height: 28px;
    z-index: 2147483001; -webkit-app-region: no-drag;
  }
  #fairy-shell-controls {
    position: absolute; top: 0; right: 0; display: flex; gap: 5px;
    opacity: 0; transform: translateX(12px); pointer-events: none;
    transition: opacity .18s ease, transform .18s ease;
  }
  #fairy-shell-corner:hover #fairy-shell-controls {
    opacity: 1; transform: translateX(0); pointer-events: auto;
  }
  .fairy-sbtn {
    width: 24px; height: 22px; border: 0; padding: 0; cursor: pointer;
    border-radius: 7px; display: grid; place-items: center;
    background: rgba(22, 30, 46, .55);
    color: #c3d2e8; font: 500 10px/1 "Segoe UI", sans-serif;
    box-shadow: inset 0 0 0 1px rgba(140, 175, 235, .16);
    transition: background .13s ease, color .13s ease;
  }
  .fairy-sbtn:hover { background: rgba(48, 66, 100, .85); color: #ffffff; }
  .fairy-sbtn.fairy-close:hover { background: #cf4444; color: #fff; }
  /* Maximized: drop the rounding, a fullscreen window must not show gaps. */
  body.fairy-maximized {
    border-radius: 0 !important;
    clip-path: none !important;
    contain: none !important;
  }
`;

const SHELL_JS = `(() => {
  if (document.getElementById('fairy-shell-corner')) return 'already';
  const corner = document.createElement('div');
  corner.id = 'fairy-shell-corner';
  const box = document.createElement('div');
  box.id = 'fairy-shell-controls';
  const mk = (label, title, cls) => {
    const b = document.createElement('button');
    b.className = 'fairy-sbtn' + (cls ? ' ' + cls : '');
    b.title = title;
    b.textContent = label;
    return b;
  };
  const min = mk('\\u2013', '\\u6700\\u5c0f\\u5316');
  const max = mk('\\u25a1', '\\u6700\\u5927\\u5316 / \\u8fd8\\u539f');
  const cls = mk('\\u2715', '\\u5173\\u95ed', 'fairy-close');
  min.onclick = (e) => { e.stopPropagation(); window.fairyShell.minimize(); };
  max.onclick = (e) => { e.stopPropagation(); window.fairyShell.toggleMaximize(); };
  cls.onclick = (e) => { e.stopPropagation(); window.fairyShell.close(); };
  box.append(min, max, cls);
  corner.appendChild(box);
  document.body.appendChild(corner);

  const strip = document.createElement('div');
  strip.id = 'fairy-drag-strip';
  document.body.appendChild(strip);
  return 'injected';
})();`;

// Continuous-curvature corner (superellipse), applied only when shell.json
// asks for cornerShape "continuous": a circular arc has a curvature jump where
// it meets the straight edges; the superellipse falls to zero there.
const SHELL_CONTINUOUS_JS = `(() => {
  const baseR = ${RADIUS} * 2.2;
  const n = 4.5, N = 40, A = 2 / n;
  const C = (t) => Math.pow(Math.cos(t), A);
  const S = (t) => Math.pow(Math.sin(t), A);
  function apply() {
    const w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;
    const r = Math.min(baseR, Math.min(w, h) / 2);
    const pts = [];
    const P = (x, y) => pts.push(x.toFixed(2) + 'px ' + y.toFixed(2) + 'px');
    for (let i = 0; i <= N; i++) { const t = (Math.PI / 2) * i / N; P(r - r * C(t), r - r * S(t)); }
    for (let i = 0; i <= N; i++) { const t = (Math.PI / 2) * i / N; P(w - r + r * S(t), r - r * C(t)); }
    for (let i = 0; i <= N; i++) { const t = (Math.PI / 2) * i / N; P(w - r + r * C(t), h - r + r * S(t)); }
    for (let i = 0; i <= N; i++) { const t = (Math.PI / 2) * i / N; P(r - r * S(t), h - r + r * C(t)); }
    document.body.style.clipPath = 'polygon(' + pts.join(',') + ')';
  }
  apply();
  window.addEventListener('resize', apply);
  return 'continuous-clip-applied';
})();`;

// --- persistent window geometry -------------------------------------------------
const GEOMETRY_FILE = path.join(DATA_DIR, 'window-state.json');
const DEFAULT_BOUNDS = { width: 1320, height: 900, minWidth: 920, minHeight: 620 };

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(GEOMETRY_FILE, 'utf8'));
    const b = raw.bounds || {};
    const state = {
      bounds: {
        x: Number.isFinite(b.x) ? Math.round(b.x) : undefined,
        y: Number.isFinite(b.y) ? Math.round(b.y) : undefined,
        width: Number.isFinite(b.width) && b.width >= DEFAULT_BOUNDS.minWidth
          ? Math.round(b.width) : DEFAULT_BOUNDS.width,
        height: Number.isFinite(b.height) && b.height >= DEFAULT_BOUNDS.minHeight
          ? Math.round(b.height) : DEFAULT_BOUNDS.height,
      },
      maximized: !!raw.maximized,
    };
    // Drop persisted bounds that no display can see any more (monitor change).
    const onScreen = screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return state.bounds.x === undefined || (
        state.bounds.x >= w.x - 40 && state.bounds.x < w.x + w.width
        && state.bounds.y >= w.y - 40 && state.bounds.y < w.y + w.height);
    });
    if (!onScreen) {
      state.bounds = { width: state.bounds.width, height: state.bounds.height };
      state.maximized = false;
    }
    return state;
  } catch {
    return { bounds: { width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height }, maximized: false };
  }
}

let geometrySaveTimer = null;
function saveWindowState(mainWindow, maximized) {
  if (geometrySaveTimer) clearTimeout(geometrySaveTimer);
  geometrySaveTimer = setTimeout(() => {
    geometrySaveTimer = null;
    try {
      const bounds = mainWindow && !mainWindow.isDestroyed() && !maximized
        ? mainWindow.getBounds() : null;
      const prev = (() => {
        try { return JSON.parse(fs.readFileSync(GEOMETRY_FILE, 'utf8')); } catch { return {}; }
      })();
      fs.writeFileSync(GEOMETRY_FILE, JSON.stringify({
        bounds: bounds || prev.bounds || DEFAULT_BOUNDS,
        maximized,
      }, null, 2));
    } catch {}
  }, 500);
}

// --- startup animation gate (phase 2-C: CSS-only; video import is phase 3) ------
let startupAnimation = null;

// --- main window ------------------------------------------------------------------
let mainWindow = null;
let isMaximized = false;
let savedBounds = null;
let fullscreenTarget = null;
let resizeTimer = null;

function maximizeShell() {
  if (!mainWindow) return;
  if (!isMaximized) savedBounds = mainWindow.getBounds();
  mainWindow.setFullScreen(true);
  fullscreenTarget = screen.getDisplayMatching(mainWindow.getBounds()).bounds;
  setMaximizedChrome(true);
}

function restoreShell() {
  if (!mainWindow) return;
  mainWindow.setFullScreen(false);
  // Defensive: the native restore path proved unreliable on this window type,
  // so put the remembered bounds back explicitly a moment later.
  fullscreenTarget = null;
  if (savedBounds) {
    setTimeout(() => {
      try {
        if (mainWindow) mainWindow.setBounds(savedBounds);
      } catch {}
    }, 350);
  }
  setMaximizedChrome(false);
}

function setMaximizedChrome(max, force) {
  const changed = max !== isMaximized || force;
  isMaximized = max;
  if (!mainWindow || !changed) return;
  mainWindow.webContents
    .executeJavaScript(
      `document.body && document.body.classList.toggle('fairy-maximized', ${max ? 'true' : 'false'});`,
    )
    .catch(() => {});
}

// Dragging an edge of a fullscreen window drops it out of fullscreen at the OS
// level, but the shell's own flag would stay set. Watch the geometry and clear
// the state as soon as the window no longer covers the whole display.
function syncMaximizedFromGeometry() {
  if (!isMaximized || !mainWindow) return;
  const d = fullscreenTarget;
  if (!d) return;
  if (resizeTimer) return;
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (!isMaximized || !mainWindow) return;
    const b = mainWindow.getBounds();
    const covers = b.x <= d.x + 2 && b.y <= d.y + 2
      && b.width >= d.width - 4 && b.height >= d.height - 4;
    if (!covers) setMaximizedChrome(false);
  }, 150);
}

function createWindow(state) {
  mainWindow = new BrowserWindow({
    ...DEFAULT_BOUNDS,
    ...state.bounds,
    show: false,
    title: `Fairy-DSH-Fresh ${app.getVersion()}`,
    icon: path.join(__dirname, 'fairy-eye.ico'),
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    if (diag.record && diag.record.readyToShowMs === null) {
      diag.record.readyToShowMs = Date.now() - diag.t0;
      diag.flush();
    }
    // Fullscreen must be set BEFORE the window shows: showing windowed and
    // flipping afterwards produces a visible two-step jump.
    if (state.maximized) {
      savedBounds = { ...state.bounds };
      mainWindow.setFullScreen(true);
      fullscreenTarget = screen.getDisplayMatching(mainWindow.getBounds()).bounds;
      isMaximized = true;
    }
    if (startupAnimation) startupAnimation.mainReady(mainWindow);
    else mainWindow.show();
  });

  let rendererRecoveryUsed = false;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || mainWindow.isDestroyed()) return;
    shellLog(`[renderer gone] ${details.reason}`);
    if (diag.record) {
      diag.record.rendererGone.push({ reason: details.reason, atMs: Date.now() - diag.t0 });
      diag.flush();
    }
    if (!rendererRecoveryUsed && details.reason !== 'clean-exit') {
      rendererRecoveryUsed = true;
      mainWindow.webContents.reload();
    } else {
      failShell(new Error(`\u754c\u9762\u8fdb\u7a0b\u9000\u51fa\uff08${details.reason}\uff09\uff0c\u8bf7\u91cd\u65b0\u542f\u52a8 Fairy\u3002`));
    }
  });

  mainWindow.loadURL(backendUrl).catch((error) => {
    if (!quitting && !mainWindow.isDestroyed()) failShell(error);
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      await mainWindow.webContents.insertCSS(SHELL_CSS);
      await mainWindow.webContents.executeJavaScript(SHELL_JS);
      setMaximizedChrome(isMaximized, true); // re-apply after a reload
      if (SHAPE === 'continuous') {
        await mainWindow.webContents.executeJavaScript(SHELL_CONTINUOUS_JS);
      }
      if (diag.record) {
        diag.record.pageUsable = await mainWindow.webContents.executeJavaScript(
          '(() => ({'
          + ' fairyAttrs: Object.keys(document.documentElement.dataset).filter((k) => k.toLowerCase().startsWith("dshfairy")).length,'
          + ' hasSidebar: !!document.querySelector(\'[data-slot="sidebar"]\'),'
          + ' readyState: document.readyState'
          + ' }))()',
          false,
        );
        diag.record.pageUsableMs = Date.now() - diag.t0;
        diag.flush();
      }
    } catch (error) {
      shellLog(`[inject] failed: ${error && error.message}`);
    }
  });

  // External links open in the real browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => setMaximizedChrome(true));
  mainWindow.on('unmaximize', () => setMaximizedChrome(false));
  mainWindow.on('resize', syncMaximizedFromGeometry);
  mainWindow.on('restore', syncMaximizedFromGeometry);
  mainWindow.on('move', () => saveWindowState(mainWindow, isMaximized));
  mainWindow.on('resize', () => saveWindowState(mainWindow, isMaximized));
  mainWindow.on('closed', () => {
    mainWindow = null;
    // A detached splash must not keep the backend/app alive.
    if (startupAnimation) startupAnimation.dispose();
  });
}

// --- IPC ---------------------------------------------------------------------------
ipcMain.on('shell:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('shell:close', () => mainWindow && mainWindow.close());
ipcMain.on('shell:toggle-maximize', () => {
  if (!mainWindow) return;
  if (isMaximized) restoreShell();
  else maximizeShell();
});
ipcMain.handle('shell:is-maximized', () => isMaximized);

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// GPU subprocess crashes are the #1 environmental failure mode on this
// project (see 02 red line / decision D-049). Record them for the
// diagnostics harness; a crash-loop to FATAL kills the process without any
// other trace, so this handler is the only witness.
app.on('child-process-gone', (_event, details) => {
  if (!diag.record || details.type !== 'GPU') return;
  diag.record.gpuGone.push({
    reason: details.reason, exitCode: details.exitCode,
    atMs: diag.t0 ? Date.now() - diag.t0 : null,
  });
  diag.flush();
});

if (!app.requestSingleInstanceLock()) {
  // Do not delete another instance's locks or enter an infinite relaunch loop.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (startupAnimation && startupAnimation.focus()) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    diag.t0 = Date.now();
    if (diag.record) {
      rssTimer = setInterval(() => {
        try {
          fs.mkdirSync(DIAG_DIR, { recursive: true });
          fs.appendFileSync(path.join(DIAG_DIR, `rss-${RUN_INDEX}.jsonl`),
            `${JSON.stringify({ atMs: Date.now() - diag.t0, rss: process.memoryUsage().rss })}\n`);
        } catch {}
      }, 30000);
    }
    if (await portInUse(PORT)) {
      throw new Error(`\u7aef\u53e3 ${PORT} \u5df2\u88ab\u5360\u7528\u3002\u8bf7\u5173\u95ed\u6b8b\u7559\u7684 Fairy \u5b9e\u4f8b\u6216\u5360\u7528\u7aef\u53e3\u7684\u7a0b\u5e8f\u540e\u91cd\u8bd5\u3002`);
    }
    // Clean the previous run's engine spill files (engine spills via os.tmpdir()
    // into dsh-spill-* and never cleans up; our temp now lives in DATA_DIR).
    try {
      for (const name of fs.readdirSync(TMP_DIR)) {
        if (!name.startsWith('dsh-spill-')) continue;
        try { fs.rmSync(path.join(TMP_DIR, name), { recursive: true, force: true }); } catch {}
      }
    } catch {}
    if (!runRecovery()) {
      throw new Error('\u63d2\u4ef6\u94fe\u63a5\u4fee\u590d\u5931\u8d25\uff08restore-link-deps\uff09\uff0c\u8be6\u89c1 shell.log\u3002');
    }
    ensureHomeProfile();
    seedHomeSettings();
    const winState = loadWindowState();
    try {
      startupAnimation = require('./startup-animation.cjs').createStartupAnimation({
        app, BrowserWindow, ipcMain, getMainWindow: () => mainWindow,
      });
      startupAnimation.open(winState.bounds);
    } catch (error) {
      shellLog(`[startup animation] unavailable: ${error && error.message}`);
    }
    startDsh();
    if (!(await waitForPort(PORT))) {
      throw new Error(`DSH \u672a\u5728 90 \u79d2\u5185\u5b8c\u6210\u542f\u52a8\uff08\u7aef\u53e3 ${PORT}\uff09\u3002`);
    }
    if (quitting) return;
    backendReady = true;
    createWindow(winState);
  }).catch(failShell);

  app.on('window-all-closed', () => {
    quitting = true;
    stopDsh();
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (resizeTimer) clearTimeout(resizeTimer);
    if (geometrySaveTimer) clearTimeout(geometrySaveTimer);
    if (rssTimer) clearInterval(rssTimer);
    if (startupAnimation) startupAnimation.dispose();
    if (diag.record) {
      diag.record.closedAtMs = Date.now() - diag.t0;
      diag.flush();
    }
    stopDsh();
  });
}
