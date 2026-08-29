const LOCK_ATTRIBUTE = 'data-dsh-fairy-selection-lock';

// Lifecycle: selection guard
// Owner: plugin apply scope
// Contract: lifecycle-ownership.json#owners[subsystem=selection guard]
// Text selection is still valid inside the official composer. Only explicit
// drag handles acquire this short-lived document-level lock.
function createSelectionGuard({
  documentRef,
  windowRef,
  selector,
  maxDuration = 15000,
} = {}) {
  const doc = documentRef || (typeof document !== 'undefined' ? document : null);
  const win = windowRef || (typeof window !== 'undefined' ? window : null);
  const root = doc?.documentElement;
  if (!doc || !win || !root || !selector) return { dispose() {} };

  let pointerId = null;
  let safetyTimer = 0;

  const clear = () => {
    pointerId = null;
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = 0;
    }
    root.removeAttribute(LOCK_ATTRIBUTE);
  };

  const arm = (event) => {
    const target = event?.target?.closest?.(selector);
    if (!target || (event.button != null && event.button !== 0)) return;
    pointerId = event.pointerId ?? 'mouse';
    root.setAttribute(LOCK_ATTRIBUTE, 'true');
    if (safetyTimer) clearTimeout(safetyTimer);
    // A lost native pointerup must not permanently disable text selection.
    safetyTimer = setTimeout(clear, maxDuration);
  };

  const end = (event) => {
    if (pointerId === null) return;
    if (event?.pointerId != null && event.pointerId !== pointerId) return;
    clear();
  };

  const preventSelection = (event) => {
    if (root.hasAttribute(LOCK_ATTRIBUTE)) event.preventDefault();
  };
  const onMouseDown = (event) => {
    if (pointerId === null) arm(event);
  };
  const onDocumentVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') clear();
  };
  const onPageHide = () => clear();

  doc.addEventListener('pointerdown', arm, true);
  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('selectstart', preventSelection, true);
  doc.addEventListener('dragstart', preventSelection, true);
  doc.addEventListener('visibilitychange', onDocumentVisibilityChange, true);
  win.addEventListener('pointerup', end, true);
  win.addEventListener('pointercancel', end, true);
  win.addEventListener('mouseup', end, true);
  win.addEventListener('blur', clear, true);
  win.addEventListener('pagehide', onPageHide, true);

  return {
    dispose() {
      doc.removeEventListener('pointerdown', arm, true);
      doc.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('selectstart', preventSelection, true);
      doc.removeEventListener('dragstart', preventSelection, true);
      doc.removeEventListener('visibilitychange', onDocumentVisibilityChange, true);
      win.removeEventListener('pointerup', end, true);
      win.removeEventListener('pointercancel', end, true);
      win.removeEventListener('mouseup', end, true);
      win.removeEventListener('blur', clear, true);
      win.removeEventListener('pagehide', onPageHide, true);
      clear();
    },
  };
}

module.exports = { createSelectionGuard, LOCK_ATTRIBUTE };
