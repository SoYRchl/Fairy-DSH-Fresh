#!/usr/bin/env node
// One command that takes a fresh clone to a runnable state.
//
//   node tools/bootstrap.mjs            # do everything
//   node tools/bootstrap.mjs --check    # report only, change nothing
//
// Steps (order matters):
//   1. Preflight  — node >= 20, pnpm reachable via corepack.
//   2. Install    — `pnpm install` in each of the five in-repo plugin packages,
//                   then in `profiles/web` (last: its `postinstall` runs
//                   `tools/patch-dsh-orb.mjs`, which needs `dsh-orb` unpacked).
//   3. Links      — `tools/restore-link-deps.mjs --apply` (pnpm skips `link:`).
//   4. mtimes     — `tools/bless-build-mtimes.mjs --apply` (git checkout writes
//                   files in index order, so a manifest can look newer than the
//                   authoritative build artifact; see that file's header).
//   5. Verify     — re-run 3 and 4 in report mode and require a clean result.
//
// This is the single answer to "how do I get this running on another machine":
// every step is idempotent, so re-running is cheap and safe.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const repoRoot = path.join(import.meta.dirname, '..');
const profileRoot = path.join(repoRoot, 'profiles', 'web');
const toolsRoot = path.join(repoRoot, 'tools');

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;

function run(cmd, cmdArgs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function nodeScript(script, scriptArgs, cwd = repoRoot) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(toolsRoot, script), ...scriptArgs], {
      cwd,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

console.log(B('== Fairy-DSH 焕新 · bootstrap =='));
console.log(DIM(`repoRoot: ${repoRoot}`));
if (checkOnly) console.log(DIM('(--check：只报告，不改任何东西)'));

// --- 1. preflight -----------------------------------------------------------
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(RED(`Node 版本过低：${process.versions.node}（需要 >= 20）`));
  process.exit(2);
}
console.log(GREEN(`✓ node ${process.versions.node}`));

const pnpmCode = await run('corepack', ['pnpm', '--version'], repoRoot);
if (pnpmCode !== 0) {
  console.error(RED('✗ pnpm 不可用（corepack pnpm --version 失败）'));
  console.error('  先装 pnpm：npm install -g pnpm');
  process.exit(2);
}

// --- derive install roots ---------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8'));
const linkDeps = Object.entries(manifest.dependencies ?? {})
  .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('link:'))
  .map(([name, spec]) => ({
    name,
    dir: path.resolve(profileRoot, spec.slice('link:'.length)),
  }))
  .filter(({ dir }) => fs.existsSync(path.join(dir, 'package.json')));

const installRoots = [...linkDeps.map((d) => d.dir), profileRoot];
console.log(`\n${B('-- 2. 依赖安装')}（${installRoots.length} 个装包点）`);

for (const dir of installRoots) {
  const rel = path.relative(repoRoot, dir).split(path.sep).join('/');
  if (checkOnly) {
    const has = fs.existsSync(path.join(dir, 'node_modules'));
    console.log(`  ${has ? GREEN('✓') : RED('✗')} ${rel} — node_modules ${has ? '存在' : '缺失'}`);
    if (!has) failures += 1;
    continue;
  }
  process.stdout.write(`  · ${rel} … `);
  const code = await run('corepack', ['pnpm', 'install'], dir);
  if (code === 0) {
    console.log(GREEN('ok'));
  } else {
    console.log(RED(`失败（exit ${code}）`));
    failures += 1;
  }
}

// --- 3. links ---------------------------------------------------------------
console.log(`\n${B('-- 3. link: junction 归位')}`);
const linkCode = await nodeScript('restore-link-deps.mjs', checkOnly ? [] : ['--apply']);
if (linkCode !== 0) {
  console.log(RED('  ✗ 仍有未归位的 link 依赖（见上）'));
  failures += 1;
} else {
  console.log(GREEN('  ✓ 全部就位'));
}

// --- 4. mtimes --------------------------------------------------------------
console.log(`\n${B('-- 4. 产物 mtime 归位')}`);
const mtimeCode = await nodeScript('bless-build-mtimes.mjs', [repoRoot, ...(checkOnly ? [] : ['--apply'])]);
if (mtimeCode !== 0) {
  console.log(RED('  ✗ mtime 归位失败'));
  failures += 1;
} else {
  console.log(GREEN('  ✓ 归位完成'));
}

// --- 5. summary -------------------------------------------------------------
console.log(`\n${B('== 结果 ==')}`);
if (failures > 0) {
  console.log(RED(`有 ${failures} 项未通过。`));
  process.exit(1);
}
console.log(GREEN(checkOnly ? '检查通过：状态可复现。' : 'bootstrap 完成：可以启动了。'));
console.log(DIM('启动：node "E:/PureEnglishPath/Fairy-DSH-Launch/fairy-launcher.mjs" start'));
