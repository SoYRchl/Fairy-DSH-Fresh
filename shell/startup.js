// Splash renderer: fetch animation data once, play the video, report the
// playback state, and offer a skip button. Entry decisions stay entirely in
// the main process; this page only mirrors them as status text.
'use strict';
const video = document.getElementById('animation');
const fallback = document.getElementById('fallback');
const status = document.getElementById('status');
const skip = document.getElementById('skip');
let completed = false;

function failed() {
  fallback.hidden = false;
  status.textContent = '\u52a8\u753b\u6682\u65f6\u65e0\u6cd5\u64ad\u653e\uff0c\u4e0d\u5f71\u54cd Fairy \u542f\u52a8\u3002';
  window.fairyStartup.finished('failed').catch(() => {});
}

function apply(settings) {
  if (video.src !== settings.url) {
    video.src = settings.url;
    fallback.hidden = true;
  }
  video.loop = !settings.waitForEnd;
  video.muted = settings.muted;
  video.playbackRate = settings.speed;
  status.textContent = completed
    ? '\u52a8\u753b\u5df2\u64ad\u5b8c\uff0c\u6b63\u5728\u7b49\u5f85 Fairy \u51c6\u5907\u5c31\u7eea\u2026'
    : (settings.waitForEnd
      ? '\u6b63\u5728\u542f\u52a8 Fairy\uff0c\u52a8\u753b\u64ad\u5b8c\u4e14\u4e3b\u754c\u9762\u5c31\u7eea\u540e\u8fdb\u5165\u2026'
      : '\u6b63\u5728\u542f\u52a8 DeepSeek Harness\uff0c\u8bf7\u7a0d\u5019\u2026');
  if (completed && settings.waitForEnd) return;
  video.play().catch(failed);
}

document.addEventListener('DOMContentLoaded', () => {
  video.addEventListener('ended', () => {
    completed = true;
    status.textContent = '\u52a8\u753b\u5df2\u64ad\u5b8c\uff0c\u6b63\u5728\u7b49\u5f85 Fairy \u51c6\u5907\u5c31\u7eea\u2026';
    window.fairyStartup.finished('ended').catch(() => {});
  });
  video.addEventListener('error', failed);
  video.addEventListener('loadedmetadata', () => { if (!video.error) fallback.hidden = true; });
  skip.addEventListener('click', () => window.fairyStartup.dismiss().catch(() => {}));
  window.fairyStartup.get().then(apply).catch(failed);
});
