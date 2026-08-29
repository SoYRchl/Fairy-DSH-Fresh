import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/dom-adapter.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { FAIRY_VOICE_CONTROL_ATTRIBUTE } = require('../../../fairy-contracts/client-dom.cjs');

function loadAdapter(documentRef, { navigatorRef, warnings = [] } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    document: documentRef,
    navigator: navigatorRef,
    console: { warn: (message) => warnings.push(message) },
    require: (id) => {
      assert.equal(id, '../../../../fairy-contracts/client-dom.cjs');
      return { FAIRY_VOICE_CONTROL_ATTRIBUTE };
    },
  }, { filename: 'dom-adapter.js' });
  return module.exports;
}

function exactDocument(label, selectorKey) {
  return {
    documentElement: { lang: '' },
    querySelector(selector) {
      return selector.includes(`aria-label="${label}"`) ? { label, selectorKey } : null;
    },
    querySelectorAll(selector) { return selector.includes(`aria-label="${label}"`) ? [{ label, selectorKey }] : []; },
  };
}

test('ARIA selector unions retain the verified zh/en labels for official controls', () => {
  const adapter = loadAdapter(exactDocument('unused', 'unused'));
  assert.match(adapter.OFFICIAL_SELECTORS.sessionTree, /aria-label="会话"/);
  assert.match(adapter.OFFICIAL_SELECTORS.sessionTree, /aria-label="Sessions"/);
  assert.match(adapter.OFFICIAL_SELECTORS.newSession, /aria-label="新建会话"/);
  assert.match(adapter.OFFICIAL_SELECTORS.newSession, /aria-label="New session"/);
  assert.match(adapter.OFFICIAL_SELECTORS.openSidebar, /aria-label="打开侧边栏"/);
  assert.match(adapter.OFFICIAL_SELECTORS.openSidebar, /aria-label="Open sidebar"/);
  assert.match(adapter.OFFICIAL_SELECTORS.collapseSidebar, /aria-label="收起侧边栏"/);
  assert.match(adapter.OFFICIAL_SELECTORS.collapseSidebar, /aria-label="Collapse sidebar"/);
  assert.match(adapter.OFFICIAL_SELECTORS.toBottom, /aria-label="回到底部"/);
  assert.match(adapter.OFFICIAL_SELECTORS.toBottom, /aria-label="Back to bottom"/);
  assert.match(adapter.OFFICIAL_SELECTORS.send, /aria-label="发送消息"/);
  assert.match(adapter.OFFICIAL_SELECTORS.send, /aria-label="Send message"/);
  assert.match(adapter.OFFICIAL_SELECTORS.workspace, /aria-label="选择工作区"/);
  assert.match(adapter.OFFICIAL_SELECTORS.workspace, /aria-label="Choose workspace"/);
  assert.equal(adapter.FAIRY_VOICE_CONTROL_ATTRIBUTE, FAIRY_VOICE_CONTROL_ATTRIBUTE);
  assert.ok(adapter.SEMANTIC_SURFACE_SELECTOR.includes(adapter.OFFICIAL_SELECTORS.openSidebar));
  assert.ok(adapter.SEMANTIC_SURFACE_SELECTOR.includes(adapter.OFFICIAL_SELECTORS.sidebarBrandMark));
});

test('exact union selectors resolve Chinese and English controls without a language race', () => {
  const zhAdapter = loadAdapter(exactDocument('新建会话', 'newSession'));
  const enAdapter = loadAdapter(exactDocument('New session', 'newSession'));

  assert.equal(zhAdapter.officialNode('newSession').label, '新建会话');
  assert.equal(enAdapter.officialNode('newSession').label, 'New session');
  assert.equal(zhAdapter.newSessionButtons(exactDocument('新建会话', 'newSession')).length, 1);
  assert.ok(exactDocument('新建会话', 'newSession').querySelector(zhAdapter.OFFICIAL_SELECTORS.newSession));
  assert.ok(exactDocument('New session', 'newSession').querySelector(enAdapter.OFFICIAL_SELECTORS.newSession));
});

test('language detection prefers the official session-tree label, then document and browser locale', () => {
  const zhDocument = {
    documentElement: { lang: 'en-US' },
    querySelector(selector) {
      return selector === '[role="tree"]' ? { getAttribute: () => '会话' } : null;
    },
  };
  const enDocument = { documentElement: { lang: 'en-GB' }, querySelector: () => null };
  const fallbackDocument = { documentElement: { lang: '' }, querySelector: () => null };
  const adapter = loadAdapter(zhDocument, { navigatorRef: { language: 'zh-CN' } });

  assert.equal(adapter.detectCurrentLanguage(zhDocument, { language: 'en-US' }), 'zh');
  assert.equal(adapter.detectCurrentLanguage(enDocument, { language: 'zh-CN' }), 'en');
  assert.equal(adapter.detectCurrentLanguage(fallbackDocument, { language: 'zh-CN' }), 'zh');
});

test('sessionTree uses a role-limited fuzzy fallback only after exact matching fails', () => {
  const warnings = [];
  const tree = {
    getAttribute(name) { return name === 'aria-label' ? 'Session List' : null; },
  };
  const documentRef = {
    documentElement: { lang: 'en' },
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === '[role="tree"]' ? [tree] : []; },
  };
  const adapter = loadAdapter(documentRef, { warnings });

  assert.equal(adapter.sessionTree(documentRef), tree);
  assert.match(warnings.join('\n'), /^DSH_FAIRY_LOG /);
  assert.match(warnings.join('\n'), /"operation":"capability\.fuzzy-fallback"/);
  assert.match(warnings.join('\n'), /"capability":"sessionTree"/);
});

test('session agent preset label resolves from the documented read-only header action', () => {
  const label = {
    textContent: 'Fairy',
    getAttribute(name) { return name === 'title' ? '此会话使用的 Agent 预设' : null; },
    querySelector() { return null; },
  };
  const interactive = {
    textContent: 'Undo',
    getAttribute() { return 'Undo'; },
    querySelector() { return {}; },
  };
  const actions = { children: [label, interactive] };
  const documentRef = {
    querySelector(selector) { return selector.includes('conversation.session.header.actions') ? actions : null; },
  };
  const adapter = loadAdapter(documentRef);

  assert.equal(adapter.sessionAgentPresetLabel(documentRef), label);
});
