window.__ModuleLoader__.load({
  id: 'dsh-fairy-startup',
  factory: () => {
    const STARTUP_RESET_ATTR = 'data-dsh-fairy-startup-reset';
    const createFairyDiagnostics = (() => {
      const module = { exports: {} };
// DSH_FAIRY_CLIENT_DIAGNOSTICS_BEGIN
const FAIRY_LOG_PREFIX = 'DSH_FAIRY_LOG';
const SENSITIVE_KEY = /authorization|credential|password|secret|token|api[_-]?key|cookie/i;

function sanitize(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 320 ? `${value.slice(0, 320)}…` : value;
  if (depth >= 2) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitize(item, '', depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 24).map(([name, item]) => [name, sanitize(item, name, depth + 1)]));
  return String(value);
}

function createFairyDiagnostics(moduleName, sink = console) {
  const recentErrors = new Map();
  const clock = () => typeof performance === 'object' && performance?.now ? performance.now() : Date.now();
  const emit = (level, operation, event, context = {}, error, durationMs) => {
    const normalizedError = error ? { name: String(error.name || 'Error'), code: error.code == null ? undefined : String(error.code), message: String(error.message || error).slice(0, 320) } : undefined;
    if (normalizedError) {
      const signature = `${operation}:${normalizedError.code || normalizedError.message}`;
      const now = Date.now();
      if (now - (recentErrors.get(signature) || 0) < 60_000) return null;
      recentErrors.set(signature, now);
    }
    const record = { schema: 1, timestamp: new Date().toISOString(), level, module: moduleName, operation, event, context: sanitize(context), ...(normalizedError ? { error: normalizedError } : {}), ...(Number.isFinite(durationMs) ? { duration_ms: Number(durationMs.toFixed(3)) } : {}) };
    const writer = level === 'error' ? sink.error : level === 'warn' ? sink.warn : sink.info || sink.log;
    writer.call(sink, `${FAIRY_LOG_PREFIX} ${JSON.stringify(record)}`);
    return record;
  };
  const start = () => clock();
  const metric = (operation, startedAt, context = {}, options = {}) => {
    const duration = clock() - startedAt;
    return duration < (options.thresholdMs || 0) ? null : emit('info', operation, 'metric', context, undefined, duration);
  };
  const guard = (operation, callback, context = {}) => {
    const startedAt = start();
    try {
      const result = callback();
      metric(operation, startedAt, { ...context, outcome: 'success' });
      return result;
    } catch (error) {
      emit('error', operation, 'failure', context, error);
      metric(operation, startedAt, { ...context, outcome: 'failure' });
      throw error;
    }
  };
  return { start, metric, guard, info: (operation, context) => emit('info', operation, 'event', context), warn: (operation, context, error) => emit('warn', operation, 'failure', context, error), error: (operation, error, context) => emit('error', operation, 'failure', context, error) };
}

module.exports = { FAIRY_LOG_PREFIX, createFairyDiagnostics };
// DSH_FAIRY_CLIENT_DIAGNOSTICS_END
      return module.exports.createFairyDiagnostics;
    })();
    const diagnostics = createFairyDiagnostics('dsh-fairy-startup');

    function createWorkspaceStarter(workspaces) {
      let unsubscribe = null;
      let started = false;
      const startWhenReady = () => {
        const snapshot = workspaces.list.getSnapshot();
        if (started || !snapshot.baselinesReady) return false;
        // rc.2+ keeps an empty workspace selection as a valid state. Calling
        // startSession() without a target re-enters the official session
        // projection synchronously, so leave the native new-session view alone.
        if (snapshot.recentWorkspaceId !== undefined) {
          try {
            workspaces.startSession();
          } catch (error) {
            diagnostics.error('session.start-fresh', error, {});
            return false;
          }
        }
        started = true;
        unsubscribe?.();
        unsubscribe = null;
        return true;
      };
      return {
        startOrSubscribe() {
          if (!startWhenReady()) unsubscribe = workspaces.list.subscribe(startWhenReady);
        },
        dispose() {
          unsubscribe?.();
        },
      };
    }

    function resetStartupSelection(sessions, workspaces) {
      const root = document.documentElement;
      if (root.hasAttribute(STARTUP_RESET_ATTR)) return null;
      root.setAttribute(STARTUP_RESET_ATTR, 'true');

      // Clear restored selection synchronously so a previous conversation never
      // flashes, then use the official workspace API once its baselines exist.
      try {
        sessions.clear();
      } catch (error) {
        root.removeAttribute(STARTUP_RESET_ATTR);
        diagnostics.error('session.clear-restored', error, {});
        throw error;
      }
      const starter = createWorkspaceStarter(workspaces);
      starter.startOrSubscribe();
      return () => starter.dispose();
    }

    function apply(ctx) {
      return diagnostics.guard('apply', () => {
        const disposeReset = resetStartupSelection(ctx.sessions, ctx.workspaces);
        if (disposeReset) ctx.effect(() => disposeReset, 'dsh-fairy-startup reset selection');
      }, { surface: 'client' });
    }

    return { apply, inject: ['sessions', 'workspaces'], name: 'dsh-fairy-startup' };
  },
});
