const React = require('react');
const { createManagedMutationObserver } = require('./dom-observer-manager.js');
const { claimGeometryLifecycle } = require('./geometry-lifecycle.js');
const { mutationTouchesSurface, roundedRectPath } = require('./surface-utils.js');
const { OFFICIAL_SELECTORS, OFFICIAL_ATTRIBUTES, sidebarResizeHandle } = require('./dom-adapter.js');

function install(_lifecycle = null) {
    // Lifecycle: sidebar board geometry
    // Owner: document
    // Contract: lifecycle-ownership.json#owners[subsystem=sidebar board geometry]
    function SidebarBoardCutout({ enabled }) {
      React.useLayoutEffect(() => {
        const lifecycle = claimGeometryLifecycle(document, 'sidebar-board-cutout');
        let structureObserver = null;
        let layoutObserver = null;
        let resizeObserver = null;
        let observedLayer = null;
        let observedHole = null;
        let observedFrame = null;
        let observedHandle = null;
        const clear = () => {
          document.querySelectorAll('[data-dsh-fairy-sidebar-layer="true"]').forEach((node) => {
            node.style.removeProperty('--dsh-sidebar-board-clip');
            node.removeAttribute('data-dsh-fairy-sidebar-geometry');
          });
        };
        const bindOwners = () => {
          const layer = document.querySelector('[data-dsh-fairy-sidebar-layer="true"]');
          const hole = document.querySelector('[data-dsh-fairy-history-surface="true"]');
          const ownerFrame = layer?.parentElement || null;
          const handle = sidebarResizeHandle(ownerFrame) || sidebarResizeHandle(document);
          if (layer === observedLayer && hole === observedHole && ownerFrame === observedFrame && handle === observedHandle) return;
          lifecycle.replaceBinding('sidebar-owner', () => {
            resizeObserver?.disconnect();
            layoutObserver?.disconnect();
          }, 'sidebar-board:owner-observers');
          observedLayer = layer;
          observedHole = hole;
          observedFrame = ownerFrame;
          observedHandle = handle;
          resizeObserver?.disconnect();
          layoutObserver?.disconnect();
          if (resizeObserver) {
            if (layer) resizeObserver.observe(layer);
            if (hole) resizeObserver.observe(hole);
            if (ownerFrame) resizeObserver.observe(ownerFrame);
          }
          if (layoutObserver) {
            if (ownerFrame) layoutObserver.observe(ownerFrame, {
              attributes: true,
              attributeFilter: ['style', 'data-dragging', 'data-sidebar-collapsed'],
            });
            if (handle) layoutObserver.observe(handle, {
              attributes: true,
              attributeFilter: ['style', 'data-dragging'],
            });
          }
        };
        const sync = () => {
          bindOwners();
          const layer = document.querySelector('[data-dsh-fairy-sidebar-layer="true"]');
          const hole = document.querySelector('[data-dsh-fairy-history-surface="true"]');
          if (!enabled || !layer) return clear();
          const layerRect = layer.getBoundingClientRect();
          if (layerRect.width < 1 || layerRect.height < 1) return clear();
          const outer = roundedRectPath(0, 0, layerRect.width, layerRect.height, 0);
          // A collapsed sidebar has no history surface to cut out. In that
          // state the board must remain a complete material panel; the hole
          // is optional and is added again when the official history surface
          // returns after expansion.
          const holeRect = hole?.getBoundingClientRect();
          const hasHole = holeRect && holeRect.width >= 1 && holeRect.height >= 1;
          const inner = hasHole ? roundedRectPath(
            holeRect.left - layerRect.left,
            holeRect.top - layerRect.top,
            holeRect.right - layerRect.left,
            holeRect.bottom - layerRect.top,
            10,
          ) : null;
          layer.style.setProperty('--dsh-sidebar-board-clip', `path(evenodd, "${outer}${inner ? ` ${inner}` : ''}")`);
          layer.setAttribute('data-dsh-fairy-sidebar-geometry', 'ready');
        };
        const schedule = () => {
          if (!lifecycle.disposed) lifecycle.scheduleFrame('sidebar-board-sync', sync, 'sidebar-board:sync-frame');
        };
        if (typeof ResizeObserver === 'function') {
          resizeObserver = new ResizeObserver(() => {
            bindOwners();
            schedule();
          });
        }
        if (typeof MutationObserver === 'function') {
          layoutObserver = createManagedMutationObserver(schedule);
        }
        bindOwners();
        sync();
        if (typeof MutationObserver === 'function' && document.body) {
          structureObserver = createManagedMutationObserver((records) => {
            if (mutationTouchesSurface(records, `${OFFICIAL_SELECTORS.sidebar}, [data-dsh-fairy-sidebar-layer="true"], [data-dsh-fairy-history-surface="true"]`, ['aria-expanded', OFFICIAL_ATTRIBUTES.phase, OFFICIAL_ATTRIBUTES.slot, 'data-dsh-fairy-sidebar-layer', 'data-dsh-fairy-history-surface'])) schedule();
          });
          structureObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
              'aria-expanded',
              OFFICIAL_ATTRIBUTES.phase,
              OFFICIAL_ATTRIBUTES.slot,
              'data-dsh-fairy-sidebar-layer',
              'data-dsh-fairy-history-surface',
            ],
          });
        }
        window.addEventListener('resize', schedule, { passive: true });
        const cleanup = () => {
          resizeObserver?.disconnect();
          structureObserver?.disconnect();
          layoutObserver?.disconnect();
          window.removeEventListener('resize', schedule);
          clear();
        };
        lifecycle.add(cleanup, 'sidebar-board:restore-geometry');
        return () => lifecycle.dispose();
      }, [enabled]);
      return null;
    }
  return { SidebarBoardCutout };
}

module.exports = { install };

