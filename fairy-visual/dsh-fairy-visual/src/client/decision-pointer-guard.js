// [T-109] 并入自 Fairy 完整安装包（不明来源）的 composer-takeover-v2 修复组，
//   已按 02 §3「借壳不借包」人工审计后原样采纳：全文 51 行，逻辑自洽、无外部依赖、
//   不使用 eval/网络/宿主私有 API。原件 sha256 =
//   694C493113237217E43A63BC54871B88A1367A46C1EE5D7BEC7D387EA18F4D61
//   出处：Fairy-完整安装包/resources/homes/1-original/fairy-visual/dsh-fairy-visual/src/client/decision-pointer-guard.js
//   审计记录：Fairy-DSH焕新/07 与 logs/操作日志.md（2026-10-14）
// Retain a deliberate mouse click across a layout shift. No synthetic click,
// no pointerdown answer, and no change to the host's exactly-once/disabled logic.
function createDecisionPointerGuard({ documentRef = document, windowRef = window } = {}) {
  let press = null;
  const release = () => {
    if (!press) return;
    const { button, id } = press;
    press = null;
    try { if (button.hasPointerCapture(id)) button.releasePointerCapture(id); } catch (_) {}
  };
  const down = event => {
    release();
    if (event.defaultPrevented || event.button !== 0 || event.pointerType !== 'mouse' || !event.isPrimary) return;
    const button = event.target?.closest?.('[data-approval-key] button, [data-question-key] button, [data-plan-review-key] button');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    try {
      button.setPointerCapture(event.pointerId);
      press = { button, id: event.pointerId, x: event.clientX, y: event.clientY };
    } catch (_) {} // Unsupported browser: leave the native click untouched.
  };
  const move = event => {
    if (!press || event.pointerId !== press.id) return;
    // Dragging away/scrolling is cancellation, not consent. Capture is only
    // retained when the pointer stays at the deliberately pressed location.
    if (!press.button.isConnected || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) release();
  };
  const up = event => {
    if (!press || event.pointerId !== press.id) return;
    // Native implicit release after pointerup preserves the native click target.
    press = null;
  };
  const hidden = () => { if (documentRef.hidden) release(); };
  documentRef.addEventListener('pointerdown', down, true);
  documentRef.addEventListener('pointermove', move, true);
  documentRef.addEventListener('pointerup', up, true);
  documentRef.addEventListener('pointercancel', release, true);
  documentRef.addEventListener('visibilitychange', hidden);
  windowRef.addEventListener('blur', release);
  windowRef.addEventListener('pagehide', release);
  return { dispose() {
    release();
    documentRef.removeEventListener('pointerdown', down, true);
    documentRef.removeEventListener('pointermove', move, true);
    documentRef.removeEventListener('pointerup', up, true);
    documentRef.removeEventListener('pointercancel', release, true);
    documentRef.removeEventListener('visibilitychange', hidden);
    windowRef.removeEventListener('blur', release);
    windowRef.removeEventListener('pagehide', release);
  } };
}
module.exports = { createDecisionPointerGuard };
