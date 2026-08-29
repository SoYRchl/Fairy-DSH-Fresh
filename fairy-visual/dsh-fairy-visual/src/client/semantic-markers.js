const { createLifecycleScope, claimSingleton } = require('./lifecycle.js');

const SEMANTIC_MARKERS = Object.freeze([
  'data-dsh-fairy-background-surface',
  'data-dsh-fairy-sidebar-layer',
  'data-dsh-fairy-sidebar-content',
  'data-dsh-fairy-sidebar-collapsed-content',
  'data-dsh-fairy-history-surface',
  'data-dsh-fairy-history-fade',
  'data-dsh-fairy-active-folder',
  'data-dsh-fairy-selected-session',
  'data-dsh-fairy-brand-anchor',
  'data-dsh-fairy-sidebar-open-control',
  'data-dsh-fairy-native-new-session',
  'data-dsh-fairy-hero-native-copy',
  'data-dsh-fairy-version-navigation',
  'data-dsh-fairy-header-row',
  'data-dsh-fairy-header-title-row',
  'data-dsh-fairy-header-title-cluster',
  'data-dsh-fairy-header-utilities-shell',
  'data-dsh-fairy-header-actions-cluster',
  'data-dsh-fairy-header-utilities-cluster',
  'data-dsh-fairy-header-session-log',
  'data-dsh-fairy-header-session-agent-preset',
  'data-dsh-fairy-composer-seat',
  'data-dsh-fairy-composer-controls',
  'data-dsh-fairy-send-button',
  'data-dsh-fairy-overlay-layer',
]);

function createSemanticMarkerMap() {
  return new Map(SEMANTIC_MARKERS.map((name) => [name, new Set()]));
}

// Marker typos are ownership bugs, not optional no-ops. Failing immediately
// makes an unregistered marker visible in tests and development instead of
// silently leaving an official surface exposed.
function markSemanticNode(markerMap, node, name) {
  const nodes = markerMap.get(name);
  if (!nodes) throw new Error(`[dsh-fairy-visual] unregistered semantic marker: ${name}`);
  if (node) nodes.add(node);
}

function mutationTouchesSemanticSurface(records, selector) {
  // The shared DOM observer has already applied type/attribute/target filters.
  // Stop at the first matching surface and never scan a changed subtree twice.
  const visited = new WeakSet();
  return records.some((record) => {
    const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
    if (record.type === 'attributes') return Boolean(target?.closest?.(selector));
    if (record.type !== 'childList') return false;
    return [...record.addedNodes, ...record.removedNodes].some((node) => {
      if (node.nodeType !== 1 || visited.has(node)) return false;
      visited.add(node);
      return node.matches?.(selector) || node.querySelector?.(selector);
    });
  });
}

function claimSemanticMarkers(documentRef) {
  return claimSingleton(documentRef, 'semantic-markers', createLifecycleScope('semantic-markers'));
}

module.exports = {
  SEMANTIC_MARKERS,
  createSemanticMarkerMap,
  markSemanticNode,
  mutationTouchesSemanticSurface,
  claimSemanticMarkers,
};
