#!/usr/bin/env node
// Restore the `link:` junctions that pnpm does not create on Windows.
//
// Why this exists
// ---------------
// `profiles/web/package.json` declares the five in-repo plugin packages as
// `link:../../<dir>/<pkg>`. Modern pnpm (observed on 11 and 12) installs the
// registry deps but **silently skips creating the link entries**, so a fresh
// clone ends up with `dsh-fairy-visual` etc. missing from
// `profiles/web/node_modules` -> the bundles cannot resolve -> plugins do not
// activate. This script re-creates them, idempotently.
//
// It is safe to run at any time: a link that already points at the right place
// is left untouched (mtime and inode preserved).
//
// Usage:
//   node tools/restore-link-deps.mjs [repoRoot]            # report only
//   node tools/restore-link-deps.mjs [repoRoot] --apply    # create/fix links

import fs from 'node:fs';
import path from 'node:path';

// `--apply` may sit before or after the optional repoRoot, so split explicitly
// instead of assuming a fixed argv layout.
const positional = [];
const flags = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--')) flags.push(arg);
  else positional.push(arg);
}
const repoRootArg = positional[0];
const apply = flags.includes('--apply');
const repoRoot = path.resolve(repoRootArg || path.join(import.meta.dirname, '..'));
const profileRoot = path.join(repoRoot, 'profiles', 'web');
const modulesRoot = path.join(profileRoot, 'node_modules');

const manifestPath = path.join(profileRoot, 'package.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`找不到 profile manifest：${manifestPath}`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const linkDeps = Object.entries(manifest.dependencies ?? {})
  .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('link:'))
  .map(([name, spec]) => ({
    name,
    target: path.resolve(profileRoot, spec.slice('link:'.length)),
  }));

if (linkDeps.length === 0) {
  console.log('manifest 里没有 `link:` 依赖，无需处理。');
  process.exit(0);
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

let ok = 0;
const fixed = [];
const broken = [];
const skipped = [];

for (const { name, target } of linkDeps) {
  const linkPath = path.join(modulesRoot, name);

  if (!fs.existsSync(target)) {
    broken.push({ name, reason: `目标不存在：${target}` });
    continue;
  }
  if (!fs.existsSync(modulesRoot)) {
    if (!apply) {
      broken.push({ name, reason: `node_modules 不存在：${modulesRoot}` });
      continue;
    }
    fs.mkdirSync(modulesRoot, { recursive: true });
  }

  const want = real(target);
  const exists = fs.existsSync(linkPath) || fs.lstatSync(linkPath, { throwIfNoEntry: false }) != null;
  const isLink = exists ? fs.lstatSync(linkPath).isSymbolicLink() : false;
  const got = isLink ? real(linkPath) : null;

  if (isLink && got && want && got.toLowerCase() === want.toLowerCase()) {
    ok += 1;
    continue;
  }

  if (!apply) {
    broken.push({
      name,
      reason: exists
        ? (isLink ? `指向别处：${got}` : '是实体目录/文件，不是 junction')
        : '缺失',
    });
    continue;
  }

  // Replace whatever sits there (plain dir left by an older install, stale link…)
  if (exists) {
    const st = fs.lstatSync(linkPath);
    if (st.isDirectory() && !st.isSymbolicLink()) {
      // Never rm -rf a real package directory without saying so.
      console.error(`  ! ${name} 处是实体目录，为安全起见不自动删除：${linkPath}`);
      console.error('    请手动确认后删除，再重跑本脚本。');
      skipped.push(name);
      continue;
    }
    fs.unlinkSync(linkPath);
  }
  fs.symlinkSync(target, linkPath, 'junction');
  fixed.push(name);
}

console.log(`link: 依赖 ${linkDeps.length} 个 —— 已就位 ${ok}，本次修复 ${fixed.length}` +
  (broken.length ? `，待修 ${broken.length}` : '') + (skipped.length ? `，跳过 ${skipped.length}` : ''));
for (const n of fixed) console.log(`  · 已建 junction：node_modules/${n}`);
for (const b of broken) console.log(`  ! 待修 ${b.name}：${b.reason}${apply ? '' : '（加 --apply 修复）'}`);
for (const n of skipped) console.log(`  ! 跳过 ${n}（需人工确认）`);

// Exit non-zero when something still needs fixing, so CI/bootstrap can gate on it.
if (broken.length > 0 || skipped.length > 0) process.exit(apply ? 1 : 0);
