import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client/mascot-motion-clock.js', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(source, { module, exports: module.exports });
const { createMascotMotionClock } = module.exports;

test('MascotMotionClock preserves phase across rate changes and pause/resume', () => {
  let now = 0;
  const clock = createMascotMotionClock({ now: () => now, cycleMs: 1440, rate: 1 });
  now = 360;
  assert.equal(clock.phase(), 0.25);
  clock.setRate(1.5);
  assert.equal(clock.phase(), 0.25);
  now = 600;
  assert.equal(clock.phase(), 0.5);
  clock.pause();
  now = 1200;
  assert.equal(clock.phase(), 0.5);
  clock.resume();
  now = 1440;
  assert.equal(clock.phase(), 0.75);
});

test('MascotMotionClock fails closed for invalid cycle and normalizes rates', () => {
  assert.throws(() => createMascotMotionClock({ cycleMs: 0 }), /Invalid Fairy motion clock cycle/);
  let now = 0;
  const clock = createMascotMotionClock({ now: () => now, rate: 0 });
  now = 1440;
  assert.equal(clock.phase(), 0);
  clock.setRate(Number.NaN);
  assert.equal(clock.rate(), 1);
});
