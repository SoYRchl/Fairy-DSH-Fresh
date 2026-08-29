import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/to-bottom-positioner.js', import.meta.url), 'utf8');

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

class FakeNode {
  constructor({ attributes = {}, rect = { bottom: 600, top: 0, height: 600 } } = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.rect = rect;
    this.style = new FakeStyle();
    this.isConnected = true;
    this.listeners = new Map();
    this.parentElement = null;
  }

  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  getBoundingClientRect() { return this.rect; }
  closest(selector) { return selector === '.toBottomSlot' ? this.parentElement : null; }
}

function loadPositioner({ documentRef, toBottomControl }) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    document: documentRef,
    require(path) {
      if (path === './dom-adapter.js') return { toBottomControl };
      throw new Error(`Unexpected dependency: ${path}`);
    },
  }, { filename: 'to-bottom-positioner.js' });
  return module.exports;
}

test('uses a Fairy-owned marker for the locale-resolved to-bottom control and restores it on cleanup', () => {
  const root = new FakeNode();
  const documentRef = { documentElement: root };
  const scroll = new FakeNode();
  const slot = new FakeNode();
  const button = new FakeNode({ attributes: { 'data-dsh-fairy-to-bottom-control': 'pre-existing' } });
  button.parentElement = slot;
  let activeControl = button;
  const { createToBottomPositioner } = loadPositioner({
    documentRef,
    toBottomControl(scope) { return scope === scroll ? activeControl : null; },
  });
  const positioner = createToBottomPositioner({
    getScrollNodes: () => [scroll],
    getComposerNode: () => new FakeNode({ rect: { top: 500, bottom: 620, height: 120 } }),
    requestFrame: () => 1,
    cancelFrame() {},
    isDisposed: () => false,
  });

  positioner.flush();
  assert.equal(button.getAttribute('data-dsh-fairy-to-bottom-control'), 'true');
  assert.equal(slot.getAttribute('data-dsh-fairy-to-bottom-slot'), 'true');

  activeControl = null;
  positioner.flush();
  assert.equal(button.getAttribute('data-dsh-fairy-to-bottom-control'), 'pre-existing');
  assert.equal(slot.getAttribute('data-dsh-fairy-to-bottom-slot'), null);

  activeControl = button;
  positioner.flush();
  positioner.clear();
  assert.equal(button.getAttribute('data-dsh-fairy-to-bottom-control'), 'pre-existing');
});
