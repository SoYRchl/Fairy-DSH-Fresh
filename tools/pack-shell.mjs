#!/usr/bin/env node
// Assemble the distributable package for the 2-C shell (portable zip + NSIS).
//
//   node tools/pack-shell.mjs                 # stage + zip (+ installer if NSIS_EXE set)
//   node tools/pack-shell.mjs --stage-only    # staging dir only, no zip
//
// Required inputs (no machine paths are hardcoded -- they come from env):
//   FAIRY_NODE            absolute path to an official Node 22 win-x64 node.exe
//   FAIRY_KERNEL_MODULES  a node_modules prefix containing @deepseek-ai/dsh
//                         (the machine's kernel install, version-verified)
//   NSIS_EXE              optional: makensis.exe to also build the setup exe
// Output (default <repo>/../Fairy-DSH-Dist/, override with FAIRY_DIST_ROOT):
//   Fairy-DSH-Fresh-<ver>/            portable root (also the NSIS payload)
//   Fairy-DSH-Fresh-<ver>-portable.zip
//   Fairy-DSH-Fresh-<ver>-setup.exe   (when NSIS_EXE provided)
//   SHA256SUMS.txt
//
// Layout produced (also documented in shell/main.js):
//   <root>/Fairy-DSH-Fresh.exe          renamed electron.exe (official dist)
//   <root>/resources/app/               shell/ app files
//   <root>/resources/runtime/node.exe
//   <root>/resources/kernel/node_modules/
//   <root>/resources/repo/              repo snapshot WITHOUT the five link:
//                                       junctions (first launch recreates
//                                       them via tools/restore-link-deps.mjs)
//
// Junctions are stripped on purpose: a junction copied into a zip extracts as
// either a broken link or a full copy of its target. A full copy would defeat
// restore-link-deps.mjs, which refuses to replace ordinary directories. With
// the links absent, first-run recovery recreates them from the manifest.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..'));
const args = process.argv.slice(2);
const stageOnly = args.includes('--stage-only');
const cleanIdx = args.indexOf('--clean');
if (cleanIdx >= 0) {
  const target = args[cleanIdx + 1];
  if (!target || !fs.existsSync(target)) {
    console.error(`[pack] --clean: nothing to clean at ${target}`);
    process.exit(2);
  }
  console.error(`[pack] cleaning ${target} (slow on this machine: deletions are`
    + ' filter-throttled; consider deleting in Explorer instead)');
  const r = spawnSync('cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', target], { windowsHide: true });
  process.exit(r.status === 0 && !fs.existsSync(target) ? 0 : 1);
}

function fail(message) {
  console.error(`[pack] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[pack] ${message}`);
}

const version = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
const distRoot = process.env.FAIRY_DIST_ROOT || path.resolve(repoRoot, '..', 'Fairy-DSH-Dist');
// Timestamped staging: mass deletion on this machine is filter-slowed to
// ~35 files/s, so a build must never need to delete a previous tree. Each
// build lands in a fresh dir; old ones are cleaned up manually (or via
// `--clean <dir>`).
//
// The staging root is ALSO kept short (FAIRY_STAGE_ROOT, default distRoot):
// NSIS opens every source file by path and fails past 260 chars. The kernel
// tree reaches 209 chars relative, so the staging prefix must stay under ~50
// chars. NSIS compiles from the short path; afterwards the tree is RENAMED
// (one metadata op) into distRoot under its clean release name for zipping.
const buildId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const name = `Fairy-DSH-Fresh-${version}`;
const stageRoot = process.env.FAIRY_STAGE_ROOT || distRoot;
const staging = path.join(stageRoot, `b${buildId}`);

const nodeSrc = process.env.FAIRY_NODE;
const kernelSrc = process.env.FAIRY_KERNEL_MODULES;
if (!nodeSrc || !fs.existsSync(nodeSrc)) {
  fail('FAIRY_NODE not set or missing (absolute path to a Node 22 win-x64 node.exe)');
}
if (!kernelSrc || !fs.existsSync(path.join(kernelSrc, '@deepseek-ai', 'dsh', 'package.json'))) {
  fail('FAIRY_KERNEL_MODULES not set or does not contain @deepseek-ai/dsh');
}

const electronDist = path.join(repoRoot, 'shell', 'node_modules', 'electron', 'dist');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  fail('electron dist missing; run in shell/: pnpm install, then'
    + ' ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js');
}

// The five `link:` junctions pnpm does not create (tools/restore-link-deps.mjs
// is the single source of truth for this list).
const profileModules = path.join(repoRoot, 'profiles', 'web', 'node_modules');
const junctionNames = fs.readdirSync(profileModules, { withFileTypes: true })
  .filter((e) => e.isSymbolicLink())
  .map((e) => e.name);
log(`junctions to strip: ${junctionNames.join(', ') || '(none)'}`);

// --- 1. staging ---------------------------------------------------------------
// Never fs.rmSync a build tree here: mass deletion on this machine is
// filter-slowed to ~35 files/s (see staging note above). The staging dir is
// freshly created and MUST NOT exist beforehand.
if (fs.existsSync(staging)) {
  fail(`staging already exists: ${staging} (wait a minute or delete it manually)`);
}
fs.mkdirSync(staging, { recursive: true });
log(`staging: ${staging}`);

// Big-tree copies go through robocopy: multithreaded, long-path safe, and (on
// this build machine) immune to the sandbox killing mass fs.cpSync operations
// in silence. Exit codes 0-7 are success (bitmask), >= 8 is failure.
function robocopy(src, dst, extraArgs = []) {
  const result = spawnSync('robocopy', [
    src, dst, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1',
    ...extraArgs,
  ], { windowsHide: true });
  if (result.error) fail(`robocopy failed to start: ${result.error.message}`);
  if (result.status === null || result.status >= 8) {
    fail(`robocopy failed (exit ${result.status}) copying to ${dst}`);
  }
}

log('copying electron dist ...');
robocopy(electronDist, staging);
try { fs.unlinkSync(path.join(staging, 'resources', 'default_app.asar')); } catch {}
fs.renameSync(path.join(staging, 'electron.exe'), path.join(staging, 'Fairy-DSH-Fresh.exe'));

log('copying shell app files ...');
const appDir = path.join(staging, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const f of [
  'package.json', 'main.js', 'preload.js', 'startup-animation.cjs',
  'startup.html', 'startup.css', 'startup.js',
]) {
  fs.copyFileSync(path.join(repoRoot, 'shell', f), path.join(appDir, f));
}
// Bundled startup video (user-approved reuse of the reference package's media
// asset -- inert data, no executable content; decision D-052).
fs.mkdirSync(path.join(appDir, 'media'), { recursive: true });
fs.copyFileSync(path.join(repoRoot, 'shell', 'media', 'startup-default.mp4'),
  path.join(appDir, 'media', 'startup-default.mp4'));
fs.copyFileSync(path.join(repoRoot, 'tools', 'assets', 'fairy-eye.ico'),
  path.join(appDir, 'fairy-eye.ico'));

log('copying node runtime ...');
const runtimeDir = path.join(staging, 'resources', 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(nodeSrc, path.join(runtimeDir, 'node.exe'));
const nodeVer = spawnSync(path.join(runtimeDir, 'node.exe'), ['-v'], { encoding: 'utf8' });
if (nodeVer.status !== 0 || !/^v22\./.test(nodeVer.stdout.trim())) {
  fail(`bundled node is not Node 22: ${nodeVer.stdout || nodeVer.stderr}`);
}
log(`node ${nodeVer.stdout.trim()}`);

log('copying kernel ...');
const kernelDir = path.join(staging, 'resources', 'kernel');
fs.mkdirSync(kernelDir, { recursive: true });
robocopy(kernelSrc, path.join(kernelDir, 'node_modules'));
const kernelVer = JSON.parse(fs.readFileSync(
  path.join(kernelDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8',
)).version;
log(`kernel @deepseek-ai/dsh ${kernelVer}`);

log('copying repo snapshot ...');
const repoDir = path.join(staging, 'resources', 'repo');
const excl = (rel) => path.join(repoRoot, rel);
robocopy(repoRoot, repoDir, [
  '/XD',
  excl('.git'), excl('shell'), excl('release'), excl('snapshots'),
  excl('_install-logs'), excl('.pnpm-store'),
  ...junctionNames.map((n) => excl(path.join('profiles', 'web', 'node_modules', n))),
  '/XF', '*.log',
]);

fs.writeFileSync(path.join(staging, 'README.txt'), [
  'Fairy-DSH-Fresh portable package',
  '================================',
  '',
  '1. Double-click Fairy-DSH-Fresh.exe. No installation needed.',
  '2. First launch rebuilds two kinds of internal links and then starts the',
  '   backend; the window opens when the backend is ready (up to ~90 s).',
  '3. All writable data lives in data/ next to the exe (portable mode). When',
  '   the folder is not writable (e.g. installed under Program Files), data',
  '   moves to %LOCALAPPDATA%\\Fairy-DSH-Fresh instead.',
  '4. A fresh home shows the one-time setup (API key) page -- that is',
  '   expected. The package ships no credentials.',
  '5. Closing the window stops the backend it started. Nothing stays running.',
  '',
  'Optional data/shell.json overrides:',
  '  { "port": 3090, "home": "D:/path/to/home",',
  '    "cornerRadius": 18, "cornerShape": "circle" }',
  '',
].join('\r\n'));

// Safety: the staging tree must be junction-free, or the zip would carry
// absolute links that break on extraction.
let linksLeft = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      linksLeft += 1;
      console.error(`[pack]   ! symlink survived: ${p}`);
      continue;
    }
    if (entry.isDirectory()) walk(p);
  }
}(staging));
if (linksLeft > 0) fail(`${linksLeft} symlinks survived staging -- aborting`);
log('staging tree is junction-free');

// --- 2. rename into dist, zip, checksum, installer ----------------------------
// Reordered so NSIS reads the SHORT staging path; the rename afterwards is a
// single metadata operation (deleting trees is filter-slowed on this machine).
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const sums = [];

// 2a. NSIS installer (from the short staging path)
const nsisExe = process.env.NSIS_EXE;
if (nsisExe && !stageOnly) {
  const setupFile = path.join(distRoot, `${name}-setup.exe`);
  log('building NSIS installer (this takes a while) ...');
  const build = spawnSync(nsisExe, [
    `/DVERSION=${version}`,
    `/DSTAGING=${staging}`, `/DOUTFILE=${setupFile}`,
    path.join(repoRoot, 'tools', 'pack', 'installer.nsi'),
  ], { windowsHide: true, stdio: 'inherit' });
  if (build.status !== 0) fail(`NSIS failed (exit ${build.status})`);
  log(`setup done: ${setupFile} (${(fs.statSync(setupFile).size / 1048576).toFixed(0)} MB)`);
  sums.push([await sha256(setupFile), path.basename(setupFile)]);
} else if (!nsisExe && !stageOnly) {
  log('NSIS_EXE not set -- skipping the setup exe (portable zip only)');
}

// 2b. rename the finished tree to its clean release name under distRoot
let zipDirName = name;
let finalDir = path.join(distRoot, name);
if (fs.existsSync(finalDir)) {
  // A previous release dir is in the way (e.g. it accumulated runtime data
  // during verification). Rename it aside first -- renames are instant, and
  // silently falling back to a -b<id> zip root name is worse for users.
  const aside = path.join(distRoot, `_old-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
  fs.renameSync(finalDir, aside);
  log(`previous ${name} moved aside -> ${path.basename(aside)}`);
  finalDir = path.join(distRoot, name);
}
fs.renameSync(staging, finalDir);

// 2c. portable zip
if (!stageOnly) {
  // Use the bundled bsdtar explicitly: a GNU tar on PATH reads "E:\..." as
  // host:file ("Cannot connect to E: resolve failed") and cannot write zip.
  const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (!fs.existsSync(tarExe)) fail('System32 tar.exe (bsdtar) not found; Windows 10+ ships it');
  const zipFile = path.join(distRoot, `${name}-portable.zip`);
  log('zipping (this takes a few minutes) ...');
  const zip = spawnSync(tarExe, ['-a', '-c', '-f', zipFile, '-C', distRoot, zipDirName], {
    windowsHide: true, stdio: 'inherit',
  });
  if (zip.status !== 0) fail(`zip failed (exit ${zip.status})`);
  log(`zip done: ${zipFile} (${(fs.statSync(zipFile).size / 1048576).toFixed(0)} MB)`);
  sums.push([await sha256(zipFile), path.basename(zipFile)]);
}

if (sums.length > 0) {
  const file = path.join(distRoot, 'SHA256SUMS.txt');
  fs.writeFileSync(file, `${sums.map(([h, n]) => `${h}  ${n}`).join('\n')}\n`, 'ascii');
  log(`checksums: ${file}`);
}
log('done');
