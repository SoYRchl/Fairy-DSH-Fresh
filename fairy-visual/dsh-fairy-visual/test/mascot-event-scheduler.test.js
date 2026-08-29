import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client/mascot-event-scheduler.js', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(source, { module, exports: module.exports, setTimeout, clearTimeout });
const { createMascotEventScheduler } = module.exports;

test('scheduler keeps one live timer per task and cancels stale callbacks', async () => {
  const scheduler = createMascotEventScheduler();
  let calls = 0;
  scheduler.schedule('glitch', () => { calls += 1; }, 25);
  scheduler.schedule('glitch', () => { calls += 10; }, 5);
  assert.equal(scheduler.activeCount(), 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 10);
  assert.equal(scheduler.activeCount(), 0);
});

test('scheduler cancelAll returns the timer registry to zero', () => {
  const scheduler = createMascotEventScheduler();
  scheduler.schedule('glitch', () => {}, 1000);
  scheduler.schedule('flicker', () => {}, 1000);
  scheduler.schedule('transition', () => {}, 1000);
  assert.equal(scheduler.activeCount(), 3);
  scheduler.cancelAll();
  assert.equal(scheduler.activeCount(), 0);
});
