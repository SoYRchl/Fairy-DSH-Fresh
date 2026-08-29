#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LOG = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'logs', 'dsh-web.log');
const RUN_BEGIN = '===== DSH_WEB_RUN_BEGIN =====';
const RUN_READY = '===== DSH_WEB_RUN_READY =====';
const RUN_FAILED = '===== DSH_WEB_RUN_FAILED =====';
const knownFaultPatterns = [
  { code: 'build-output-missing', pattern: /(?:build output|client bundle|host entry).*\bmissing\b/i },
  { code: 'source-newer-than-bundle', pattern: /source is newer than (?:its )?(?:bundle|generated outputs)/i },
  { code: 'module-missing', pattern: /MODULE_NOT_FOUND|Cannot find (?:module|package)|Cordis[^\n]*(?:missing|not found)/i },
  { code: 'visual-build-missing', pattern: /(?:dsh-fairy-visual|Visual)[^\n]*(?:build|bundle)[^\n]*\bmissing\b/i },
];

function parseFields(lines, start, end) {
  const fields = {};
  for (let index = start; index < end; index += 1) {
    const match = lines[index].match(/^([a-zA-Z0-9_.-]+)=(.*)$/);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

function parseRuns(text) {
  const lines = text.split(/\r?\n/);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== RUN_BEGIN) continue;
    const blockEnd = lines.indexOf('===== END DSH_WEB_RUN_BEGIN =====', index + 1);
    if (blockEnd < 0) continue;
    const fields = parseFields(lines, index + 1, blockEnd);
    if (fields.run_id) starts.push({ index, fields });
  }
  const runs = starts.map((start, runIndex) => {
    const end = starts[runIndex + 1]?.index ?? lines.length;
    let terminal = 'pending';
    let terminalFields = {};
    for (let index = start.index; index < end; index += 1) {
      if (lines[index] !== RUN_READY && lines[index] !== RUN_FAILED) continue;
      const marker = lines[index] === RUN_READY ? 'ready' : 'failed';
      const blockEnd = lines.indexOf(`===== END DSH_WEB_RUN_${marker.toUpperCase()} =====`, index + 1);
      if (blockEnd < 0 || blockEnd >= end) continue;
      const fields = parseFields(lines, index + 1, blockEnd);
      if (!fields.run_id || fields.run_id === start.fields.run_id) {
        terminal = marker;
        terminalFields = fields;
      }
    }
    return {
      runId: start.fields.run_id,
      startedAt: start.fields.timestamp || null,
      startLine: start.index + 1,
      endLine: end,
      terminal,
      terminalFields,
      lines: lines.slice(start.index, end),
    };
  });
  return { lines, runs };
}

function structuredRecord(line) {
  const prefix = 'DSH_FAIRY_LOG ';
  if (!line.startsWith(prefix)) return null;
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return null;
  }
}

function lineTimestamp(line) {
  const record = structuredRecord(line);
  if (record?.timestamp) return Date.parse(record.timestamp);
  const match = line.match(/(?:^|\s)timestamp=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)(?:\s|$)/);
  return match ? Date.parse(match[1]) : null;
}

function expectedCancellation(record) {
  if (!record) return false;
  const code = record.context?.code || record.error?.code;
  const message = record.error?.message;
  return ['client-aborted', 'superseded'].includes(code)
    || ['client-aborted', 'superseded'].includes(message)
    || (record.event === 'metric' && record.context?.aborted === true);
}

function diagnose(run, { sinceMs = null } = {}) {
  const expectedCancellations = [];
  const actionable = [];
  for (let offset = 0; offset < run.lines.length; offset += 1) {
    const line = run.lines[offset];
    const timestamp = lineTimestamp(line);
    if (sinceMs !== null && timestamp !== null && timestamp < sinceMs) continue;
    const lineNumber = run.startLine + offset;
    const record = structuredRecord(line);
    if (expectedCancellation(record)) {
      expectedCancellations.push({ line: lineNumber, timestamp: record.timestamp || null, operation: record.operation || null });
      continue;
    }
    if (record && (record.level === 'warn' || record.level === 'error' || record.event === 'failure')) {
      actionable.push({ code: record.context?.code || record.event || record.level, line: lineNumber, timestamp: record.timestamp || null, text: line });
      continue;
    }
    for (const fault of knownFaultPatterns) {
      if (fault.pattern.test(line)) {
        actionable.push({ code: fault.code, line: lineNumber, timestamp: timestamp ? new Date(timestamp).toISOString() : null, text: line });
        break;
      }
    }
  }
  return { expectedCancellations, actionable };
}

function countHistoricalNoise(lines) {
  let knownFaults = 0;
  let expectedCancellations = 0;
  for (const line of lines) {
    const record = structuredRecord(line);
    if (expectedCancellation(record) || line.includes('client-aborted')) expectedCancellations += 1;
    if (knownFaultPatterns.some(({ pattern }) => pattern.test(line))) knownFaults += 1;
  }
  return { knownFaults, expectedCancellations };
}

function analyze(text, options = {}) {
  const parsed = parseRuns(text);
  if (!parsed.runs.length) throw new Error('no DSH_WEB_RUN_BEGIN segment found');
  const selected = options.runId
    ? parsed.runs.find((run) => run.runId === options.runId)
    : parsed.runs.at(-1);
  if (!selected) throw new Error(`run_id not found: ${options.runId}`);
  const diagnosis = diagnose(selected, { sinceMs: options.sinceMs ?? null });
  const nextRun = parsed.runs.find((run) => run.startLine > selected.startLine);
  const historical = countHistoricalNoise(parsed.lines.slice(0, selected.startLine - 1));
  const healthy = selected.terminal === 'ready' && diagnosis.actionable.length === 0;
  return {
    status: healthy ? 'healthy' : selected.terminal === 'failed' ? 'failed' : 'attention',
    runId: selected.runId,
    startedAt: selected.startedAt,
    endedAt: nextRun?.startedAt || null,
    boundary: nextRun ? 'next-run' : 'log-eof',
    terminal: selected.terminal,
    dshPid: selected.terminalFields.dsh_pid || null,
    startLine: selected.startLine,
    endLine: selected.endLine,
    analyzedSince: options.sinceMs === null || options.sinceMs === undefined ? selected.startedAt : new Date(options.sinceMs).toISOString(),
    expectedCancellationEvents: diagnosis.expectedCancellations,
    actionable: diagnosis.actionable,
    historicalBeforeBoundary: historical,
    rawLines: selected.lines,
  };
}

function parseArguments(argv) {
  const options = { log: DEFAULT_LOG, runId: null, sinceMs: null, json: false, show: false, requireHealthy: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--log' && argv[index + 1]) options.log = path.resolve(argv[++index]);
    else if (argument === '--run-id' && argv[index + 1]) options.runId = argv[++index];
    else if (argument === '--since' && argv[index + 1]) {
      options.sinceMs = Date.parse(argv[++index]);
      if (!Number.isFinite(options.sinceMs)) throw new Error('invalid --since timestamp');
    } else if (argument === '--json') options.json = true;
    else if (argument === '--show') options.show = true;
    else if (argument === '--require-healthy') options.requireHealthy = true;
    else throw new Error(`unknown or incomplete argument: ${argument}`);
  }
  return options;
}

function printHuman(result, show) {
  process.stdout.write(`DSH log triage: ${result.status}\n`);
  process.stdout.write(`run_id=${result.runId} window=${result.startedAt || 'unknown'}..${result.endedAt || 'log-eof'} lines=${result.startLine}-${result.endLine} terminal=${result.terminal} dsh_pid=${result.dshPid || 'unknown'}\n`);
  process.stdout.write(`current_actionable=${result.actionable.length} expected_cancellation_events=${result.expectedCancellationEvents.length} historical_ignored_before_boundary=${result.historicalBeforeBoundary.knownFaults + result.historicalBeforeBoundary.expectedCancellations}\n`);
  for (const item of result.actionable) process.stdout.write(`ACTIONABLE code=${item.code} line=${item.line} timestamp=${item.timestamp || 'unstructured'} ${item.text}\n`);
  if (show) {
    process.stdout.write(`===== SELECTED RUN ${result.runId} =====\n`);
    process.stdout.write(`${result.rawLines.join('\n')}\n`);
    process.stdout.write(`===== END SELECTED RUN ${result.runId} =====\n`);
  }
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const text = fs.readFileSync(options.log, 'utf8');
    const result = analyze(text, options);
    if (options.json) {
      const { rawLines, ...serializable } = result;
      process.stdout.write(`${JSON.stringify(serializable, null, 2)}\n`);
    } else printHuman(result, options.show);
    if (options.requireHealthy && result.status !== 'healthy') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`DSH log triage failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { analyze, diagnose, parseRuns };
