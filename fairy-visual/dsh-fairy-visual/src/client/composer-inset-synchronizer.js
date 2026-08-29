function createInsetSynchronizer({ getScrollNodes, getHeight, requestFrame, cancelFrame, isDisposed }) {
  let frame = 0;
  let tracked = new Map();

  const restorePadding = ({ node, padding, paddingPriority }) => {
    if (!node?.isConnected) return;
    if (padding === '') node.style.removeProperty('padding-bottom');
    else node.style.setProperty('padding-bottom', padding, paddingPriority);
    node.style.removeProperty('--dsh-fairy-composer-inset');
  };

  const sync = () => {
    frame = 0;
    const height = getHeight();
    const next = new Map();
    getScrollNodes().forEach((node) => {
      const existing = tracked.get(node);
      const padding = existing?.padding ?? node.style.getPropertyValue('padding-bottom');
      const paddingPriority = existing?.paddingPriority ?? node.style.getPropertyPriority('padding-bottom');
      const basePadding = existing?.basePadding ?? getComputedStyle(node).paddingBottom;
      next.set(node, { node, padding, paddingPriority, basePadding });
      node.style.setProperty('--dsh-fairy-composer-inset', String(height) + 'px');
      // The official seat ResizeObserver owns --dsh-composer-height. Fairy
      // reserves room for its fixed dock through padding only, so normal mode
      // never inherits an HDD value while the official seat is remeasured.
      node.style.setProperty('padding-bottom', 'calc(' + basePadding + ' + ' + height + 'px)', 'important');
    });
    tracked.forEach((previous, node) => {
      if (next.has(node)) return;
      restorePadding(previous);
    });
    tracked = next;
  };

  const schedule = () => {
    if (!frame && !isDisposed()) frame = requestFrame(sync);
  };

  const flush = () => {
    if (frame) cancelFrame(frame);
    frame = 0;
    sync();
  };

  const clear = () => {
    if (frame) cancelFrame(frame);
    frame = 0;
    tracked.forEach(restorePadding);
    tracked.clear();
  };

  return { schedule, flush, clear };
}

module.exports = { createInsetSynchronizer };
