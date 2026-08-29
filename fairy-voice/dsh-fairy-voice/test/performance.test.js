import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function loadRequestScope() {
  const start = clientSource.indexOf('function createVoiceRequestScope()');
  const end = clientSource.indexOf('function createSessionTimelineStore()', start);
  assert.ok(start >= 0 && end > start, 'voice request scope implementation is missing');
  const source = `${clientSource.slice(start, end)}\nmodule.exports = { createVoiceRequestScope };`;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    reportAudioLifecycleFailure() {},
  }, { filename: 'voice-request-scope.js' });
  return module.exports.createVoiceRequestScope;
}

test('cancelling a voice request leaves no residual timers', () => {
  const pending = new Set();
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    pending.add(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => pending.delete(timer);
  try {
    const createVoiceRequestScope = loadRequestScope();
    const scope = createVoiceRequestScope();
    for (let index = 0; index < 24; index += 1) scope.timeout(() => {}, index + 1);
    assert.equal(pending.size, 24);
    scope.cancel('measurement');
    scope.cancel('measurement-again');
    assert.equal(scope.cancelled, true);
    assert.equal(pending.size, 0);
    assert.equal(scope.timeout(() => {}, 1), 0);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});
