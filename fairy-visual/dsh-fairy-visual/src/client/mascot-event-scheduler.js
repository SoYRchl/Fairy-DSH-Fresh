'use strict';

/* Bounded one-shot scheduler: one live callback per logical animation task. */
function createMascotEventScheduler() {
  const tasks = new Map();
  const schedule = (name, callback, delay) => {
    const previous = tasks.get(name);
    if (previous) clearTimeout(previous.timer);
    const token = (previous?.token || 0) + 1;
    const entry = { token, timer: null };
    entry.timer = setTimeout(() => {
      if (tasks.get(name) !== entry) return;
      tasks.delete(name);
      callback();
    }, Math.max(0, Number(delay) || 0));
    tasks.set(name, entry);
    return entry.timer;
  };
  const cancel = (name) => {
    const entry = tasks.get(name);
    if (!entry) return;
    clearTimeout(entry.timer);
    tasks.delete(name);
  };
  return Object.freeze({
    schedule,
    cancel,
    cancelAll: () => [...tasks.keys()].forEach(cancel),
    has: (name) => tasks.has(name),
    activeCount: () => tasks.size,
  });
}

module.exports = { createMascotEventScheduler };
