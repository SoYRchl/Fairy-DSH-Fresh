import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/composer-inset-synchronizer.js', import.meta.url), 'utf8');

class FakeStyle {
  #values = new Map();
  #priorities = new Map();

  getPropertyValue(name) { return this.#values.get(name) || ''; }
  getPropertyPriority(name) { return this.#priorities.get(name) || ''; }
  setProperty(name, value, priority = '') {
    this.#values.set(name, value);
    this.#priorities.set(name, priority);
  }
  removeProperty(name) {
    this.#values.delete(name);
    this.#priorities.delete(name);
  }
}

class FakeScrollNode {
  constructor(basePadding = '0px') {
    this.style = new FakeStyle();
    this.basePadding = basePadding;
    this.isConnected = true;
  }
}

function loadInsetSynchronizer() {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    getComputedStyle(node) { return { paddingBottom: node.basePadding }; },
  }, { filename: 'composer-inset-synchronizer.js' });
  return module.exports;
}

function createSynchronizer(node, height = 132) {
  const { createInsetSynchronizer } = loadInsetSynchronizer();
  return createInsetSynchronizer({
    getScrollNodes: () => [node],
    getHeight: () => height,
    requestFrame: () => 1,
    cancelFrame() {},
    isDisposed: () => false,
  });
}

test('reserves HDD composer space without taking ownership of the official composer-height variable', () => {
  const node = new FakeScrollNode('18px');
  node.style.setProperty('padding-bottom', '18px', 'important');
  node.style.setProperty('--dsh-composer-height', '284px');
  const synchronizer = createSynchronizer(node);

  synchronizer.flush();

  assert.equal(node.style.getPropertyValue('padding-bottom'), 'calc(18px + 132px)');
  assert.equal(node.style.getPropertyPriority('padding-bottom'), 'important');
  assert.equal(node.style.getPropertyValue('--dsh-fairy-composer-inset'), '132px');
  assert.equal(node.style.getPropertyValue('--dsh-composer-height'), '284px');

  synchronizer.clear();

  assert.equal(node.style.getPropertyValue('padding-bottom'), '18px');
  assert.equal(node.style.getPropertyPriority('padding-bottom'), 'important');
  assert.equal(node.style.getPropertyValue('--dsh-fairy-composer-inset'), '');
  assert.equal(node.style.getPropertyValue('--dsh-composer-height'), '284px');
});

test('clears the HDD inset before a subsequent mount can measure it as normal-mode padding', () => {
  const node = new FakeScrollNode('0px');
  const synchronizer = createSynchronizer(node);

  synchronizer.flush();
  assert.equal(node.style.getPropertyValue('padding-bottom'), 'calc(0px + 132px)');

  synchronizer.clear();
  assert.equal(node.style.getPropertyValue('padding-bottom'), '');

  synchronizer.flush();
  assert.equal(node.style.getPropertyValue('padding-bottom'), 'calc(0px + 132px)');
  assert.notEqual(node.style.getPropertyValue('padding-bottom'), 'calc(132px + 132px)');
});
