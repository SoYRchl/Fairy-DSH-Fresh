import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/chat-content-anchor.js', import.meta.url), 'utf8');

class FakeStyle {
  #values = new Map();

  getPropertyValue(name) { return this.#values.get(name) || ''; }
  setProperty(name, value) { this.#values.set(name, value); }
  removeProperty(name) { this.#values.delete(name); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeNode {
  constructor(rect) {
    this.rect = rect;
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.isConnected = true;
    this.parentElement = { paddingBottom: '0px' };
  }

  getBoundingClientRect() { return this.rect; }
}

function loadAnchor() {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    getComputedStyle(node) { return { paddingBottom: node.paddingBottom || '0px' }; },
    require(path) {
      if (path === './dom-adapter.js') return { OFFICIAL_SELECTORS: { conversationScroll: '[data-conversation-scroll]' } };
      throw new Error(`Unexpected dependency: ${path}`);
    },
  }, { filename: 'chat-content-anchor.js' });
  return module.exports;
}

test('short conversations anchor to the composer without binding scroll work', () => {
  const scroll = new FakeNode({ top: 40, bottom: 720, width: 1000, height: 680 });
  const flow = new FakeNode({ top: 400, bottom: 500, width: 700, height: 100 });
  const composer = new FakeNode({ top: 588, bottom: 720, width: 700, height: 132 });
  flow.closest = () => scroll;
  let queuedFrame = null;
  const { createChatContentAnchor } = loadAnchor();
  const anchor = createChatContentAnchor({
    getFlowNodes: () => [flow],
    getComposerNode: () => composer,
    requestFrame(callback) { queuedFrame = callback; return 1; },
    cancelFrame() { queuedFrame = null; },
    isDisposed: () => false,
  });

  anchor.flush();

  assert.equal(flow.classList.contains('dsh-fairy-chat-content-anchored'), true);
  assert.equal(flow.style.getPropertyValue('--dsh-fairy-chat-anchor-min-height'), '188px');
  assert.equal(queuedFrame, null);
  assert.equal('listeners' in scroll, false);
});

test('long conversations keep their natural layout', () => {
  const scroll = new FakeNode({ top: 40, bottom: 720, width: 1000, height: 680 });
  const flow = new FakeNode({ top: -260, bottom: 688, width: 700, height: 948 });
  const composer = new FakeNode({ top: 588, bottom: 720, width: 700, height: 132 });
  flow.closest = () => scroll;
  const { createChatContentAnchor } = loadAnchor();
  const anchor = createChatContentAnchor({
    getFlowNodes: () => [flow],
    getComposerNode: () => composer,
    requestFrame: () => 1,
    cancelFrame() {},
    isDisposed: () => false,
  });

  anchor.flush();

  assert.equal(flow.classList.contains('dsh-fairy-chat-content-anchored'), false);
  assert.equal(flow.style.getPropertyValue('--dsh-fairy-chat-anchor-min-height'), '');
  assert.equal(flow.style.getPropertyValue('--dsh-fairy-chat-occlusion-bottom'), '');
});
