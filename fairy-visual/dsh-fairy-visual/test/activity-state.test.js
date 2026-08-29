import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveSessionActivity } from '../src/client/utils.js';

test('uses the official session running flag when no comfort cue is active', () => {
  assert.equal(deriveSessionActivity(), 'normal');
  assert.equal(deriveSessionActivity({ running: false }), 'normal');
  assert.equal(deriveSessionActivity({ running: true }), 'thinking');
});

test('comforting has precedence over thinking and normal', () => {
  const chat = {
    order: ['user-1'],
    nodes: new Map([['user-1', { kind: 'user', data: { text: '我好难过' } }]]),
  };
  assert.equal(deriveSessionActivity({ running: false, chat }), 'comforting');
  assert.equal(deriveSessionActivity({ running: true, chat }), 'comforting');
});

test('neutral committed messages retain the latest decisive comfort cue', () => {
  const chat = {
    order: ['user-1', 'assistant-1', 'user-2'],
    nodes: new Map([
      ['user-1', { kind: 'user', data: { text: '我好难过' } }],
      ['assistant-1', { kind: 'assistant-step', data: { text: '我在' } }],
      ['user-2', { kind: 'user', data: { text: '今天发生了很多事' } }],
    ]),
  };
  assert.equal(deriveSessionActivity({ running: true, chat }), 'comforting');
});

test('stays thinking through waiting, streaming, search, and tool result phases', () => {
  const runningSnapshots = [
    { running: true, chat: { phase: 'waiting-for-assistant' } },
    { running: true, chat: { phase: 'streaming-answer', text: '部分回答' } },
    { running: true, chat: { phase: 'calling-tool', tool: 'browser.search' } },
    { running: true, chat: { phase: 'receiving-tool-result', result: '完成' } },
    { running: true, chat: { phase: 'streaming-answer', text: '最终回答' } },
  ];

  assert.deepEqual(runningSnapshots.map(deriveSessionActivity), Array(5).fill('thinking'));
});

test('returns to normal only after the whole run is committed complete', () => {
  const activities = [
    { running: true },
    { running: true },
    { running: true },
    { running: false },
  ].map(deriveSessionActivity);

  assert.deepEqual(activities, ['thinking', 'thinking', 'thinking', 'normal']);
});
