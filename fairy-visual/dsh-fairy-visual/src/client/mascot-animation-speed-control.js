const BASE_ATTR = 'data-dsh-fairy-mascot-animation-speed-base';
const CONTROL_ATTR = 'data-dsh-fairy-mascot-animation-speed-control';
const TICK_ATTR = 'data-dsh-fairy-mascot-animation-speed-tick';
const THUMB_ATTR = 'data-dsh-fairy-mascot-animation-speed-thumb';
const POSITION_ATTR = 'data-dsh-fairy-mascot-animation-speed-position';
const SPEED_EVENT = 'dsh-fairy-mascot-animation-speed';
const SPEED_STOPS = Object.freeze([
  Object.freeze({ position: 0, rate: 0.7, label: '0.7' }),
  Object.freeze({ position: 0.5, rate: 1, label: '1' }),
  Object.freeze({ position: 1, rate: 1.5, label: '1.5' }),
]);
/* Composer rebinds must not reset the displayed detent while the mascot keeps
 * running. This module-level state is shared by every replacement control. */
let selectedPosition = 0.5;

function positionForRate(rate) {
  const match = SPEED_STOPS.find((stop) => stop.rate === rate);
  return match?.position ?? 0.5;
}

function bindVisualDrag(control, documentRef, options = {}) {
  if (!control || control.__dshFairySpeedDrag) return () => {};
  const positions = [0, 0.5, 1];
  selectedPosition = positionForRate(options.initialRate);
  let dragging = false;
  const emitSpeed = (position) => {
    const stop = SPEED_STOPS.find((candidate) => candidate.position === position) || SPEED_STOPS[1];
    selectedPosition = stop.position;
    options.onChange?.(stop.rate);
    const target = documentRef?.defaultView || (typeof window !== 'undefined' ? window : null);
    if (typeof CustomEvent !== 'function' || !target?.dispatchEvent) return;
    target.dispatchEvent(new CustomEvent(SPEED_EVENT, { detail: { rate: stop.rate, position: stop.position } }));
  };

  const setPosition = (position, animate = true) => {
    control.setAttribute(POSITION_ATTR, String(position));
    control.setAttribute('data-dragging', animate ? 'false' : 'true');
  };
  const positionFromEvent = (event) => {
    const rect = control.getBoundingClientRect();
    if (!rect.width) return 0.5;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  const snap = (value) => positions.reduce((closest, candidate) => (
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  ), positions[0]);
  const onPointerMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    setPosition(snap(positionFromEvent(event)), false);
  };
  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    control.releasePointerCapture?.(event.pointerId);
    documentRef.removeEventListener('pointermove', onPointerMove);
    documentRef.removeEventListener('pointerup', onPointerUp);
    documentRef.removeEventListener('pointercancel', onPointerUp);
    const position = snap(positionFromEvent(event));
    setPosition(position, true);
    emitSpeed(position);
  };
  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    control.setPointerCapture?.(event.pointerId);
    documentRef.addEventListener('pointermove', onPointerMove, { passive: false });
    documentRef.addEventListener('pointerup', onPointerUp);
    documentRef.addEventListener('pointercancel', onPointerUp);
    const position = snap(positionFromEvent(event));
    setPosition(position, false);
    emitSpeed(position);
    event.preventDefault();
  };

  control.addEventListener('pointerdown', onPointerDown, { passive: false });
  control.__dshFairySpeedDrag = true;
  setPosition(selectedPosition, true);
  return () => {
    control.removeEventListener('pointerdown', onPointerDown);
    documentRef.removeEventListener('pointermove', onPointerMove);
    documentRef.removeEventListener('pointerup', onPointerUp);
    documentRef.removeEventListener('pointercancel', onPointerUp);
    delete control.__dshFairySpeedDrag;
  };
}

// Paint-only shell for the future Fairy steady-animation speed control. The
// module deliberately owns no input, setting, or animation state yet.
function createMascotAnimationSpeedBase(host, documentRef = document, options = {}) {
  if (!host) return null;
  const existing = host.querySelector?.(`[${BASE_ATTR}="true"]`);
  if (existing) {
    const control = existing.querySelector(`[${CONTROL_ATTR}="true"]`);
    const disposeDrag = bindVisualDrag(control, documentRef, options);
    return { host, node: existing, dispose() { disposeDrag(); if (existing.parentElement === host) existing.remove(); } };
  }

  const base = documentRef.createElement('span');
  base.setAttribute(BASE_ATTR, 'true');
  base.setAttribute('aria-hidden', 'true');
  const control = documentRef.createElement('span');
  control.setAttribute(CONTROL_ATTR, 'true');
  ['0.7', '1', '1.5'].forEach((speed) => {
    const tick = documentRef.createElement('span');
    tick.setAttribute(TICK_ATTR, speed);
    tick.setAttribute('aria-hidden', 'true');
    control.appendChild(tick);
  });
  const thumb = documentRef.createElement('span');
  thumb.setAttribute(THUMB_ATTR, '1');
  thumb.setAttribute('aria-hidden', 'true');
  control.appendChild(thumb);
  base.appendChild(control);
  const disposeDrag = bindVisualDrag(control, documentRef, options);
  host.appendChild(base);

  return {
    host,
    node: base,
    dispose() { disposeDrag(); if (base.parentElement === host) base.remove(); },
  };
}

module.exports = { BASE_ATTR, CONTROL_ATTR, TICK_ATTR, THUMB_ATTR, POSITION_ATTR, SPEED_EVENT, SPEED_STOPS, createMascotAnimationSpeedBase };
