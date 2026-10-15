/*
 * 壳卫生检查（②-C）
 *
 * 为什么存在
 * ----------
 * shell/ 是「面向使用者」的代码，跟 install.cmd / Release 同级。这里的典型
 * 事故不是逻辑错，而是**卫生问题**：
 *   - 本机绝对路径 / 用户名写进公开仓（D-028 起本仓公开，这是红线）；
 *   - 编码：shell 链路（nsi / bat / txt）一旦混入非 ASCII，在 936 代码页的
 *     机器上必然乱码——所以本链路全部源文件**必须是纯 ASCII**（用户可见的
 *     中文一律用 \uXXXX / HTML 实体）；
 *   - 借壳不借包的红线回潮：不明来源安装包的毒默认值
 *     （danger-full-access + approval: never）绝不能出现在本仓壳里；
 *   - 关窗即停后端是这个壳的验收契约，靠字符串标记锁住。
 *
 * 运行：node --test tools/tests/shell-hygiene.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const SHELL = join(ROOT, 'shell');

const read = (p) => readFileSync(p, 'utf8');

const SHELL_FILES = [
  'package.json', 'main.js', 'preload.js', 'startup-animation.cjs',
  'startup.html', 'startup.css', 'startup.js',
  'verify/observe.mjs',
];
const PACK_FILES = [
  'tools/pack-shell.mjs', 'tools/pack/installer.nsi',
];
const ALL_SOURCES = [
  ...SHELL_FILES.map((f) => [`shell/${f}`, join(SHELL, f)]),
  ...PACK_FILES.map((f) => [f, join(ROOT, f)]),
];

test('shell: app files exist and manifest is wired', () => {
  for (const f of SHELL_FILES) {
    assert.ok(existsSync(join(SHELL, f)), `missing shell/${f}`);
  }
  const pkg = JSON.parse(read(join(SHELL, 'package.json')));
  assert.equal(pkg.main, 'main.js');
  assert.equal(pkg.version, read(join(ROOT, 'VERSION')).trim(),
    'shell version must track the repo VERSION');
  assert.ok(pkg.devDependencies?.electron, 'electron must be pinned as devDependency');
});

test('shell: pure ASCII sources (936 codepage immunity)', () => {
  for (const [label, abs] of ALL_SOURCES.map(([l, a]) => [l, a])) {
    const text = readFileSync(abs, 'utf8');
    assert.ok(!text.includes('\uFEFF'), `${label} must not start with a BOM`);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      assert.ok(code < 128, `${label} has non-ASCII at offset ${i} `
        + `(use \\uXXXX escapes / HTML entities; found U+${code.toString(16)})`);
    }
  }
});

test('shell: no machine paths, usernames or foreign repo URLs', () => {
  const forbidden = [
    'PureEnglishPath', 'C:\\Users\\', 'C:/Users/', '苏阳SoYoung',
    '.workbuddy', 'Fairy-DSH-Fresh-Home', 'Fairy-DSH-Launch',
    'playinginzzz', 'Fairy-DSH-compat', 'MOSS-TTS',
    // the untrusted blueprint package must never be referenced by path
    'Fairy-完整安装包', 'Fairy-Original.exe',
  ];
  for (const [label, abs] of ALL_SOURCES.map(([l, a]) => [l, a])) {
    const text = readFileSync(abs, 'utf8');
    for (const bad of forbidden) {
      assert.ok(!text.includes(bad), `${label} contains forbidden string: ${bad}`);
    }
  }
});

test('shell: blueprint poison defaults stay out (borrow design, not config)', () => {
  for (const [label, abs] of ALL_SOURCES.map(([l, a]) => [l, a])) {
    const text = readFileSync(abs, 'utf8');
    assert.ok(!text.includes('danger-full-access'), `${label}: danger-full-access`);
    assert.ok(!text.includes('approval: never'), `${label}: approval: never`);
    assert.ok(!text.includes('never-ask'), `${label}: never-ask`);
  }
});

test('shell: lifecycle contract markers in main.js', () => {
  const main = read(join(SHELL, 'main.js'));
  // single instance
  assert.ok(main.includes('requestSingleInstanceLock()'), 'single instance lock');
  // kill only the pid we spawned, tree kill
  assert.ok(main.includes('taskkill /PID ${pid} /T /F'), 'owned-pid tree kill');
  // window-all-closed AND before-quit both stop the backend (close-the-window
  // contract: nothing keeps running after the window goes away)
  const wacIdx = main.indexOf("app.on('window-all-closed'");
  const bqIdx = main.indexOf("app.on('before-quit'");
  assert.ok(wacIdx > 0 && bqIdx > 0, 'quit hooks exist');
  for (const idx of [wacIdx, bqIdx]) {
    const tail = main.slice(idx, idx + 400);
    assert.ok(tail.includes('stopDsh()'), `quit hook at ${idx} stops the backend`);
  }
  // recovery before backend spawn
  assert.ok(main.includes('restore-link-deps.mjs'), 'first-run link recovery');
  // token never leaks into dialogs / logs
  assert.ok(main.includes("replace(/([?&]token=)[^\\s&#]+/g"), 'token redaction');
  // engine must never run as electron-node
  assert.ok(main.includes('delete env.ELECTRON_RUN_AS_NODE'), 'ELECTRON_RUN_AS_NODE scrub');
  // readiness gate: 303 + cookie exchange, bounded log tail
  assert.ok(main.includes("statusCode === 303"), 'httpReady gate');
  assert.ok(main.includes('65536'), 'bounded log tail for token capture');
  // renderer recovery: exactly one reload then fail
  assert.ok(main.includes('rendererRecoveryUsed'), 'renderer recovery flag');
  // data dir: portable fallback to LOCALAPPDATA
  assert.ok(main.includes('LOCALAPPDATA'), 'installed-mode data fallback');
  // external links leave the app
  assert.ok(main.includes('setWindowOpenHandler'), 'window-open handler');
});

test('shell: startup gate keeps its safety properties', () => {
  const anim = read(join(SHELL, 'startup-animation.cjs'));
  assert.ok(anim.includes('ENTRY_TIMEOUT_MS'), 'entry hard timeout constant');
  assert.ok(anim.includes('render-process-gone'), 'stalled renderer must release');
  assert.ok(anim.includes('did-fail-load'), 'failed load must release');
  // splash close = skip, not quit (hidden, so window-all-closed never fires early)
  assert.ok(anim.includes('event.preventDefault()'), 'close is hide+release');
});

test('shell: verify harness closes gracefully (WM_CLOSE, not /F)', () => {
  const observe = read(join(SHELL, 'verify', 'observe.mjs'));
  assert.ok(observe.includes("'taskkill', ['/PID', String(shellPid)]"),
    'graceful close of the shell');
  assert.ok(observe.includes('VERDICT.json'), 'verdict artifact');
});

test('pack: junction stripping + checksums + official-source guards', () => {
  const pack = read(join(ROOT, 'tools', 'pack-shell.mjs'));
  assert.ok(pack.includes('junctions to strip'), 'strips the link: junctions');
  assert.ok(pack.includes('symlinks survived staging'), 'post-copy symlink assertion');
  assert.ok(pack.includes('Fairy-DSH-Fresh.exe'), 'renames electron.exe');
  assert.ok(pack.includes('/^v22\\./'), 'bundled node must be Node 22');
  assert.ok(pack.includes('SHA256SUMS.txt'), 'checksum artifact');
  assert.ok(pack.includes('restore-link-deps.mjs'), 'documents first-run recovery');
});

test('pack: installer defaults to the preferred install root and uninstalls', () => {
  const nsi = read(join(ROOT, 'tools', 'pack', 'installer.nsi'));
  assert.ok(nsi.includes('RequestExecutionLevel admin'), 'admin for Program Files');
  assert.ok(nsi.includes('InstallDir "D:\\Program Files\\Fairy-DSH-Fresh"'),
    'preferred default dir');
  assert.ok(nsi.includes('WriteUninstaller'), 'uninstaller exists');
  assert.ok(nsi.includes('${UNINSTKEY}'), 'uninstall registry key');
  assert.ok(nsi.includes('fairy-eye.ico'), 'shortcuts use the Fairy eye icon');
});
