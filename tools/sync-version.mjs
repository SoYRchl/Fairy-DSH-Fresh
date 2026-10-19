/*
 * 版本号同步器 —— 让版本只有一个来源
 *
 * 背景（为什么需要它）
 * --------------------
 * 版本号曾经散在多处，发版时至少 3 处要手工同步：
 *   · VERSION 文件                        （唯一真源，如 0.1.0-alpha.5）
 *   · fairy-visual/lib/client.js 的设置页声明行（"当前版本 v..."）
 *   · lib/settings-merge.ps1 的后缀常量     （旧 -compat.N 时代的遗留）
 *   · 各包 package.json 的 version          （各包独立，不参与发布版本）
 *
 * 真实发生过的事故：client.js 里的版本停在 v0.1.0-alpha.3，而包已经是
 * alpha.5 —— 使用者看到的是错的版本号。
 *
 * ⚠️ 版本线已从 "裸三段 + -compat.N"（0.3.8-compat.1）改成独立的
 *    预发布版本线（0.1.0-alpha.5）。本脚本随之改成：**VERSION 写什么，
 *    设置页就显示什么**，不再拼接任何后缀。
 *
 * 用法：
 *   node tools/sync-version.mjs            # 报告当前状态，不写文件
 *   node tools/sync-version.mjs --write    # 按 VERSION 同步
 *
 * 编码契约（必须遵守，否则会制造噪音 diff 或弄坏脚本）：
 *   · client.js 是 **UTF-8 无 BOM**、**LF** 换行 —— 原样保留
 *   · lib/settings-merge.ps1 需要 **BOM**（PowerShell 5.1 + CP936）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const CLIENT = join(ROOT, 'fairy-visual', 'dsh-fairy-visual', 'lib', 'client.js');
const MERGE_PS1 = join(ROOT, 'lib', 'settings-merge.ps1');
const VERSION_FILE = join(ROOT, 'VERSION');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');

const readText = (p) => readFileSync(p, 'utf8');
const log = (s) => process.stdout.write(s + '\n');

// ---------- 读取当前状态 ----------
const baseline = readText(VERSION_FILE).trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(baseline)) {
  log(`ERROR: VERSION 文件内容不是合法语义化版本号（可带预发布后缀）：'${baseline}'`);
  process.exit(2);
}

const clientSrc = readText(CLIENT);
// 设置页声明行形态：'当前版本 v0.1.0-alpha.5 · Fairy-DSH-Fresh 独立桌面壳（…）'
const NOTICE_RE = /当前版本 v([^ ·\u00b7]+)/;
const noticeMatch = clientSrc.match(NOTICE_RE);
if (!noticeMatch) {
  log('ERROR: 在 client.js 里找不到「当前版本 v…」声明行');
  process.exit(2);
}
const currentLocal = noticeMatch[1];

let mergeSrc = '';
let currentSuffix = '(文件不存在)';
try {
  mergeSrc = readText(MERGE_PS1);
  const suffixMatch = mergeSrc.match(/(\$localVersionSuffix\s*=\s*')([^']*)(')/);
  currentSuffix = suffixMatch ? suffixMatch[2] : '(找不到常量)';
} catch {
  mergeSrc = '';
}

let tag = '(无 tag)';
try {
  tag = execFileSync('git', ['-C', ROOT, 'describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();
} catch { /* 无 tag 不算错误 */ }

// ---------- 目标值 ----------
const target = baseline;            // 唯一真源，不拼后缀
const targetSuffix = '';            // 旧 -compat.N 后缀已废弃

log('当前状态');
log(`  VERSION 文件                  : ${baseline}`);
log(`  client.js 设置页版本          : ${currentLocal}`);
log(`  settings-merge 后缀常量       : '${currentSuffix}'`);
log(`  最新 git tag                  : ${tag}`);
log(`  ---> 目标版本                 : ${target}`);

const problems = [];
if (currentLocal !== target) problems.push(`client.js 设置页版本应为 '${target}'，实为 '${currentLocal}'`);
if (currentSuffix !== '(文件不存在)' && currentSuffix !== '(找不到常量)' && currentSuffix !== targetSuffix) {
  problems.push(`settings-merge 的 \$localVersionSuffix 应为 '${targetSuffix}'（该后缀已废弃），实为 '${currentSuffix}'`);
}
if (tag !== '(无 tag)' && tag !== `v${target}` && tag !== target) {
  problems.push(`最新 tag ${tag} 与目标 v${target} 不同 —— 同步后需 git tag v${target}`);
}

if (problems.length === 0) {
  log('\nOK: 所有来源已一致。');
  process.exit(0);
}

log('\n发现不一致：');
for (const p of problems) log(`  · ${p}`);

if (!WRITE) {
  log('\n（只报告，未改动。加 --write 同步）');
  process.exit(1);
}

// ---------- 写回（保持各文件的编码契约） ----------
function writePreserving(file, text, { bom }) {
  const buf = readFileSync(file);
  const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const crlf = buf.includes(Buffer.from('\r\n'));
  let out = text.replace(/\r?\n/g, '\n');
  if (crlf) out = out.replace(/\n/g, '\r\n');
  const enc = bom ?? hadBom;
  writeFileSync(file, Buffer.concat([enc ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(out, 'utf8')]));
}

let changed = 0;

if (currentLocal !== target) {
  const next = clientSrc.replace(NOTICE_RE, `当前版本 v${target}`);
  writePreserving(CLIENT, next, { bom: false });
  log(`  已写: client.js 设置页版本 -> '${target}'`);
  changed += 1;
}

if (mergeSrc && currentSuffix !== '(找不到常量)' && currentSuffix !== targetSuffix) {
  const next = mergeSrc.replace(/(\$localVersionSuffix\s*=\s*')[^']*(')/, `$1${targetSuffix}$2`);
  writePreserving(MERGE_PS1, next, { bom: true });
  log(`  已写: settings-merge.ps1 后缀 -> '${targetSuffix}'`);
  changed += 1;
}

log(`\n完成，改动 ${changed} 个文件。`);
log('下一步：git add -A && git commit -m "release: v' + target + '" && git tag v' + target);
