import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const markerSource = readFileSync(new URL('../src/client/semantic-markers.js', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/client/semantic-markers-manager.js', import.meta.url), 'utf8');

function loadSemanticMarkers() {
  const module = { exports: {} };
  vm.runInNewContext(markerSource, {
    module,
    exports: module.exports,
    require(path) {
      if (path === './lifecycle.js') {
        return {
          createLifecycleScope: (name) => ({ name }),
          claimSingleton: (_owner, _key, scope) => scope,
        };
      }
      throw new Error(`unexpected require: ${path}`);
    },
  }, { filename: 'semantic-markers.js' });
  return module.exports;
}

test('every semantic marker use is registered exactly once', () => {
  const { SEMANTIC_MARKERS } = loadSemanticMarkers();
  const registered = [...SEMANTIC_MARKERS];
  const used = [...clientSource.matchAll(/\bmark\([^\n]*?'(data-dsh-fairy-[^']+)'\)/g)]
    .map((match) => match[1]);

  assert.equal(new Set(registered).size, registered.length);
  assert.deepEqual([...new Set(used)].sort(), [...registered].sort());
});

test('an unregistered marker fails instead of silently skipping ownership', () => {
  const { createSemanticMarkerMap, markSemanticNode } = loadSemanticMarkers();
  const markerMap = createSemanticMarkerMap();
  assert.throws(
    () => markSemanticNode(markerMap, null, 'data-dsh-fairy-typo'),
    /unregistered semantic marker/,
  );

  const node = {};
  markSemanticNode(markerMap, node, 'data-dsh-fairy-sidebar-open-control');
  assert.ok(markerMap.get('data-dsh-fairy-sidebar-open-control').has(node));
});

test('replacing the collapsed brand button wakes semantic rebinding', () => {
  const { mutationTouchesSemanticSurface } = loadSemanticMarkers();
  const selector = '.open-sidebar, [data-slot="sidebar.brand.mark"]';
  const replacement = {
    nodeType: 1,
    matches: (candidate) => candidate === selector,
    querySelector: () => null,
  };
  const unrelated = {
    nodeType: 1,
    matches: () => false,
    querySelector: () => null,
  };

  assert.equal(mutationTouchesSemanticSurface([{
    type: 'childList', target: unrelated, addedNodes: [replacement], removedNodes: [],
  }], selector), true);
  assert.equal(mutationTouchesSemanticSurface([{
    type: 'childList', target: unrelated, addedNodes: [unrelated], removedNodes: [],
  }], selector), false);
});
