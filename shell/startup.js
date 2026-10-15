// Splash renderer: fetch animation data once, play the video full-window and
// report the playback state; the skip button asks for early entry. Entry
// decisions stay entirely in the main process.
'use strict';
const video = document.getElementById('animation');
const skip = document.getElementById('skip');

function notifyFailed() {
  window.fairyStartup.finished('failed').catch(() => {});
}

function apply(settings) {
  if (video.src !== settings.url) video.src = settings.url;
  video.loop = !settings.waitForEnd;
  video.muted = settings.muted;
  video.playbackRate = settings.speed;
  video.play().catch(notifyFailed);
}

document.addEventListener('DOMContentLoaded', () => {
  video.addEventListener('ended', () => {
    window.fairyStartup.finished('ended').catch(() => {});
  });
  video.addEventListener('error', notifyFailed);
  skip.addEventListener('click', () => window.fairyStartup.dismiss().catch(() => {}));
  window.fairyStartup.get().then(apply).catch(notifyFailed);
});
