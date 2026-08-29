import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { analyze, parseRuns } = require('../log-triage.js');

const fixture = `===== DSH_WEB_RUN_BEGIN =====
event=run_begin
timestamp=2026-08-27T08:00:00Z
run_id=old-run
===== END DSH_WEB_RUN_BEGIN =====
dsh-fairy-visual build output is missing
source is newer than generated outputs
Error: Cannot find module Cordis
===== DSH_WEB_RUN_FAILED =====
event=run_failed
timestamp=2026-08-27T08:00:03Z
run_id=old-run
dsh_pid=100
===== END DSH_WEB_RUN_FAILED =====
===== DSH_WEB_RUN_BEGIN =====
event=run_begin
timestamp=2026-08-27T10:00:00Z
run_id=current-run
===== END DSH_WEB_RUN_BEGIN =====
===== DSH_WEB_RUN_READY =====
event=run_ready
timestamp=2026-08-27T10:00:02Z
run_id=current-run
dsh_pid=200
===== END DSH_WEB_RUN_READY =====
DSH_FAIRY_LOG {"schema":1,"timestamp":"2026-08-27T10:05:00Z","level":"warn","module":"dsh-fairy-voice","operation":"tts.stream","event":"failure","context":{"code":"local-service-failed"},"error":{"message":"client-aborted"}}
DSH_FAIRY_LOG {"schema":1,"timestamp":"2026-08-27T10:05:00Z","level":"info","module":"dsh-fairy-voice","operation":"tts.stream","event":"metric","context":{"aborted":true}}
`;

test('defaults to the newest run_id boundary and ignores historical failures', () => {
  const result = analyze(fixture);
  assert.equal(result.runId, 'current-run');
  assert.equal(result.status, 'healthy');
  assert.equal(result.terminal, 'ready');
  assert.equal(result.actionable.length, 0);
  assert.equal(result.expectedCancellationEvents.length, 2);
  assert.equal(result.historicalBeforeBoundary.knownFaults, 3);
});

test('can inspect an explicit historical run without mixing the next run', () => {
  const result = analyze(fixture, { runId: 'old-run' });
  assert.equal(result.status, 'failed');
  assert.equal(result.terminal, 'failed');
  assert.deepEqual(result.actionable.map(({ code }) => code), [
    'build-output-missing',
    'source-newer-than-bundle',
    'module-missing',
  ]);
  assert.equal(result.rawLines.some((line) => line.includes('client-aborted')), false);
});

test('applies an ISO time floor inside the selected run', () => {
  const result = analyze(fixture, { sinceMs: Date.parse('2026-08-27T10:06:00Z') });
  assert.equal(result.expectedCancellationEvents.length, 0);
  assert.equal(result.analyzedSince, '2026-08-27T10:06:00.000Z');
});

test('rejects logs without an explicit run boundary', () => {
  assert.equal(parseRuns('source is newer than bundle').runs.length, 0);
  assert.throws(() => analyze('source is newer than bundle'), /no DSH_WEB_RUN_BEGIN segment found/);
});
