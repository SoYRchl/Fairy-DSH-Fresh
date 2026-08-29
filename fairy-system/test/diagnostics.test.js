import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createFairyDiagnostics, FAIRY_LOG_PREFIX } from '../../fairy-contracts/diagnostics.js';

const require = createRequire(import.meta.url);
const { createFairyDiagnostics: createClientDiagnostics } = require('../../fairy-contracts/client-diagnostics.cjs');
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function captureSink() {
  const entries = [];
  return {
    entries,
    sink: {
      info: (value) => entries.push(value),
      warn: (value) => entries.push(value),
      error: (value) => entries.push(value),
    },
  };
}

function parse(line) {
  assert.match(line, /^DSH_FAIRY_LOG /);
  return JSON.parse(line.slice(`${FAIRY_LOG_PREFIX} `.length));
}

test('structured diagnostics redact secrets and emit stable performance fields', () => {
  const { entries, sink } = captureSink();
  let tick = 10;
  const diagnostics = createFairyDiagnostics('diagnostic-test', {
    sink,
    wallClock: () => '2026-08-27T00:00:00.000Z',
    monotonicClock: () => tick,
  });
  const startedAt = diagnostics.start();
  tick = 22.3456;
  diagnostics.metric('operation.measure', startedAt, { apiKey: 'must-not-leak', count: 2 });
  const record = parse(entries[0]);
  assert.deepEqual(record, {
    schema: 1,
    timestamp: '2026-08-27T00:00:00.000Z',
    level: 'info',
    module: 'diagnostic-test',
    operation: 'operation.measure',
    event: 'metric',
    context: { apiKey: '[redacted]', count: 2 },
    duration_ms: 12.346,
  });
});

test('sync and async boundaries log normalized failures and preserve rejection semantics', async () => {
  const { entries, sink } = captureSink();
  const diagnostics = createFairyDiagnostics('boundary-test', { sink, dedupeWindowMs: 0 });
  assert.throws(() => diagnostics.guard('apply', () => { throw Object.assign(new Error('broken'), { code: 'E_BROKEN' }); }), /broken/);
  await assert.rejects(diagnostics.guardAsync('request', async () => { throw new TypeError('offline'); }), /offline/);
  const records = entries.map(parse);
  assert.equal(records.filter((record) => record.event === 'failure').length, 2);
  assert.equal(records.filter((record) => record.event === 'metric').length, 2);
  assert.deepEqual(records[0].error, { name: 'Error', code: 'E_BROKEN', message: 'broken' });
});

test('browser diagnostics use the same prefix, schema, redaction, and duration contract', () => {
  const { entries, sink } = captureSink();
  const diagnostics = createClientDiagnostics('client-test', sink);
  diagnostics.error('request', new Error('failed'), { authorization: 'Bearer secret' });
  const record = parse(entries[0]);
  assert.equal(record.schema, 1);
  assert.equal(record.module, 'client-test');
  assert.equal(record.operation, 'request');
  assert.equal(record.context.authorization, '[redacted]');
  assert.equal(record.error.message, 'failed');
});

test('every Fairy plugin entrypoint owns a guarded top-level apply boundary', async () => {
  const sources = await Promise.all([
    read('../../balance-meter/dsh-balance-meter/lib/index.js'),
    read('../../balance-meter/dsh-balance-meter/lib/client.js'),
    read('../../browser-dock/dsh-browser-dock/src/index.js'),
    read('../../browser-dock/dsh-browser-dock/src/client/index.js'),
    read('../../fairy-startup/dsh-fairy-startup/lib/index.js'),
    read('../../fairy-startup/dsh-fairy-startup/lib/client.js'),
    read('../../fairy-voice/dsh-fairy-voice/lib/index.js'),
    read('../../fairy-voice/dsh-fairy-voice/lib/client.js'),
    read('../../fairy-visual/dsh-fairy-visual/src/index.js'),
    read('../../fairy-visual/dsh-fairy-visual/src/client/index.js'),
  ]);
  sources.forEach((source) => {
    assert.match(source, /function apply\(ctx?\)|function apply\(\)/);
    assert.match(source, /diagnostics\.guard\('apply'/);
  });
});

test('key network and transition paths publish performance metrics without payload content', async () => {
  const sources = (await Promise.all([
    read('../../balance-meter/dsh-balance-meter/lib/index.js'),
    read('../../browser-dock/dsh-browser-dock/src/client/index.js'),
    read('../../browser-dock/dsh-browser-dock/proxy.cjs'),
    read('../../fairy-voice/dsh-fairy-voice/lib/index.js'),
    read('../../fairy-visual/dsh-fairy-visual/src/client/visual-transitions.js'),
  ])).join('\n');
  for (const operation of ['balance.fetch', 'state.request', 'proxy.capture', 'tts.stream', 'transition.mode.capture']) {
    assert.match(sources, new RegExp(operation.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(sources, /context:\s*\{[^}]*\b(?:text|markdown|apiKey|Authorization)\b/);
});
