// Splash renderer: clicking anywhere dismisses the animation. The status line
// text is switched by URL hash ("failed" shows a hint) but entry is decided
// entirely by the main process.
'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const line = document.getElementById('status-line');
  if (window.location.hash === '#failed' && line) {
    line.textContent = '\u542f\u52a8\u53d7\u963b\uff0c\u8bf7\u67e5\u770b\u8bca\u65ad\u65e5\u5fd7';
  }
  document.getElementById('fairy-splash').addEventListener('click', () => {
    try { window.fairyShell.dismissStartup(); } catch {}
  });
});
