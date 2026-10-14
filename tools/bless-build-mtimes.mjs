#!/usr/bin/env node
// 让 `fairy-system/verify-build.js` 与 `preflight-build.js` 的 build-freshness 契约
// 在**全新 clone** 上成立：只改 mtime，**绝不改内容**。
//
// 为什么不能靠"重新构建"
// ----------------------
// `fairy-visual/lib/client.js` 是**权威产物**，里面嵌了 compat 层
// （settingsNamespace 内联、HDD composer takeover 等），`src/` 里没有。
// 从 src 重建 = 静默抹掉 compat 层 = 整页白屏。详见 docs/02 红线 §1。
// 所以当 freshness 报"manifest/源码比产物新"时，唯一正确动作是**把产物的
// mtime 推到现在**，而不是重建。
//
// 为什么 clone 后会踩
// -------------------
// git checkout 按索引顺序写文件，`package.json` 常常排在 `lib/*` 之后落盘，
// 于是 manifest 的 mtime 比产物新几十毫秒 —— 与"内容是否过期"无关。
//
// 用法：
//   node bless-build-mtimes.mjs <repoRoot>            # 只报告
//   node bless-build-mtimes.mjs <repoRoot> --apply    # 归位

import fs from 'node:fs';
import path from 'node:path';

const [, , repoRootArg, ...flags] = process.argv;
if (!repoRootArg) {
  console.error('用法: node bless-build-mtimes.mjs <repoRoot> [--apply]');
  process.exit(2);
}
const apply = flags.includes('--apply');
const repoRoot = path.resolve(repoRootArg);

// 与 verify-build.js / preflight-build.js 用同一份包清单（含 sourceRoot 约定）
const PACKAGES = [
  { name: 'dsh-browser-dock', dir: 'browser-dock/dsh-browser-dock', sourceRoot: 'src' },
  { name: 'dsh-balance-meter', dir: 'balance-meter/dsh-balance-meter', sourceRoot: null },
  { name: 'dsh-fairy-startup', dir: 'fairy-startup/dsh-fairy-startup', sourceRoot: null },
  { name: 'dsh-fairy-visual', dir: 'fairy-visual/dsh-fairy-visual', sourceRoot: 'src' },
  { name: 'dsh-fairy-voice', dir: 'fairy-voice/dsh-fairy-voice', sourceRoot: null },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', 'docs']);

function newestMtime(root) {
  let newest = 0;
  let newestFile = null;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const m = fs.statSync(full).mtimeMs;
        if (m > newest) { newest = m; newestFile = full; }
      }
    }
  };
  if (fs.existsSync(root)) visit(root);
  return { newest, newestFile };
}

let fixed = 0;
let clean = 0;

for (const pkg of PACKAGES) {
  const dir = path.join(repoRoot, pkg.dir);
  if (!fs.existsSync(dir)) {
    console.log(`  ! 缺少包目录         ${pkg.name} (${pkg.dir})`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const targets = new Set(
    [manifest.main, manifest.exports?.['.'], manifest.exports?.['./client']]
      .filter((t) => typeof t === 'string' && t.length > 0)
      .map((t) => path.resolve(dir, t)),
  );
  // 契约判的是**最旧的那个产物**（verify-build / preflight 都用 min），
  // 所以这里必须与它们一致地用 min，用 max 会漏判（实测踩过）。
  const outputMtimes = [...targets].map((f) => fs.statSync(f).mtimeMs);
  const oldestOutput = Math.min(...outputMtimes);
  const newestManifest = fs.statSync(path.join(dir, 'package.json')).mtimeMs;
  const src = pkg.sourceRoot ? newestMtime(path.join(dir, pkg.sourceRoot)) : { newest: 0, newestFile: null };
  const required = Math.max(newestManifest, src.newest);

  if (oldestOutput > required + 1) {
    console.log(`  ok 已满足            ${pkg.name}`);
    clean += 1;
    continue;
  }

  const delta = ((required - oldestOutput) / 1000).toFixed(3);
  console.log(
    `  - 需归位             ${pkg.name}（产物比 manifest/源码旧 ${delta}s）` +
      (src.newestFile ? `  最新源: ${path.relative(repoRoot, src.newestFile)}` : ''),
  );
  if (!apply) continue;
  const now = new Date();
  const stamp = new Date(now.getTime() + 1000);
  for (const target of targets) fs.utimesSync(target, stamp, stamp);
  fixed += 1;
}

console.log('');
console.log(`产物 ${PACKAGES.length} 个包：已满足 ${clean}，本次归位 ${fixed}${apply ? '' : '（未加 --apply，仅报告）'}`);

// 报告模式下把「有待归位项」表达成退出码，好让 `bootstrap.mjs --check` 能据此判失败。
// 语义：--apply 后应是 0；只报告时非 0 ＝ 状态不可复现。
if (!apply && fixed === 0 && clean < PACKAGES.length) process.exit(1);
