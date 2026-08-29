const { OFFICIAL_SELECTORS } = require('./dom-adapter.js');

const ANCHORED_CLASS = 'dsh-fairy-chat-content-anchored';
const ANCHOR_MIN_HEIGHT = '--dsh-fairy-chat-anchor-min-height';

function createChatContentAnchor({
  getFlowNodes,
  getComposerNode,
  requestFrame,
  cancelFrame,
  isDisposed,
}) {
  let frame = 0;
  let tracked = new Map();
  let resizeObserver = null;
  let resizeNodes = new Set();

  const restore = (node, previous) => {
    if (!node?.isConnected) return;
    node.classList.remove(ANCHORED_CLASS);
    if (previous.anchorMinHeight === '') node.style.removeProperty(ANCHOR_MIN_HEIGHT);
    else node.style.setProperty(ANCHOR_MIN_HEIGHT, previous.anchorMinHeight);
  };

  const bindResizeNodes = () => {
    if (typeof ResizeObserver !== 'function') return;
    const next = new Set([...(getFlowNodes?.() || []), getComposerNode?.()].filter(Boolean));
    if (next.size === resizeNodes.size && [...next].every((node) => resizeNodes.has(node))) return;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(schedule);
    next.forEach((node) => resizeObserver.observe(node));
    resizeNodes = next;
  };

  const sync = () => {
    frame = 0;
    bindResizeNodes();
    const composerRect = getComposerNode?.()?.getBoundingClientRect?.();
    const next = new Map();
    if (!composerRect || composerRect.width < 1 || composerRect.height < 1) {
      tracked.forEach((previous, node) => restore(node, previous));
      tracked.clear();
      return;
    }

    (getFlowNodes?.() || []).forEach((node) => {
      if (!node?.isConnected) return;
      const previous = tracked.get(node) || {
        anchorMinHeight: node.style.getPropertyValue(ANCHOR_MIN_HEIGHT),
        anchored: false,
      };

      // Measure the natural flow. Scroll events never call this module, so
      // temporarily releasing the anchor cannot race browser scroll anchoring.
      if (previous.anchored) {
        node.classList.remove(ANCHORED_CLASS);
        if (previous.anchorMinHeight === '') node.style.removeProperty(ANCHOR_MIN_HEIGHT);
        else node.style.setProperty(ANCHOR_MIN_HEIGHT, previous.anchorMinHeight);
      }

      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      next.set(node, previous);
      const scroll = node.closest?.(OFFICIAL_SELECTORS.conversationScroll);
      const scrollRect = scroll?.getBoundingClientRect?.();
      const availableHeight = scrollRect ? Math.max(0, composerRect.top - scrollRect.top) : composerRect.top;
      const parentStyle = node.parentElement ? getComputedStyle(node.parentElement) : null;
      const parentBottomPadding = Number.parseFloat(parentStyle?.paddingBottom || '0') || 0;
      const short = rect.height <= availableHeight + parentBottomPadding + 1;

      if (short) {
        const minHeight = Math.max(0, Math.ceil(rect.height + composerRect.top - rect.bottom));
        node.style.setProperty(ANCHOR_MIN_HEIGHT, `${minHeight}px`);
        node.classList.add(ANCHORED_CLASS);
        previous.anchored = true;
      } else {
        previous.anchored = false;
      }
    });

    tracked.forEach((previous, node) => {
      if (!next.has(node)) restore(node, previous);
    });
    tracked = next;
  };

  function schedule() {
    if (!frame && !isDisposed?.()) frame = requestFrame(sync);
  }

  const flush = () => {
    if (frame) cancelFrame(frame);
    frame = 0;
    sync();
  };

  const clear = () => {
    if (frame) cancelFrame(frame);
    frame = 0;
    resizeObserver?.disconnect();
    resizeObserver = null;
    resizeNodes.clear();
    tracked.forEach((previous, node) => restore(node, previous));
    tracked.clear();
  };

  return { schedule, flush, clear };
}

module.exports = { createChatContentAnchor };
