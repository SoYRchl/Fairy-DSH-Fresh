import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client/selection-guard.js', import.meta.url), 'utf8');

function eventTarget(matches) {
  return { closest: (selector) => matches && selector.includes(matches) ? {} : null };
}

function eventBus() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      [...(listeners.get(type) || [])].forEach((listener) => listener(event));
    },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
  };
}

function loadGuard() {
  const documentRef = eventBus();
  const windowRef = eventBus();
  const attrs = new Map();
  documentRef.documentElement = {
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
  };
  const module = { exports: {} };
  new vm.Script(`(function (module, exports) {\n${source}\n})`).runInThisContext()(module, module.exports);
  return { createSelectionGuard: module.exports.createSelectionGuard, documentRef, windowRef, attrs };
}

test('selection guard only locks explicit drag handles and always releases', () => {
  const loaded = loadGuard();
  const guard = loaded.createSelectionGuard({
    documentRef: loaded.documentRef,
    windowRef: loaded.windowRef,
    selector: '[data-side="sidebar"]',
    maxDuration: 1000,
  });
  loaded.documentRef.dispatch('pointerdown', { button: 0, pointerId: 7, target: eventTarget('data-side') });
  assert.equal(loaded.attrs.get('data-dsh-fairy-selection-lock'), 'true');
  const selectionEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  loaded.documentRef.dispatch('selectstart', selectionEvent);
  assert.equal(selectionEvent.prevented, true);
  loaded.windowRef.dispatch('pointerup', { pointerId: 7 });
  assert.equal(loaded.attrs.has('data-dsh-fairy-selection-lock'), false);

  loaded.documentRef.dispatch('pointerdown', { button: 0, pointerId: 8, target: eventTarget(null) });
  assert.equal(loaded.attrs.has('data-dsh-fairy-selection-lock'), false);
  guard.dispose();
  assert.equal(loaded.attrs.has('data-dsh-fairy-selection-lock'), false);
  assert.equal(loaded.documentRef.listenerCount('mousedown'), 0);
});

test('selection guard clears its document lock while the page is hidden', () => {
  const loaded = loadGuard();
  loaded.documentRef.visibilityState = 'visible';
  const guard = loaded.createSelectionGuard({
    documentRef: loaded.documentRef,
    windowRef: loaded.windowRef,
    selector: '[data-side="sidebar"]',
  });
  loaded.documentRef.dispatch('pointerdown', { button: 0, pointerId: 11, target: eventTarget('data-side') });
  assert.equal(loaded.attrs.get('data-dsh-fairy-selection-lock'), 'true');
  loaded.documentRef.visibilityState = 'hidden';
  loaded.documentRef.dispatch('visibilitychange');
  assert.equal(loaded.attrs.has('data-dsh-fairy-selection-lock'), false);
  guard.dispose();
});
