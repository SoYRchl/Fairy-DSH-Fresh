#!/usr/bin/env node
// T-109：把守卫三模块并入 fairy-visual。
//
// 为什么是「字符串级补丁」而不是重新构建
// ------------------------------------
// `lib/client.js` 是权威产物，里面比 tsdown 原始产物（`lib/index.iife.js`）
// 多 823 行本地/compat 补丁；`pnpm bundle` 会 `cp lib/index.iife.js lib/client.js`
// 把那些补丁整段抹掉。所以：**两个产物都打**，且绝不用构建器重建。
//
// 用法：node apply-guard-modules.mjs <fairyVisualDir> [--check]
//   --check 只校验锚点唯一性与语法，不写盘。

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const checkOnly = process.argv.includes('--check');
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error(`不是 fairy-visual 包目录: ${dir}`);
  process.exit(2);
}

const READ = (rel) => path.join(dir, rel);
const CRLF = (s) => /\r\n/.test(s);

/** 产物里的 region 形态（rolldown CJS 包装）；缩进与原产物一致 */
function cjsRegion(regionName, body) {
  return [
    `//#region src/client/${regionName}`,
    `\tvar require_${regionName.replace(/[-.]/g, '_').replace(/_js$/, '')} = /* @__PURE__ */ __commonJSMin(((exports, module) => {`,
    ...body,
    '\t\tmodule.exports = { ' + MODULE_EXPORTS[regionName] + ' };',
    '\t}));',
    '//#endregion',
    '',
  ].join('\n');
}

const MODULE_EXPORTS = {
  'scroll-position-guard.js': 'captureScrollPositions, restoreScrollPositions',
  'decision-pointer-guard.js': 'createDecisionPointerGuard',
};

const SCROLL_BODY = [
  '\t\tconst clamp = (value, min, max) => Math.min(max, Math.max(min, value));',
  '\t\tconst BOTTOM_EPSILON = 24;',
  '\t\tfunction captureScrollPositions(nodes) {',
  '\t\t\tconst snapshots = /* @__PURE__ */ new Map();',
  '\t\t\t(nodes || []).forEach((node) => {',
  '\t\t\t\tif (!node || typeof node.scrollTop !== "number") return;',
  '\t\t\t\tconst maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);',
  '\t\t\t\tconst distanceFromBottom = Math.max(0, maxScrollTop - node.scrollTop);',
  '\t\t\t\tsnapshots.set(node, { scrollTop: node.scrollTop, distanceFromBottom, atBottom: distanceFromBottom <= BOTTOM_EPSILON });',
  '\t\t\t});',
  '\t\t\treturn snapshots;',
  '\t\t}',
  '\t\tfunction restoreScrollPositions(snapshots) {',
  '\t\t\tsnapshots?.forEach(({ scrollTop, atBottom }, node) => {',
  '\t\t\t\tif (!node?.isConnected) return;',
  '\t\t\t\tconst maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);',
  '\t\t\t\tconst nextScrollTop = atBottom ? maxScrollTop : clamp(scrollTop, 0, maxScrollTop);',
  '\t\t\t\tif (Math.abs(node.scrollTop - nextScrollTop) > 0.5) node.scrollTop = nextScrollTop;',
  '\t\t\t});',
  '\t\t}',
];

const DECISION_BODY = [
  '\t\t// Retain a deliberate mouse click across a layout shift. No synthetic click,',
  '\t\t// no pointerdown answer, and no change to the host\'s exactly-once/disabled logic.',
  '\t\tfunction createDecisionPointerGuard({ documentRef = document, windowRef = window } = {}) {',
  '\t\t\tlet press = null;',
  '\t\t\tconst release = () => {',
  '\t\t\t\tif (!press) return;',
  '\t\t\t\tconst { button, id } = press;',
  '\t\t\t\tpress = null;',
  '\t\t\t\ttry { if (button.hasPointerCapture(id)) button.releasePointerCapture(id); } catch (_) {}',
  '\t\t\t};',
  '\t\t\tconst down = (event) => {',
  '\t\t\t\trelease();',
  '\t\t\t\tif (event.defaultPrevented || event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary) return;',
  '\t\t\t\tconst button = event.target?.closest?.("[data-approval-key] button, [data-question-key] button, [data-plan-review-key] button");',
  '\t\t\t\tif (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;',
  '\t\t\t\ttry {',
  '\t\t\t\t\tbutton.setPointerCapture(event.pointerId);',
  '\t\t\t\t\tpress = { button, id: event.pointerId, x: event.clientX, y: event.clientY };',
  '\t\t\t\t} catch (_) {}',
  '\t\t\t};',
  '\t\t\tconst move = (event) => {',
  '\t\t\t\tif (!press || event.pointerId !== press.id) return;',
  '\t\t\t\tif (!press.button.isConnected || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) release();',
  '\t\t\t};',
  '\t\t\tconst up = (event) => { if (!press || event.pointerId !== press.id) return; press = null; };',
  '\t\t\tconst hidden = () => { if (documentRef.hidden) release(); };',
  '\t\t\tdocumentRef.addEventListener("pointerdown", down, true);',
  '\t\t\tdocumentRef.addEventListener("pointermove", move, true);',
  '\t\t\tdocumentRef.addEventListener("pointerup", up, true);',
  '\t\t\tdocumentRef.addEventListener("pointercancel", release, true);',
  '\t\t\tdocumentRef.addEventListener("visibilitychange", hidden);',
  '\t\t\twindowRef.addEventListener("blur", release);',
  '\t\t\twindowRef.addEventListener("pagehide", release);',
  '\t\t\treturn { dispose() {',
  '\t\t\t\trelease();',
  '\t\t\t\tdocumentRef.removeEventListener("pointerdown", down, true);',
  '\t\t\t\tdocumentRef.removeEventListener("pointermove", move, true);',
  '\t\t\t\tdocumentRef.removeEventListener("pointerup", up, true);',
  '\t\t\t\tdocumentRef.removeEventListener("pointercancel", release, true);',
  '\t\t\t\tdocumentRef.removeEventListener("visibilitychange", hidden);',
  '\t\t\t\twindowRef.removeEventListener("blur", release);',
  '\t\t\t\twindowRef.removeEventListener("pagehide", release);',
  '\t\t\t} };',
  '\t\t}',
];

const scrollRegion = cjsRegion('scroll-position-guard.js', SCROLL_BODY);
const decisionRegion = cjsRegion('decision-pointer-guard.js', DECISION_BODY);

const SCROLL_REQUIRE = 'const { captureScrollPositions, restoreScrollPositions } = require_scroll_position_guard();';
const DECISION_REQUIRE = 'const { createDecisionPointerGuard } = require_decision_pointer_guard();';

/** @type {{file:string, edits:{anchor:string, position:'before'|'after', insert:string, expect:number}[]}[]} */
const PLAN = [
  {
    file: 'src/client/composer-dock.js',
    edits: [
      {
        anchor: "const { createToBottomPositioner } = require('./to-bottom-positioner.js');",
        position: 'after',
        insert: "const { captureScrollPositions, restoreScrollPositions } = require('./scroll-position-guard.js');",
      },
      {
        anchor: '    if (currentConversation !== conversation || currentSeat !== seat) {',
        position: 'before',
        insert:
          '    const scrollPositionSnapshot = currentConversation === conversation ? captureScrollPositions(conversationScrolls(currentConversation)) : null;',
      },
      {
        anchor: '    toBottomPositioner.flush();',
        position: 'after',
        insert: '    restoreScrollPositions(scrollPositionSnapshot);',
      },
    ],
  },
  {
    file: 'src/client/index.js',
    edits: [
      {
        anchor: "const { createSelectionGuard } = require('./selection-guard.js');",
        position: 'after',
        insert: "const { createDecisionPointerGuard } = require('./decision-pointer-guard.js');",
      },
      {
        anchor: "      ctx.effect(() => () => selectionGuard.dispose(), 'dsh-fairy-visual selection guard');",
        position: 'after',
        insert: [
          '      const decisionGuard = createDecisionPointerGuard();',
          "      ctx.effect(() => () => decisionGuard.dispose(), 'dsh-fairy-visual decision pointer guard');",
        ].join('\n'),
      },
    ],
  },
];

// 两个产物用同一组锚点（注：跨 `//#region` 的 region 名在两份产物里都是唯一的）
for (const file of ['lib/client.js', 'lib/index.iife.js']) {
  PLAN.push({
    file,
    edits: [
      { anchor: '//#region src/client/composer-session-rebinding.js', position: 'before', insert: scrollRegion },
      { anchor: '\t\tconst { createToBottomPositioner } = require_to_bottom_positioner();', position: 'after', insert: `\t\t${SCROLL_REQUIRE}` },
      {
        anchor: '\t\t\t\tif (currentConversation !== conversation || currentSeat !== seat) {',
        position: 'before',
        insert: '\t\t\t\tconst scrollPositionSnapshot = currentConversation === conversation ? captureScrollPositions(conversationScrolls(currentConversation)) : null;',
      },
      { anchor: '\t\t\t\ttoBottomPositioner.flush();', position: 'after', insert: '\t\t\t\trestoreScrollPositions(scrollPositionSnapshot);' },
      { anchor: '//#region src/client/settings-normalizer.cjs', position: 'before', insert: decisionRegion },
      { anchor: '\t\tconst { createSelectionGuard } = require_selection_guard();', position: 'after', insert: `\t\t${DECISION_REQUIRE}` },
      {
        anchor: '\t\t\t\tctx.effect(() => () => selectionGuard.dispose(), "dsh-fairy-visual selection guard");',
        position: 'after',
        insert: [
          '\t\t\t\tconst decisionGuard = createDecisionPointerGuard();',
          '\t\t\t\tctx.effect(() => () => decisionGuard.dispose(), "dsh-fairy-visual decision pointer guard");',
        ].join('\n'),
      },
    ],
  });
}

let failures = 0;

for (const entry of PLAN) {
  const abs = READ(entry.file);
  let text = fs.readFileSync(abs, 'utf8');
  const eol = CRLF(text) ? '\r\n' : '\n';

  if (text.includes('require_scroll_position_guard') || text.includes("require('./scroll-position-guard.js')")) {
    console.log(`  = 已应用，跳过   ${entry.file}`);
    continue;
  }

  const next = text;
  let out = text;
  for (const edit of entry.edits) {
    const anchor = edit.anchor.split('\n').join(eol);
    const insert = edit.insert.split('\n').join(eol);
    const hits = out.split(anchor).length - 1;
    if (hits !== 1) {
      console.log(`  ✗ 锚点命中 ${hits} 次（期望 1）：${entry.file} :: ${JSON.stringify(edit.anchor.slice(0, 60))}`);
      failures += 1;
      out = null;
      break;
    }
    out = edit.position === 'before' ? out.replace(anchor, `${insert}${eol}${anchor}`) : out.replace(anchor, `${anchor}${eol}${insert}`);
  }
  if (out === null || out === next) continue;

  if (out.includes('require_scroll_position_guard')) {
    // 语法自检：产物是 IIFE 片段，用 Function 构造器能捕获语法错误
    try {
      // eslint-disable-next-line no-new-func
      new Function(out);
    } catch (error) {
      console.log(`  ✗ 语法自检失败：${entry.file} :: ${error.message}`);
      failures += 1;
      continue;
    }
  }

  if (checkOnly) {
    console.log(`  · 待写盘（--check） ${entry.file}`);
    continue;
  }
  fs.writeFileSync(abs, out, 'utf8');
  console.log(`  + 已打补丁         ${entry.file}（${entry.edits.length} 处）`);
}

console.log('');
console.log(failures ? `✗ 有 ${failures} 处问题，未完成` : '✓ 全部锚点唯一、语法自检通过');
process.exit(failures ? 1 : 0);
