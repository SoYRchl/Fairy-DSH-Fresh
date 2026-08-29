const HEIGHT_MIN = 132;
const HEIGHT_MAX = 420;
const CONTENT_MIN = 176;
const { createPointerDrag } = require('./pointer-drag.js');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function createResizeController({
  isEnabled,
  getSeat,
  getHeight,
  getRenderedHeight = getHeight,
  setHeight,
  schedule,
  scheduleInsets,
  flushInsets,
  persistHeight,
}) {
  let handle = null;
  let dragging = null;
  let pointerDrag = null;

  const maxHeight = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, viewportHeight - CONTENT_MIN));
  };

  const updateHandle = () => {
    if (!handle) return;
    handle.setAttribute('aria-valuemin', String(HEIGHT_MIN));
    handle.setAttribute('aria-valuemax', String(Math.round(maxHeight())));
    handle.setAttribute('aria-valuenow', String(Math.round(getRenderedHeight())));
  };

  const updateHeight = (next, persist = false) => {
    const height = clamp(next, HEIGHT_MIN, maxHeight());
    setHeight(height);
    const seat = getSeat();
    if (seat) {
      const value = String(Math.round(getRenderedHeight())) + 'px';
      seat.style.setProperty('height', value);
      seat.style.setProperty('--dsh-fairy-composer-height', value);
    }
    scheduleInsets();
    schedule();
    updateHandle();
    if (persist) {
      flushInsets();
      persistHeight(Math.round(height));
    }
  };

  function onPointerDown(event) {
    if (!isEnabled() || !handle) return;
    const payload = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: getHeight(),
      handle,
    };
    pointerDrag.start(event, payload);
  }

  const finishDragging = (event, persist) => {
    if (!pointerDrag?.active) return;
    pointerDrag.finish(event, persist, persist ? 'manual' : 'cancel');
  };

  // The shared session keeps the transition lock through the release frame so
  // final height, inset and material geometry settle before transitions resume.
  pointerDrag = createPointerDrag({
    getTarget: () => handle,
    getLockNodes: () => [getSeat()],
    onStart: (_event, session) => {
      dragging = session.payload;
    },
    onMove: (event, session) => {
      const drag = session.payload;
      updateHeight(drag.startHeight - (event.clientY - drag.startY));
    },
    onEnd: () => {
      updateHeight(getHeight(), true);
      dragging = null;
    },
    onCancel: (_event, _session, reason) => {
      if (reason === 'blur' || reason === 'pointercancel') updateHeight(getHeight(), true);
      dragging = null;
    },
  });

  function onKeyDown(event) {
    if (!isEnabled()) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? 8 : event.key === 'ArrowDown' ? -8 : 0;
      const next = event.key === 'Home' ? HEIGHT_MIN : event.key === 'End' ? HEIGHT_MAX : getHeight() + delta;
      updateHeight(next, true);
    }
  }

  const mount = () => {
    const seat = getSeat();
    if (!seat || handle) return;
    handle = document.createElement('div');
    handle.className = 'dsh-fairy-composer-resizer';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', '调整输入控制台高度');
    handle.tabIndex = 0;
    seat.appendChild(handle);
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('keydown', onKeyDown);
    updateHandle();
  };

  const unmount = () => {
    pointerDrag?.dispose();
    dragging = null;
    handle?.removeEventListener('pointerdown', onPointerDown);
    handle?.removeEventListener('keydown', onKeyDown);
    handle?.remove();
    handle = null;
  };

  return {
    mount,
    unmount,
    updateHeight,
    updateHandle,
    finishDragging,
    get handle() { return handle; },
    get dragging() { return dragging; },
  };
}

module.exports = { createResizeController, HEIGHT_MIN, HEIGHT_MAX, CONTENT_MIN };
