'use strict';

/* One monotonic, normalized phase for every Fairy eye motion consumer. */
function createMascotMotionClock({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), cycleMs = 1440, rate = 1 } = {}) {
  if (!Number.isFinite(cycleMs) || cycleMs <= 0) throw new Error('Invalid Fairy motion clock cycle');
  let epoch = now();
  let phase = 0;
  let currentRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  let paused = false;
  let pausedAt = epoch;
  const read = () => {
    if (paused) return phase;
    const elapsed = Math.max(0, now() - epoch) * currentRate;
    return ((phase + elapsed / cycleMs) % 1 + 1) % 1;
  };
  return Object.freeze({
    phase: read,
    timeline: (nextCycleMs = cycleMs) => read() * nextCycleMs,
    rate: () => currentRate,
    setRate: (nextRate) => {
      const timestamp = now();
      phase = read();
      currentRate = Number.isFinite(nextRate) && nextRate > 0 ? nextRate : 1;
      epoch = timestamp;
      pausedAt = timestamp;
    },
    pause: () => {
      if (paused) return;
      pausedAt = now();
      phase = read();
      paused = true;
    },
    resume: () => {
      if (!paused) return;
      epoch = now();
      paused = false;
    },
    reset: () => {
      epoch = now();
      phase = 0;
      pausedAt = epoch;
      paused = false;
    },
    isPaused: () => paused,
    pausedAt: () => pausedAt,
  });
}

module.exports = { createMascotMotionClock };
