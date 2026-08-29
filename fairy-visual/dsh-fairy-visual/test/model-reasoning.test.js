import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/dom-adapter.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const clientDomContracts = require('../../../fairy-contracts/client-dom.cjs');
const module = { exports: {} };
vm.runInNewContext(source, {
  module,
  exports: module.exports,
  require: (id) => {
    assert.equal(id, '../../../../fairy-contracts/client-dom.cjs');
    return clientDomContracts;
  },
}, { filename: 'dom-adapter.js' });
const {
  OFFICIAL_SELECTORS,
  OFFICIAL_NODE_CONTRACTS,
  officialNode,
  hasOfficialNode,
  officialNodes,
  modelAndReasoningShareNode,
  toBottomControl,
} = module.exports;

function fixture(model, reasoning) {
  const nodes = new Map([
    [OFFICIAL_SELECTORS.model, model],
    [OFFICIAL_SELECTORS.reasoning, reasoning],
  ]);
  return { querySelector(selector) { return nodes.get(selector) || null; } };
}

test('rc.2 merged control is recognized as one official node', () => {
  const merged = {};
  assert.equal(modelAndReasoningShareNode(fixture(merged, merged)), true);
});

test('legacy separated model and reasoning controls remain independent', () => {
  assert.equal(modelAndReasoningShareNode(fixture({}, {})), false);
});

test('missing optional control does not claim merged ownership', () => {
  assert.equal(modelAndReasoningShareNode(fixture({}, null)), false);
  assert.equal(modelAndReasoningShareNode(fixture(null, {})), false);
});

test('named node contracts retain selector text and always resolve current nodes', () => {
  let current = { id: 'first' };
  const scope = {
    querySelector(selector) {
      assert.equal(selector, OFFICIAL_SELECTORS.composerCard);
      return current;
    },
    querySelectorAll(selector) {
      assert.equal(selector, OFFICIAL_SELECTORS.sessionItem);
      return [current];
    },
  };
  assert.equal(OFFICIAL_NODE_CONTRACTS.composerCard.selector, '[data-composer-card="true"]');
  assert.equal(officialNode('composerCard', scope), current);
  assert.equal(hasOfficialNode('composerCard', scope), true);
  const items = officialNodes('sessionItem', scope);
  assert.equal(items.length, 1);
  assert.equal(items[0], current);
  current = { id: 'replacement' };
  assert.equal(officialNode('composerCard', scope), current);
});

test('to-bottom lookup preserves local-first then document fallback behavior', () => {
  const local = { id: 'local' };
  const global = { id: 'global' };
  const localScope = { querySelector(selector) { assert.equal(selector, OFFICIAL_SELECTORS.toBottom); return local; } };
  const documentScope = { querySelector(selector) { assert.equal(selector, OFFICIAL_SELECTORS.toBottom); return global; } };
  assert.equal(toBottomControl(localScope) || toBottomControl(documentScope), local);
  const emptyScope = { querySelector() { return null; } };
  assert.equal(toBottomControl(emptyScope) || toBottomControl(documentScope), global);
});
