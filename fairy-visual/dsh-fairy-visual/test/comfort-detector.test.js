import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyComfortMessage, deriveSessionComfort } from '../src/client/comfort-detector.js';

test('recognizes explicit Chinese and English comfort cues', () => {
  assert.equal(classifyComfortMessage('我今天真的很难过，能安慰我吗'), 'trigger');
  assert.equal(classifyComfortMessage('I feel overwhelmed and need you to be gentle'), 'trigger');
  assert.equal(classifyComfortMessage('许愿精灵，陪陪我'), 'trigger');
  assert.equal(classifyComfortMessage('我被否定了，精疲力竭，想把自己关机'), 'trigger');
});

test('recognizes recovery and topic-exit cues', () => {
  assert.equal(classifyComfortMessage('谢谢，我好多了'), 'exit');
  assert.equal(classifyComfortMessage("I'm better now, let's move on"), 'exit');
  assert.equal(classifyComfortMessage('我们聊聊代码，帮我实现这个函数'), 'exit');
});

test('respects an explicit request not to be comforted', () => {
  assert.equal(classifyComfortMessage('我很难受，但不要安慰我，直接给方案'), 'exit');
  assert.equal(classifyComfortMessage("I'm upset; do not comfort me, just analyze it"), 'exit');
});

test('holds the comfort latch for neutral continuation', () => {
  assert.equal(classifyComfortMessage('帮我整理一下接下来的计划'), 'hold');
  assert.equal(classifyComfortMessage('先这样'), 'hold');
});

test('derives the latch from committed ChatNodeStore nodes including a fresh session first message', () => {
  const nodes = new Map([
    ['u1', { kind: 'user', data: { blocks: [{ text: '我好难受' }] } }],
    ['a1', { kind: 'assistant-step', data: { text: '我陪着你' } }],
    ['u2', { kind: 'user', data: { text: '先听我说完' } }],
  ]);
  assert.equal(deriveSessionComfort({ chat: { order: ['u1'], nodes } }), true);
  assert.equal(deriveSessionComfort({ chat: { order: ['u1', 'a1', 'u2'], nodes } }), true);
  nodes.set('u3', { kind: 'user', data: { text: '谢谢，我好多了' } });
  assert.equal(deriveSessionComfort({ chat: { order: ['u1', 'a1', 'u2', 'u3'], nodes } }), false);
});

test('reads official rich-text message blocks instead of only string fields', () => {
  const nodes = new Map([
    ['u1', { kind: 'user', data: { text: [{ type: 'text', text: '我好难受' }] } }],
  ]);
  assert.equal(deriveSessionComfort({ chat: { order: ['u1'], nodes } }), true);
});
