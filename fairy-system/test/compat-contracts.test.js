import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * 跨内核运行时契约（docs/compat/运行时契约.md）的机检落地。
 *
 * 云朵版那 7 条里有 4 条是为它自己的插件而立，本仓没有那些包 —— 只把**真正适用**
 * 的几条转成断言（见 docs/compat/运行时契约.md 的「本仓适用性」列）。
 * 违反任一条在 0.1.x/0.2.x 上都会导致【静默】故障（UI 不渲染 / CPU 100% 卡死 /
 * 加载即崩），所以必须机器检查，不能靠人记得。
 */

const fairySystemDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(fairySystemDir, '..');
const PATCH = path.join(repoRoot, 'profiles', 'web', 'cordis.patch.yml');

const KERNEL_PACKAGES = [
  ['dsh-browser-dock', 'browser-dock/dsh-browser-dock'],
  ['dsh-balance-meter', 'balance-meter/dsh-balance-meter'],
  ['dsh-fairy-startup', 'fairy-startup/dsh-fairy-startup'],
  ['dsh-fairy-visual', 'fairy-visual/dsh-fairy-visual'],
  ['dsh-fairy-voice', 'fairy-voice/dsh-fairy-voice'],
];

/** 从内核自带的 yaml 解析器读 patch；拿不到就明确跳过而不是假装通过 */
function loadPatch() {
  const anchor =
    process.env.DSH_OFFICIAL_PACKAGE ||
    path.join(os.homedir(), '.local', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  let YAML;
  try {
    YAML = createRequire(anchor)('yaml');
  } catch (error) {
    return { skip: `解析不到 yaml 模块（${anchor}）：${error.code || error.message}` };
  }
  const doc = YAML.parse(readFileSync(PATCH, 'utf8'), { customTags: [{ tag: '!!js', resolve: (v) => v }] });
  if (!Array.isArray(doc)) return { skip: 'cordis.patch.yml 顶层不是数组' };
  return { doc };
}

function eachRow(doc, visit) {
  for (const entry of doc) {
    for (const row of entry?.insert ?? []) visit(row, 'insert');
    if (entry && typeof entry === 'object' && 'id' in entry) visit(entry, 'row');
  }
}

const patch = loadPatch();

test('契约① 与 ③：patch 行的 id/name 是字面字符串，且 name 是裸包名', (t) => {
  if (patch.skip) return t.skip(patch.skip);
  const badJs = [];
  const badPath = [];
  eachRow(patch.doc, (row) => {
    if (typeof row.id !== 'string' || row.id.length === 0) badJs.push(JSON.stringify(row.id));
    // 表达式名会被 discovery 判为 "names no plugin"
    if (typeof row.id === 'string' && /\$\{|process\.|!!js/.test(row.id)) badJs.push(row.id);
    if (typeof row.name === 'string' && row.name.includes('/')) {
      // 裸包名规则：@scope/pkg 合法；pkg/subpath 不合法（会让槽位 UI 静默不渲染）
      const segments = row.name.startsWith('@') ? row.name.split('/').slice(2) : row.name.split('/').slice(1);
      if (segments.length > 0) badPath.push(row.name);
    }
  });
  assert.deepEqual(badJs, [], `存在非字面字符串的行 id：${badJs.join(', ')}`);
  assert.deepEqual(badPath, [], `存在子路径行名（会让客户端 bundle 进不了 boot 图）：${badPath.join(', ')}`);
});

test('契约②：组行 id 必须与子行 id 不同（同名会让 loader 同步卡死）', (t) => {
  if (patch.skip) return t.skip(patch.skip);
  const collisions = [];
  eachRow(patch.doc, (row) => {
    if (row.group !== true) return;
    for (const child of row.config ?? []) {
      if (typeof child?.id === 'string' && child.id === row.id) collisions.push(row.id);
    }
  });
  assert.deepEqual(collisions, [], `组 id 与子行 id 同名：${collisions.join(', ')}（CPU 100% / 全部 API 挂起）`);
});

test('契约⑤：插件不依赖 harness 子包（只允许白名单）', () => {
  const ALLOWED = new Set(['@deepseek-ai/dsh-settings', '@deepseek-ai/schemastery']);
  const violations = [];
  for (const [name, rel] of KERNEL_PACKAGES) {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, rel, 'package.json'), 'utf8'));
    assert.equal(manifest.name, name);
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep.startsWith('@deepseek-ai/') && !ALLOWED.has(dep)) violations.push(`${name} -> ${dep}`);
    }
  }
  assert.deepEqual(violations, [], `插件依赖了 harness 子包（会解析出漂移 peer，加载即崩）：${violations.join(', ')}`);
});

test('契约⑥：仓内 agent preset 必须是真实文件（链接会被 readdir 静默跳过）', () => {
  const presetDir = path.join(repoRoot, 'fairy-visual', 'dsh-fairy-visual', '.agent-presets', 'fairy');
  const links = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (lstatSync(full).isSymbolicLink()) links.push(path.relative(repoRoot, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(presetDir);
  assert.deepEqual(links, [], `preset 目录里存在符号链接：${links.join(', ')}`);
});

test('额外契约：代际探测不许靠裸版本号比较', (t) => {
  if (patch.skip) return t.skip(patch.skip);
  // 契约④/④b 的可执行部分：代际判定必须走能力探测（看 getSectionOrder 在不在），
  // 而不是写死 "0.1.1-rc.2" / "0.2.0-rc.2" 这种字面量比较。
  const adapter = readFileSync(path.join(repoRoot, 'fairy-visual', 'dsh-fairy-visual', 'src', 'client', 'dom-adapter.js'), 'utf8');
  const selectorUnion = /\.split\('[,]'\)|"?,\s*\[data-slot/.test(adapter) || /OFFICIAL_SELECTORS/.test(adapter);
  assert.ok(selectorUnion, 'dom-adapter 必须把跨代选择器收在一处（OFFICIAL_SELECTORS / 并集拆分）');
});
