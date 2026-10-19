/*
 * 发布卫生检查
 *
 * 为什么存在
 * ----------
 * 本仓库是"分发仓库"：真正面向用户的是 Release 附件与两个安装器。
 * 这类仓库的典型事故不是逻辑错，而是**卫生问题**——编码坏了、URL 指错、
 * 版本号写死在两处、附件名带了版本号导致 404。这些此前全靠人工记得。
 *
 * 这个文件把它们变成断言。每一条都对应一次已经真实发生过的事故
 * （见注释里的 commit 号）。
 *
 * 运行：node --test tools/tests/release-hygiene.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');

/* 本仓库自身。原值 SoYRchl/Fairy-DSH-Fresh 是上游 compat fork，
 * 已不再作为本仓身份（本仓为独立整合仓，见 README 血缘一节）。 */
const OWNER_REPO = 'SoYRchl/Fairy-DSH-Fresh';
const UPSTREAM_REPO = 'Guzhou2002/Fairy-DSH-Optimized';

const read = (p) => readFileSync(p, 'utf8');
const readBytes = (p) => readFileSync(p);
const hasBom = (buf) =>
  buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

/* ------------------------------------------------------------------ *
 * 1. 编码：`.ps1` 必须带 UTF-8 BOM
 *
 * 事故：一次 URL 替换让 lib/settings-merge.ps1 丢了 BOM，
 * PowerShell 5.1 按 GBK 解码 → 中文变 `鍚堝苟` → **脚本无法解析**。
 * 本机 936 代码页下这是必然结果，不是概率问题。
 * ------------------------------------------------------------------ */
test('.ps1 必须带 UTF-8 BOM（PowerShell 5.1 + CP936 靠 BOM 判定编码）', () => {
  const missing = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'release', 'snapshots'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ps1') && !hasBom(readBytes(full))) {
        missing.push(full.slice(ROOT.length + 1));
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(
    missing,
    [],
    `以下 .ps1 缺少 BOM，PowerShell 会解析失败：\n  ${missing.join('\n  ')}`,
  );
});

/* ------------------------------------------------------------------ *
 * 2. `.cmd` 的编码契约
 *
 * 这三种形态都**合法**（都经实测确认）：
 *   A) 纯 ASCII、无 BOM
 *      纯启动器，只负责转发给同名 .ps1。uninstall.cmd / verify.cmd 属于这类。
 *   B) GBK（CP936）、无 BOM，含中文，并在开头 `chcp 936`
 *      安装器用这类：cmd.exe 在 936 代码页下直接读 GBK 字节，中文正常。
 *      install.cmd / install_full.cmd 属于这类。
 *   C) UTF-16LE **带 BOM**
 *      cmd.exe 能识别 UTF-16LE BOM，同样能显示中文。
 *
 * 这两种形态**禁止**：
 *   ✗ UTF-8 **带 BOM** —— cmd.exe 不识别，会把 BOM 字节当命令执行
 *   ✗ UTF-8 **无 BOM 且含非 ASCII** —— 最坏组合：
 *     cmd.exe 在 CP936 下按 GBK 解读 UTF-8 字节，中文必然乱码
 *
 * ⚠️ 血的教训（真实事故，本仓库发生过）：
 *   commit b9ecc9e 为了改下载 URL，把这两个 .cmd 按 UTF-8 读进来又写回去。
 *   GBK 的中文字节被当成非法 UTF-8 → 每个字变成 U+FFFD（**永久丢失**，
 *   不是显示问题）→ e617f7a 又把损坏文本转成 UTF-16LE+BOM，把 1646 / 1800
 *   个替换字符固化进产物。用户看到的是乱码，且**原文已无法从该版本恢复**。
 *   所以下面第 3 条专门盯 U+FFFD。
 * ------------------------------------------------------------------ */
test('.cmd 不得是「UTF-8 带 BOM」或「UTF-8 无 BOM 却含非 ASCII」', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'release', 'snapshots'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.cmd')) {
        const buf = readBytes(full);
        const rel = full.slice(ROOT.length + 1);
        const isUtf16Bom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
        if (isUtf16Bom) continue; // 合法形态 C
        const isUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
        if (isUtf8Bom) {
          offenders.push(`${rel}: UTF-8 BOM —— cmd.exe 不识别，会把它当命令执行`);
          continue;
        }
        // 无 BOM：要么纯 ASCII（形态 A），要么 GBK（形态 B）。
        // 这里只拒绝「像 UTF-8 却无 BOM」的情况：含非 ASCII 且能按 UTF-8 解出中文。
        let nonAscii = 0;
        for (const b of buf) if (b > 127) nonAscii++;
        if (nonAscii === 0) continue; // 形态 A
        const asUtf8 = buf.toString('utf8');
        const looksLikeUtf8 = !asUtf8.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(asUtf8);
        if (looksLikeUtf8) {
          offenders.push(
            `${rel}: 无 BOM 但内容是 UTF-8 中文 —— CP936 下会乱码。` +
              `请改为 GBK 并在开头加 chcp 936，或改为 UTF-16LE+BOM`,
          );
        }
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, [], offenders.join('\n  '));
});

test('.cmd 不得含替换字符 U+FFFD（编码损坏的永久痕迹）', () => {
  const problems = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'release', 'snapshots'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.cmd')) {
        const buf = readBytes(full);
        const rel = full.slice(ROOT.length + 1);
        const u16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
        const u8b = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

        let text;
        if (u16) text = buf.subarray(2).toString('utf16le');
        else if (u8b) text = buf.subarray(3).toString('utf8');
        else {
          // 无 BOM：先看是不是完整的 UTF-8（合法形态 B 的反面），
          // 否则视为 GBK（本仓库安装器的实际编码，配合 chcp 936）。
          const asUtf8 = buf.toString('utf8');
          const utf8Broken = asUtf8.includes('\uFFFD');
          text = utf8Broken ? buf.toString('latin1') : asUtf8;
        }

        const bad = (text.match(/\uFFFD/g) || []).length;
        if (bad > 0) {
          problems.push(
            `${rel}: 含 ${bad} 个 U+FFFD —— 中文字节曾被按错误编码读取并回写，` +
              `内容已永久丢失（见 b9ecc9e 事故）。必须从最后一个完好版本重建，改编码救不回来。`,
          );
        }
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(problems, [], problems.join('\n  '));
});

/* ------------------------------------------------------------------ *
 * 3. 所有"检查更新"类 URL 必须指向本仓库
 *
 * 事故：成品代码里硬编码了 upstream 的 Releases API 与 MOSS 说明地址，
 * 于是设置面板的「检查更新」查的是孤舟版的版本号，「点这里去下载」
 * 会把用户引导去装**不含跨内核兼容**的版本。
 * ------------------------------------------------------------------ */
test('代码中的仓库 URL 必须指向本仓库（不能指向上游）', () => {
  const files = [
    'lib/settings-merge.ps1',
    'fairy-visual/dsh-fairy-visual/lib/client.js',
    'fairy-voice/dsh-fairy-voice/lib/index.js',
  ];
  const offenders = [];
  for (const rel of files) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const src = read(p);
    if (src.includes(UPSTREAM_REPO)) {
      offenders.push(`${rel} 仍引用上游仓库 ${UPSTREAM_REPO}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

/* ------------------------------------------------------------------ *
 * 5. 版本号必须能被推导出来，而不是散落硬编码
 *
 * 现状缺陷：版本有 5 个来源 —— VERSION 文件、client.js 的 LOCAL_VERSION、
 * git tag、各包 package.json、Release 标题。发版时至少 3 处要手工同步，
 * 漏一处就是更新提示或版本显示出错（第 4 条测试修的就是这个后果）。
 * ------------------------------------------------------------------ */
test('VERSION 文件存在且是合法语义化版本号（可带 -alpha 等预发布后缀）', () => {
  const v = read(join(ROOT, 'VERSION')).trim();
  assert.match(v, /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/, `VERSION="${v}" 应为语义化版本号（如 0.1.0-alpha）`);
});

/* [2026-10-19] 设置页那一行是**构建时烤进产物的字符串**，同步器只跑一次就会再次漂移。
 * 真实事故：包已经是 0.1.0-alpha.5，设置页还显示 0.1.0-alpha.3 —— 使用者看到错的版本，
 * 报障时我们对不上号。把「显示版本 == VERSION」变成机器检查，改漏一处就红。 */
test('设置页显示的版本必须与 VERSION 文件一致', () => {
  const v = read(join(ROOT, 'VERSION')).trim();
  const client = read(join(ROOT, 'fairy-visual/dsh-fairy-visual/lib/client.js'));
  const m = client.match(/当前版本 v([^ ·\u00b7]+)/);
  assert.ok(m, 'client.js 里应能找到「当前版本 v…」声明行（同步器 tools/sync-version.mjs 依赖它）');
  assert.equal(m[1], v, `设置页显示 v${m[1]}，而 VERSION 是 ${v} —— 跑 node tools/sync-version.mjs --write`);
});

/* ------------------------------------------------------------------ *
 * 6. 更新检查引用的 API 地址必须含本仓库名
 * ------------------------------------------------------------------ */
/* [T-112] 反向守卫：更新检查已整条移除，任何"指向外部仓的更新检查"重新出现都要在这儿变红。
 * 背景：原实现查的是上游 compat fork 的 releases/latest，并把「打开仓库」链到那个仓；
 * 它既不是本仓，也没有对外发布渠道 —— 拿它比版本必然得出错误结论。 */
test('运行时代码里不得再出现更新检查 / 外部仓地址', () => {
  const runtime = [
    'fairy-visual/dsh-fairy-visual/lib/client.js',
    'fairy-voice/dsh-fairy-voice/lib/index.js',
    /* [公开前清理] 生成器此前不在清单里 —— client.js 是它产出的，
     * 只查产物等于只查结果不查源头：重新生成一次，删掉的外仓信息就会复活。 */
    'lib/settings-merge.ps1',
  ];
  for (const rel of runtime) {
    const src = read(join(ROOT, rel));
    for (const banned of [/api\.github\.com\/repos\//, /github\.com\/playinginzzz/, /raw\.githubusercontent\.com\/playinginzzz/]) {
      assert.ok(!banned.test(src), `${rel} 仍引用外部仓（${banned}）—— 会把使用者引到错误的版本序列`);
    }
  }
  // 宿主侧必须显式停用，而不是留一个能联网的默认值
  const voice = read(join(ROOT, 'fairy-voice/dsh-fairy-voice/lib/index.js'));
  assert.match(voice, /UPDATE_RELEASES_API\s*=\s*null/, 'UPDATE_RELEASES_API 应为 null（已停用）');
});

/* ------------------------------------------------------------------ *
 * 7. 每个包只能有一个 lock 文件
 *
 * 现状缺陷：fairy-voice 同时带 package-lock.json 与 pnpm-lock.yaml，
 * 两个包管理器并存，安装行为取决于谁最后跑过。
 * ------------------------------------------------------------------ */
test('每个包只能有一个 lock 文件（不能 npm 与 pnpm 并存）', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'release', 'snapshots'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === 'package-lock.json') {
        const sibling = join(dir, 'pnpm-lock.yaml');
        if (existsSync(sibling)) offenders.push(full.slice(ROOT.length + 1));
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, [], `以下目录同时存在 npm 与 pnpm 锁文件：\n  ${offenders.join('\n  ')}`);
});

/* ------------------------------------------------------------------ *
 * 8. 包目录名应与包名一致（允许已记录的例外）
 *
 * 不一致会干扰自动化遍历：`fairy-voice/dsh-fairy-voice`（目录带前缀）
 * vs `fairy-contracts`（裸目录，包名却是 dsh-fairy-contracts）。
 *
 * `fairy-contracts` 这个例外**不能靠改名消除**：browser-dock 直接
 * `require('dsh-fairy-contracts/client-diagnostics')`，并在
 * tsdown.config.ts 里按包名打包，改名会破坏构建。所以这里记录它，
 * 并保证不再新增不一致。
 *
 * `profiles/web` 同理不能靠改名消除：目录名 `web` 就是 DSH 的 profile 名
 * （`--profile web` / cordis 按目录名解析 profile），改目录名会让 profile
 * 失效；而包名带 `dsh-` 前缀是发布域的既有约定。故按相对路径登记为例外
 * （而非泛化的 `web`，避免将来别的 `web` 目录被误放行）。
 * ------------------------------------------------------------------ */
const KNOWN_DIR_NAME_EXCEPTIONS = new Set([
  // 目录名 / 相对路径 → 包名（有意不一致，改名会破坏构建或 profile 解析）
  'fairy-contracts',
  'profiles/web',
  // fairy-compat 与 fairy-contracts 同理：顶层单层目录（不是 <组>/<包> 两层），
  // 目录名去掉 dsh- 前缀就是包名。它是兼容层骨架，不随插件组发布。
  'fairy-compat',
  // shell/ 是 ②-C 独立桌面壳：不随插件组发布，打包时整目录拷进
  // resources/app（目录名 shell 由 tools/pack-shell.mjs 引用，改名要同步两处）。
  'shell',
]);

test('包目录名应与 package.json 的 name 一致（例外已记录）', () => {
  const mismatches = [];
  const checkPkg = (dir) => {
    const pj = join(dir, 'package.json');
    if (!existsSync(pj)) return;
    const { name } = JSON.parse(read(pj));
    const base = dir.slice(ROOT.length + 1);
    const baseNorm = base.split(/[\\/]/).join('/');
    const last = baseNorm.split('/').pop();
    if (
      last !== name &&
      !KNOWN_DIR_NAME_EXCEPTIONS.has(last) &&
      !KNOWN_DIR_NAME_EXCEPTIONS.has(baseNorm)
    ) {
      mismatches.push(`${base}  →  name: ${name}`);
    }
  };
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'release', 'snapshots', 'vendor', 'test', 'src', 'lib'].includes(e.name)) continue;
      if (e.isDirectory()) {
        const full = join(dir, e.name);
        checkPkg(full);
        walk(full, depth + 1);
      }
    }
  };
  checkPkg(ROOT);
  walk(ROOT);
  assert.deepEqual(
    mismatches,
    [],
    `以下目录名与包名不一致（若要新增，请连同理由写进 KNOWN_DIR_NAME_EXCEPTIONS）：\n  ${mismatches.join('\n  ')}`,
  );
});

/* ------------------------------------------------------------------ *
 * 9. 安装脚本必须存在（README 靠这些永久地址引导用户）
 * ------------------------------------------------------------------ */
test('安装/卸载脚本与永久下载地址所需的文件都在', () => {
  for (const f of ['install.cmd', 'install_full.cmd', 'uninstall.cmd', 'uninstall.ps1', 'verify.cmd', 'verify-isolated.ps1']) {
    assert.ok(existsSync(join(ROOT, f)), `缺少 ${f} —— README 的 latest/download 链接会 404`);
  }
});

/* ------------------------------------------------------------------ *
 * 10. 不得把构建产物提交进历史
 * ------------------------------------------------------------------ */
test('release/ 产物不得被跟踪（会让仓库每次发版膨胀）', () => {
  const gi = read(join(ROOT, '.gitignore'));
  assert.match(gi, /^release\/$/m, '.gitignore 里必须忽略 release/');
  assert.match(gi, /^\*\.tgz$/m, '.gitignore 里必须忽略 *.tgz');
});
