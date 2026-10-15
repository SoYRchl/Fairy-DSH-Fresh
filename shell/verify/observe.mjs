#!/usr/bin/env node
// 2-C acceptance harness for the packaged shell. Run on a REAL desktop session
// (never inside a restricted sandbox: the orb helper GPU subprocess crashes
// there for environmental reasons -- see decision D-049).
//
//   node observe.mjs <pkgRoot> [--runs 3] [--rss-minutes 10]
//
// What it checks (per run, results written next to this script as observe-*/):
//   A. cold start: backend listens on :3090 within 90 s
//   B. the shell recorded pageUsable + zero GPU/renderer crashes (the shell
//      writes run-<n>.json when FAIRY_SHELL_DIAG is set)
//   C. graceful close (taskkill without /F = WM_CLOSE, the same as clicking X)
//      stops the owned backend: backend.json removed, port freed, pid gone
//   D. one long run: RSS steady (tail3/head3 <= 1.2 over --rss-minutes)
// VERDICT.json aggregates everything.

import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const pkgRoot = path.resolve(process.argv[2] || '');
if (!fs.existsSync(path.join(pkgRoot, 'Fairy-DSH-Fresh.exe'))) {
  console.error('usage: node observe.mjs <pkgRoot containing Fairy-DSH-Fresh.exe>');
  process.exit(2);
}
const flag = (name, dflt) => {
  const hit = process.argv.findIndex((a) => a === name);
  return hit >= 0 ? Number(process.argv[hit + 1]) : dflt;
};
const RUNS = flag('--runs', 3);
const RSS_MINUTES = flag('--rss-minutes', 10);
const PORT = Number(process.env.FAIRY_PORT || 3090);

const outDir = path.join(pkgRoot, 'observe-results');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const exe = path.join(pkgRoot, 'Fairy-DSH-Fresh.exe');
const backendFile = path.join(pkgRoot, 'data', 'backend.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function portListening(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true });
    return out.split('\n').some((l) => l.includes(`:${port}`) && /LISTENING/i.test(l));
  } catch {
    return false;
  }
}
function pidsOnPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
      const pid = Number(line.trim().split(/\s+/).pop());
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

async function closeShellGracefully(shellPid) {
  // taskkill WITHOUT /F posts WM_CLOSE -- equivalent to clicking the X button.
  spawnSync('taskkill', ['/PID', String(shellPid)], { windowsHide: true });
}

async function waitBackendStopped(deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const backendPid = (() => {
      try { return JSON.parse(fs.readFileSync(backendFile, 'utf8')).pid; } catch { return null; }
    })();
    const orphans = pidsOnPort(PORT);
    if (backendPid === null && orphans.length === 0 && !portListening(PORT)) return true;
    await sleep(1000);
  }
  return false;
}

async function runOnce(index, keepMs) {
  const result = { run: index, startedAt: new Date().toISOString(), ok: false };
  const diagDir = path.join(outDir, 'diag');
  const env = {
    ...process.env,
    FAIRY_SHELL_DIAG: diagDir,
    FAIRY_SHELL_RUN_INDEX: String(index),
  };
  // Automation environments (agent sandboxes and their shells) are known to
  // inject ELECTRON_RUN_AS_NODE=1, which silently degrades the packaged
  // electron.exe into a plain Node and kills the app before main.js runs.
  // The shell must never inherit it, same rule as the backend env in main.js.
  delete env.ELECTRON_RUN_AS_NODE;
  env.NODE_OPTIONS = '';
  const child = spawn(exe, [], {
    cwd: pkgRoot,
    env,
    stdio: 'ignore',
  });
  result.shellPid = child.pid;
  try {
    // A. backend up within 90 s (+15 s recovery margin)
    const upDeadline = Date.now() + 105000;
    let up = false;
    while (Date.now() < upDeadline) {
      if (portListening(PORT)) { up = true; break; }
      await sleep(1000);
    }
    result.backendUp = up;
    result.backendUpMs = up ? null : 'timeout';

    if (keepMs > 0) {
      await sleep(keepMs);
      result.rssRun = true;
    } else {
      // let the window finish loading and the diag file get its pageUsable
      await sleep(12000);
    }

    // C. graceful close -> owned backend must die
    await closeShellGracefully(child.pid);
    result.backendStopped = await waitBackendStopped(30000);
    if (!result.backendStopped) {
      // Force-clean so the next run can start, but record the failure.
      for (const pid of [child.pid, ...pidsOnPort(PORT)]) {
        try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true }); } catch {}
      }
    }
  } finally {
    try { child.kill(); } catch {}
  }
  // B. shell-recorded diagnostics
  try {
    const diag = JSON.parse(fs.readFileSync(path.join(diagDir, `run-${index}.json`), 'utf8'));
    result.diag = {
      readyToShowMs: diag.readyToShowMs,
      pageUsableMs: diag.pageUsableMs,
      pageUsable: diag.pageUsable,
      gpuGone: diag.gpuGone?.length || 0,
      rendererGone: diag.rendererGone?.length || 0,
      loadError: diag.loadError,
    };
  } catch (error) {
    result.diag = { error: String(error.message || error) };
  }
  result.ok = result.backendUp === true && result.backendStopped === true
    && result.diag && result.diag.gpuGone === 0
    && !!result.diag.pageUsable
    && !result.diag.loadError;
  return result;
}

// --- execute --------------------------------------------------------------------
const results = [];
let verdict = 'PASS';
for (let i = 1; i <= RUNS; i++) {
  console.log(`[observe] run ${i}/${RUNS} ...`);
  const r = await runOnce(i, 0);
  results.push(r);
  console.log(`[observe] run ${i}: ${r.ok ? 'ok' : 'FAIL'} ${JSON.stringify(r.diag || {})}`);
  if (!r.ok) verdict = 'FAIL';
  await sleep(3000);
}

// D. long-run RSS steadiness
console.log(`[observe] RSS observation ${RSS_MINUTES} min ...`);
const rssIndex = 'rss';
const rssEnv = { ...process.env, FAIRY_SHELL_DIAG: path.join(outDir, 'diag'), FAIRY_SHELL_RUN_INDEX: rssIndex };
delete rssEnv.ELECTRON_RUN_AS_NODE;
rssEnv.NODE_OPTIONS = '';
const rssChild = spawn(exe, [], {
  cwd: pkgRoot,
  env: rssEnv,
  stdio: 'ignore',
});
await sleep(RSS_MINUTES * 60000);
await closeShellGracefully(rssChild.pid);
const rssStopped = await waitBackendStopped(30000);
let rssSteady = null;
try {
  const lines = fs.readFileSync(path.join(outDir, 'diag', `rss-${rssIndex}.jsonl`), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l).rss);
  if (lines.length >= 6) {
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    rssSteady = avg(lines.slice(-3)) / avg(lines.slice(0, 3)) <= 1.2;
  }
} catch {}
if (!rssStopped || rssSteady === false) verdict = 'FAIL';

fs.writeFileSync(path.join(outDir, 'VERDICT.json'), JSON.stringify({
  verdict,
  runs: results,
  rss: { stopped: rssStopped, steady: rssSteady, minutes: RSS_MINUTES },
  finishedAt: new Date().toISOString(),
}, null, 2));
console.log(`[observe] VERDICT: ${verdict}`);
