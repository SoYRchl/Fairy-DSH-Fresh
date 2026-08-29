import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/composer-workspace-projection.js', import.meta.url), 'utf8');

function loadProjection() {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename: 'composer-workspace-projection.js' });
  return module.exports;
}

function textNode(value) {
  return { nodeType: 3, nodeValue: value };
}

function element(children = []) {
  const attributes = new Map();
  return {
    nodeType: 1,
    childNodes: children,
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) || null; },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
    attributes,
  };
}

function modeProjection(label = '创造模式') {
  const visibleText = textNode(label);
  const button = element([element(), element([visibleText]), element()]);
  button.querySelector = () => null;
  const owner = element([button]);
  owner.querySelector = (selector) => selector === 'button' ? button : null;
  const projection = element([owner]);
  projection.querySelector = (selector) => selector === '[data-dsh-fairy-composer-mode-control="true"]' ? owner : null;
  return { projection, owner, button, visibleText };
}

test('active workspace projection mirrors the verified read-only session preset', () => {
  const { syncWorkspaceProjectionMode } = loadProjection();
  const { projection, owner, button, visibleText } = modeProjection();
  const sessionLabel = {
    textContent: 'Fairy',
    getAttribute(name) { return name === 'title' ? '此会话使用的 Agent 预设' : null; },
  };

  assert.equal(syncWorkspaceProjectionMode(projection, sessionLabel), true);
  assert.equal(visibleText.nodeValue, 'Fairy');
  assert.equal(button.getAttribute('aria-label'), 'Fairy');
  assert.equal(button.getAttribute('title'), '此会话使用的 Agent 预设');
  assert.equal(owner.hasAttribute('data-dsh-fairy-composer-mode-pending'), false);
});

test('active workspace projection never retains a previous session preset during a header gap', () => {
  const { syncWorkspaceProjectionMode } = loadProjection();
  const { projection, owner, visibleText } = modeProjection('Fairy');

  assert.equal(syncWorkspaceProjectionMode(projection, null), false);
  assert.equal(visibleText.nodeValue, 'Fairy');
  assert.equal(owner.getAttribute('data-dsh-fairy-composer-mode-pending'), 'true');
});
