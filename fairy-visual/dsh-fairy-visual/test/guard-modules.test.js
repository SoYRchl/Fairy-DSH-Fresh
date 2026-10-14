import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * T-109 验收：守卫模块必须**同时**存在于 src 与两个产物里，且产物侧真的接上了线。
 *
 * 为什么要在测试里钉产物
 * ----------------------
 * `lib/client.js` 是权威产物，比 tsdown 原始产物 `lib/index.iife.js` 多 823 行
 * 本地/compat 补丁；而 `package.json` 的 `bundle` 脚本是
 * `tsdown && cp lib/index.iife.js lib/client.js` —— 也就是说**只要有人跑一次
 * `pnpm bundle`，client.js 里所有手工补丁都会被静默覆盖**。
 * 这条测试把「补丁必须在」变成机器检查，而不是靠人记得。
 * （对应 07 §C-2「产物指纹校验」，先落在守卫模块这一小块上。）
 */

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const srcAnchor = read('../src/client/chat-content-anchor.js');
const srcScroll = read('../src/client/scroll-position-guard.js');
const srcDecision = read('../src/client/decision-pointer-guard.js');
const srcComposerDock = read('../src/client/composer-dock.js');
const srcIndex = read('../src/client/index.js');
const client = read('../lib/client.js');
const iife = read('../lib/index.iife.js');

test('两个守卫模块以 src 形态存在，且保留出处标记', () => {
  assert.match(srcScroll, /captureScrollPositions/, 'scroll-position-guard 导出缺失');
  assert.match(srcScroll, /restoreScrollPositions/, 'scroll-position-guard 导出缺失');
  assert.match(srcDecision, /createDecisionPointerGuard/, 'decision-pointer-guard 导出缺失');
  for (const [name, text] of [['scroll-position-guard.js', srcScroll], ['decision-pointer-guard.js', srcDecision]]) {
    assert.match(text, /\[T-109\]/, `${name} 缺少并入出处与审计标记`);
  }
});

test('src 侧接线完整（composer-dock 三处 + index 一处）', () => {
  assert.match(srcComposerDock, /require\('\.\/scroll-position-guard\.js'\)/, 'composer-dock 未 require scroll guard');
  assert.match(srcComposerDock, /captureScrollPositions\(conversationScrolls\(currentConversation\)\)/, 'composer-dock 未调用 capture');
  assert.match(srcComposerDock, /restoreScrollPositions\(scrollPositionSnapshot\)/, 'composer-dock 未调用 restore');
  assert.match(srcIndex, /require\('\.\/decision-pointer-guard\.js'\)/, 'index 未 require decision guard');
  assert.match(srcIndex, /decisionGuard\.dispose\(\)/, 'index 未挂 decision guard 的 dispose');
});

test('两个产物的 region 与接线都必须在（防止 bundle 静默抹掉）', () => {
  for (const [label, text] of [['lib/client.js', client], ['lib/index.iife.js', iife]]) {
    assert.match(text, /\/\/#region src\/client\/scroll-position-guard\.js/, `${label} 缺 scroll guard region`);
    assert.match(text, /\/\/#region src\/client\/decision-pointer-guard\.js/, `${label} 缺 decision guard region`);
    assert.match(text, /require_scroll_position_guard\(\)/, `${label} 缺 scroll guard require`);
    assert.match(text, /require_decision_pointer_guard\(\)/, `${label} 缺 decision guard require`);
    assert.ok(
      text.includes('restoreScrollPositions(scrollPositionSnapshot);'),
      `${label} 缺 scroll guard 的 restore 调用`,
    );
    assert.ok(
      text.includes('ctx.effect(() => () => decisionGuard.dispose()'),
      `${label} 缺 decision guard 的 dispose 接线`,
    );
  }
});

test('lib/client.js 仍带着 iife.js 里没有的本地/compat 补丁（未被 fmt/重建抹掉）', () => {
  // iife.js 是 tsdown 的干净产物；client.js 额外多出 823 行手工补丁。
  // 断言方向：这些补丁**必须还在 client.js 里**（bundle 脚本会把 client.js 覆盖成 iife.js）。
  const iifeLines = new Set(iife.split('\n'));
  const onlyInClient = client
    .split('\n')
    .filter((line) => line.trimStart().startsWith('// [local patch') && !iifeLines.has(line));
  assert.ok(
    onlyInClient.length >= 10,
    `client.js 里只剩 ${onlyInClient.length} 行 local patch 标记 —— 疑似被 bundle 覆盖过`,
  );
  assert.ok(client.split('\n').length > iife.split('\n').length, 'client.js 应当比 iife.js 更长');
  // 两边 region 名称集合必须一致（否则注入时按 region 名对齐的前提不成立）
  const regions = (text) => [...text.matchAll(/\/\/#region (\S+)/g)].map((m) => m[1]);
  const onlyInIife = regions(iife).filter((r) => !regions(client).includes(r));
  assert.deepEqual(onlyInIife, [], 'iife.js 有 client.js 缺失的 region');
});

test('visual 包目录可被解析（防止误改 package.json 的入口）', () => {
  const manifest = JSON.parse(read('../package.json'));
  assert.equal(manifest.name, 'dsh-fairy-visual');
  assert.ok(manifest.exports?.['./client'], 'exports["./client"] 缺失时浏览器端整包加载失败');
  assert.ok(pkgDir.replace(/[\\/]+$/, '').endsWith('dsh-fairy-visual'), `包目录名异常: ${pkgDir}`);
  assert.ok(srcAnchor.includes('chat-content-anchor'), 'anchor 模块应仍在原位');
});
