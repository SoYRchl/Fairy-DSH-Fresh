import assert from 'node:assert/strict';
import test from 'node:test';

import { GENERATIONS, UNSTABLE_SURFACES, degrade, optional, pick, probeGeneration, resetProbeCache } from '../index.js';

test('代际探测：有 getSectionOrder 判为 0.2+，否则回落 0.1.1', () => {
  resetProbeCache();
  const modern = probeGeneration({ systemPrompt: { getSectionOrder: () => 50 } });
  assert.equal(modern.generation, '0.2+');
  assert.equal(modern.toolPresentation, 'ptc');
  assert.equal(modern.presetNeedsRegistry, true);
  assert.equal(modern.settingsScopeService, false);

  resetProbeCache();
  const legacy = probeGeneration({ systemPrompt: {} });
  assert.equal(legacy.generation, '0.1.1');
  assert.equal(legacy.toolPresentation, 'code');
  assert.equal(legacy.settingsScopeService, true);
  resetProbeCache();
});

test('探测结果被缓存（同进程第二次返回同一对象）', () => {
  resetProbeCache();
  const a = probeGeneration({ systemPrompt: { getSectionOrder: () => 1 } });
  const b = probeGeneration({ systemPrompt: {} }); // 即使参数不同，也走缓存
  assert.equal(a, b);
  resetProbeCache();
});

test('降级不抛错，且打一条结构化 capability.missing', () => {
  const lines = [];
  const result = degrade('hddVisualMode', { report: (line) => lines.push(line) });
  assert.equal(result, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /degraded capability: hddVisualMode/);
  assert.match(degrade('x', { required: true, report: (l) => lines.push(l) }) + '', /false/);
  assert.match(lines[1], /missing required capability: x/);
});

test('optional()：缺失或抛错都回落，不冒泡', () => {
  const seen = [];
  assert.equal(optional('a', () => null, 'fallback', { report: (l) => seen.push(l) }), 'fallback');
  assert.equal(optional('b', () => { throw new Error('boom'); }, 'fallback', { report: (l) => seen.push(l) }), 'fallback');
  assert.equal(optional('c', () => 'value', 'fallback'), 'value');
  assert.equal(seen.length, 2);
});

test('选择器事实源是并集，且 pick() 会逐个试', () => {
  assert.match(UNSTABLE_SURFACES.conversation, /,/, '会话容器必须是跨代并集');
  assert.match(UNSTABLE_SURFACES.composerInput, /textarea/);
  const fakeDoc = {
    querySelector(selector) {
      // 只有"新代"选择器命中，验证 pick 会继续往下试
      return selector.includes('main.conversation') ? { id: 'hit' } : null;
    },
  };
  assert.deepEqual(pick('conversation', fakeDoc), { id: 'hit' });
  assert.equal(pick('nope', fakeDoc), null);
  assert.equal(pick('conversation', null), null);
});

test('代际表保留了 0.1.1 兜底项（探测失败不许返回 undefined）', () => {
  assert.ok(GENERATIONS.length >= 2);
  assert.equal(typeof GENERATIONS.at(-1).detect(), 'boolean');
  assert.equal(GENERATIONS.at(-1).detect(), true);
});
