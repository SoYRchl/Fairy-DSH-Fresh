const SLOT_MARKER = 'data-dsh-fairy-to-bottom-slot';
const CONTROL_MARKER = 'data-dsh-fairy-to-bottom-control';
const OFFSET_PROPERTY = '--dsh-fairy-to-bottom-offset';
const ROOT_BOTTOM_PROPERTY = '--dsh-fairy-to-bottom-bottom';
const GAP = 12;
const { toBottomControl } = require('./dom-adapter.js');

function createToBottomPositioner({ getScrollNodes, getComposerNode, requestFrame, cancelFrame, isDisposed }) {
  let frame = 0;
  let tracked = new Map();
  let scrollNodes = new Set();
  const controlMarkers = new Map();
  let rootProperty = null;
  let rootPriority = '';

  const schedule = () => {
    if (!frame && !isDisposed()) frame = requestFrame(sync);
  };
  const bindScrollNodes = () => {
    const next = new Set((getScrollNodes?.() || []).filter(Boolean));
    scrollNodes.forEach((node) => { if (!next.has(node)) node.removeEventListener('scroll', schedule); });
    next.forEach((node) => { if (!scrollNodes.has(node)) node.addEventListener('scroll', schedule, { passive: true }); });
    scrollNodes = next;
  };
  const restoreNode = ({ node, slot, property, priority }) => {
    if (slot?.isConnected) slot.removeAttribute(SLOT_MARKER);
    if (!node?.isConnected) return;
    if (property === '') node.style.removeProperty(OFFSET_PROPERTY);
    else node.style.setProperty(OFFSET_PROPERTY, property, priority);
  };
  const syncControlMarkers = (activeControls) => {
    activeControls.forEach((control) => {
      if (!controlMarkers.has(control)) {
        controlMarkers.set(control, control.getAttribute(CONTROL_MARKER));
      }
      control.setAttribute(CONTROL_MARKER, 'true');
    });
    controlMarkers.forEach((previousValue, control) => {
      if (activeControls.has(control)) return;
      if (control.isConnected) {
        if (previousValue === null) control.removeAttribute(CONTROL_MARKER);
        else control.setAttribute(CONTROL_MARKER, previousValue);
      }
      controlMarkers.delete(control);
    });
  };
  const restoreRoot = () => {
    const root = document.documentElement;
    if (rootProperty === null) root.style.removeProperty(ROOT_BOTTOM_PROPERTY);
    else root.style.setProperty(ROOT_BOTTOM_PROPERTY, rootProperty, rootPriority);
    rootProperty = null;
    rootPriority = '';
  };

  function sync() {
    frame = 0;
    bindScrollNodes();
    const composerRect = getComposerNode?.()?.getBoundingClientRect?.();
    const next = new Map();
    const activeControls = new Set();
    let bottom = null;
    scrollNodes.forEach((node) => {
      const previous = tracked.get(node) || {
        node,
        slot: null,
        property: node.style.getPropertyValue(OFFSET_PROPERTY),
        priority: node.style.getPropertyPriority(OFFSET_PROPERTY),
      };
      const button = toBottomControl(node) || toBottomControl(document);
      if (button) activeControls.add(button);
      const slot = button?.closest?.('.toBottomSlot') || button?.parentElement || null;
      if (slot) slot.setAttribute(SLOT_MARKER, 'true');
      if (previous.slot && previous.slot !== slot && previous.slot.isConnected) previous.slot.removeAttribute(SLOT_MARKER);
      if (composerRect && composerRect.height > 0) {
        const scrollRect = node.getBoundingClientRect();
        const inset = Math.ceil(Math.max(0, scrollRect.bottom - composerRect.top) + GAP);
        node.style.setProperty(OFFSET_PROPERTY, `${inset}px`, 'important');
        bottom = Math.max(bottom ?? 0, inset);
      }
      next.set(node, { node, slot, property: previous.property, priority: previous.priority });
    });
    syncControlMarkers(activeControls);
    if (bottom !== null) {
      const root = document.documentElement;
      if (rootProperty === null) {
        rootProperty = root.style.getPropertyValue(ROOT_BOTTOM_PROPERTY);
        rootPriority = root.style.getPropertyPriority(ROOT_BOTTOM_PROPERTY);
      }
      root.style.setProperty(ROOT_BOTTOM_PROPERTY, `${bottom}px`, 'important');
    } else restoreRoot();
    tracked.forEach((previous, node) => { if (!next.has(node) || !node.isConnected) restoreNode(previous); });
    tracked = next;
  }

  const flush = () => { if (frame) cancelFrame(frame); frame = 0; sync(); };
  const clear = () => {
    if (frame) cancelFrame(frame);
    frame = 0;
    scrollNodes.forEach((node) => node.removeEventListener('scroll', schedule));
    scrollNodes.clear();
    tracked.forEach(restoreNode);
    tracked.clear();
    syncControlMarkers(new Set());
    restoreRoot();
  };
  return { schedule, flush, clear };
}

module.exports = { createToBottomPositioner };
