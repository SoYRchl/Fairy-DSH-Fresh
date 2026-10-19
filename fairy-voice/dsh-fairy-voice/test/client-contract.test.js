import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const clientPath = new URL('../lib/client.js', import.meta.url);
const source = await readFile(clientPath, 'utf8');
const serverSource = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
const canonicalClientDiagnostics = await readFile(new URL('../../../fairy-contracts/client-diagnostics.cjs', import.meta.url), 'utf8');
const canonicalClientDom = await readFile(new URL('../../../fairy-contracts/client-dom.cjs', import.meta.url), 'utf8');

function embeddedClientDiagnostics(value) {
  const begin = '// DSH_FAIRY_CLIENT_DIAGNOSTICS_BEGIN\n';
  const end = '// DSH_FAIRY_CLIENT_DIAGNOSTICS_END';
  const start = value.indexOf(begin);
  const finish = value.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, 'embedded client diagnostics boundaries should exist');
  return value.slice(start + begin.length, finish);
}

function embeddedClientDom(value) {
  const begin = '// DSH_FAIRY_CLIENT_DOM_BEGIN\n';
  const end = '// DSH_FAIRY_CLIENT_DOM_END';
  const start = value.indexOf(begin);
  const finish = value.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, 'embedded client DOM contracts boundaries should exist');
  return value.slice(start + begin.length, finish);
}

test('embeds the canonical client diagnostics byte for byte', () => {
  assert.equal(embeddedClientDiagnostics(source), canonicalClientDiagnostics);
});

test('request scopes own abort, timeout cleanup, and idempotent cancellation', () => {
  assert.equal(source.includes('function createVoiceRequestScope()'), true);
  assert.equal(source.includes("prepareScope.current?.cancel('client-aborted')"), true);
  assert.equal(source.includes('requestScope.timeout(resolve, 1500)'), true);
  assert.equal(serverSource.includes('function createVoiceRequestScope()'), true);
  assert.equal(serverSource.includes("scope.timeout(() => scope.cancel('timeout'), TTS_TIMEOUT_MS)"), true);
  assert.equal(serverSource.includes("scope.cancel('request-complete')"), true);
});

test('slot registration has one replacement owner and an explicit disposer', () => {
  assert.match(source, /function injectVoiceSlot\(ctx, name, definition, component\)/);
  assert.equal(source.includes('const releaseRegistration = () =>'), true);
  assert.match(source, /const dispose = disposeRegistration;/);
  // 原来钉的是 `return releaseRegistration;`（注册清理一律走共享闭包）。实例作用域改造后
  // inject 直接返回 ctx.slots.inject 的清理器，且只在 disposeRegistration === dispose 时清空；
  // 旧写法会把上一代节点迟到的 cleanup 误当成新注册的清理，把新控件一起拆掉。
  assert.match(source, /if \(disposeRegistration === dispose\) disposeRegistration = null;/);
  assert.match(source, /return \(\) => \{\s*if \(disposeRegistration === dispose\) disposeRegistration = null;\s*dispose\?\.\(\);\s*\};/);
  assert.doesNotMatch(source, /return releaseRegistration;/);
  assert.match(source, /const slotDisposers = \[/);
  assert.match(source, /dsh-fairy-voice slot registrations/);
});

test('playback commands and state updates are session-scoped', () => {
  assert.match(source, /if \(detail\.sessionKey !== sessionKey\) return;/);
  assert.match(source, /detail: \{ messageId: final\.id, markdown: final\.markdown, sessionKey, auto: true \}/);
  assert.match(source, /detail: \{ sessionKey, messageId: message\.id, markdown: message\.markdown \}/);
  assert.match(source, /dispatchVoiceState\(\{ status: 'error', messageId, error: error\?\.message \|\| 'Speech preparation failed\.', sessionKey \}\)/);
});

test('cancellation invalidates both preparation and active playback', () => {
  assert.match(source, /const cancelPlayback = React\.useCallback\(\(\) => \{\s*lifecycleEpoch\.current \+= 1;\s*activeIntent\.current = null;\s*prepareController\.current\?\.abort\(\);\s*prepareController\.current = null;[\s\S]*?stop\(\);/s);
  assert.match(source, /const isCurrentRequest = \(\) => \{[\s\S]*?lifecycleEpoch\.current === requestEpoch && !controller\.signal\.aborted[\s\S]*?currentSelection\.key === sessionKey && currentSelection\.epoch === selectionEpoch;/);
  assert.match(source, /if \(!isCurrentRequest\(\)\) return;/);
  assert.match(source, /window\.addEventListener\('pagehide', cancelPlayback\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', cancelWhenHidden\)/);
});

test('active DSH session selection synchronously invalidates every stale voice generation', () => {
  assert.match(source, /function createActiveSessionStore\(sessions\)/);
  assert.match(source, /let activeSessionStore = null/);
  assert.match(source, /const activeSessions = activeSessionStore \|\| emptyActiveSessionStore/);
  // 原来钉的是 `sessions?.list?.getSnapshot?.().current`。0.2.0 的 list 快照不再有 .current：
  // 现役 key 先看旧字段（current/currentId/active/selected），否则从 retainedBy.mainView 的
  // 保留行推导，再不行回落 'empty-chat'。断言改成这条真实推导链。
  assert.match(source, /const legacy = snap\?\.current \?\? snap\?\.currentId \?\? snap\?\.active \?\? snap\?\.selected;/);
  assert.match(source, /\(row\.retainedBy && row\.retainedBy\.mainView\) \|\| 0\) > 0/);
  assert.match(source, /return 'empty-chat';/);
  assert.match(source, /snapshot = \{ key, epoch: snapshot\.epoch \+ 1 \}/);
  assert.match(source, /React\.useSyncExternalStore\(activeSessions\.subscribe, activeSessions\.getSnapshot, activeSessions\.getSnapshot\)/);
  assert.match(source, /return activeSessions\.subscribe\(\(\) => \{\s*if \(activeSessions\.getSnapshot\(\)\.key !== sessionKey\) cancelPlayback\(\);/s);
  assert.match(source, /if \(detail\.sessionKey !== sessionKey \|\| selection\.key !== sessionKey\) return;/);
  assert.match(source, /selection\.key !== sessionKey \|\| selection\.epoch !== activeSelection\.epoch/);
  assert.match(source, /autoRead: autoRead && sessionActive/);
  assert.match(source, /return \{ apply, inject: \['slots', 'sessions'\] \}/);
  assert.doesNotMatch(source, /VoiceControllerSlot/);
});

test('message buttons replay authoritative per-session playback state after remounting', () => {
  assert.match(source, /const voiceStateBySession = new Map\(\)/);
  assert.match(source, /voiceStateBySession\.set\(scoped\.sessionKey, scoped\)/);
  assert.match(source, /const MAX_TRACKED_SESSION_STATES = 32/);
  assert.match(source, /function pruneOldSessions\(\)/);
  assert.match(source, /state\.lastAccess = Date\.now\(\)/);
  assert.match(source, /entries\.sort\(\(a, b\) =>/);
  assert.match(source, /state\?\.dispose\?\.\(\)/);
  assert.match(source, /activeSessionStore\?\.getSnapshot\?\.\(\)\.key/);
  assert.match(source, /clearVoiceSessionStates\(\)/);
  assert.match(source, /const \[state, setState\] = React\.useState\(\(\) => readVoiceState\(sessionKey\)\)/);
  assert.match(source, /React\.useLayoutEffect\(\(\) => \{\s*setState\(readVoiceState\(sessionKey\)\);/s);
  assert.equal((source.match(/new CustomEvent\(EVENT_STATE/g) || []).length, 1);
});

test('LRU keeps at most 32 session states, protects the active session, and disposes evictions', async () => {
  const vm = await import('node:vm');
  const start = source.indexOf('    function idleVoiceState(sessionKey) {');
  const end = source.indexOf('    function createActiveSessionStore(sessions) {', start);
  assert.ok(start >= 0 && end > start, 'voice-state LRU source should be available');
  const disposed = [];
  let now = 0;
  const sandbox = {
    Date: { now: () => now },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    EVENT_STATE: 'voice-state',
    MAX_TRACKED_SESSION_STATES: 32,
    activeSessionStore: { getSnapshot: () => ({ key: 'session-0' }) },
    disposed,
    window: { dispatchEvent() {} },
  };
  vm.runInNewContext(`
    const voiceStateBySession = new Map();
    function reportAudioLifecycleFailure() {}
    ${source.slice(start, end)}
    globalThis.voiceLru = {
      dispatchVoiceState,
      readVoiceState,
      size: () => voiceStateBySession.size,
      has: (key) => voiceStateBySession.has(key),
    };
  `, sandbox);

  for (let index = 0; index < 40; index += 1) {
    now += 1;
    sandbox.voiceLru.dispatchVoiceState({
      sessionKey: `session-${index}`,
      status: index === 0 ? 'playing' : 'idle',
      dispose: () => disposed.push(`session-${index}`),
    });
  }
  assert.equal(sandbox.voiceLru.size(), 32);
  assert.equal(sandbox.voiceLru.has('session-0'), true);
  assert.deepEqual(disposed, Array.from({ length: 8 }, (_, index) => `session-${index + 1}`));

  now += 1;
  sandbox.voiceLru.readVoiceState('session-9');
  now += 1;
  sandbox.voiceLru.dispatchVoiceState({ sessionKey: 'session-40', status: 'idle', dispose: () => disposed.push('session-40') });
  assert.equal(sandbox.voiceLru.has('session-9'), true);
  assert.equal(sandbox.voiceLru.has('session-10'), false);
  assert.equal(sandbox.voiceLru.size(), 32);

  // One state publication per minute models eight hours of continuous use;
  // retained state remains bounded instead of growing with session count.
  for (let minute = 0; minute < 8 * 60; minute += 1) {
    now += 60_000;
    sandbox.voiceLru.dispatchVoiceState({ sessionKey: `long-run-${minute}`, status: 'idle' });
    assert.ok(sandbox.voiceLru.size() <= 32);
  }
  assert.equal(sandbox.voiceLru.has('session-0'), true);
  assert.equal(sandbox.voiceLru.size(), 32);
});

test('automatic playback retains retry ownership after preempting prior audio', () => {
  assert.match(source, /cancelPlayback\(\);\s*const id = String\(messageId \|\| ''\);\s*if \(automatic && id\) \{[\s\S]*?autoMessageIds\.current\.add\(id\);\s*activeAutoMessageId\.current = id;/s);
  assert.match(source, /const autoReadRef = React\.useRef\(autoRead\);\s*autoReadRef\.current = autoRead;/s);
  assert.match(source, /!autoReadRef\.current \|\| !isCurrentRequest\(\)/);
});

test('idle Web Audio rendering is suspended after final playback', () => {
  assert.match(source, /current\.context\.suspend\(\)\.catch\(\(error\) => reportAudioLifecycleFailure\('suspend', error\)\)/);
  assert.match(source, /const primeAudio = React\.useCallback\(async[\s\S]*?suspendWhenIdle\(context\)/);
  assert.match(source, /primeAudio\(volume\)\.then\(\(\) => \{/);
  assert.match(source, /await primeAudio\(volume\)/);
  assert.match(source, /const play = React\.useCallback\(async[\s\S]*?await unlockAudio\(volume\)/);
  assert.match(source, /const requestedWork = work\.current;[\s\S]*?await unlockAudio\(volume\);[\s\S]*?if \(work\.current !== requestedWork \|\| requestedWork\.stopped\) return false;/);
});

test('classifies audio cleanup failures without silent catches', () => {
  assert.match(source, /function reportAudioLifecycleFailure\(operation, error\)/);
  assert.match(source, /InvalidStateError/);
  assert.doesNotMatch(source, /catch \{\}/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/);
});

test('voice controller renders without unresolved hook-scope references', async () => {
  const vm = await import('node:vm');
  let moduleDefinition;
  const effects = [];
  const slots = new Map();
  const React = {
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useRef(initial) { return { current: initial }; },
    useCallback(callback) { return callback; },
    useEffect(callback) { effects.push(callback); },
    useLayoutEffect(callback) { effects.push(callback); },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
  };
  const jsxRuntime = {
    jsx(type, props) { return { type, props: props || {} }; },
    jsxs(type, props) { return { type, props: props || {} }; },
  };
  // 0.2.x 客户端在 apply() 里新增了两个定时器（会话保留轮询 + 语音异常提示），
  // 上游用例的 vm 沙箱没有 setInterval → apply 抛 ReferenceError，整条用例红。
  // 补齐定时器全局即可；用 no-op 实现，避免测试进程被未清理的 interval/timer 拖住。
  const context = vm.createContext({
    AbortController,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Map,
    Promise,
    Set,
    URL,
    clearTimeout,
    clearInterval,
    console,
    document: {
      documentElement: { hasAttribute: (name) => name === 'data-dsh-fairy-visual' },
      getElementById: () => ({}), addEventListener() {}, removeEventListener() {}, visibilityState: 'visible'
    },
    fetch: async () => ({ ok: true, json: async () => ({ available: true }), body: null }),
    localStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 0,
    setTimeout: () => 0,
    window: {
      __ModuleLoader__: { load(definition) { moduleDefinition = definition; } },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    },
  });
  vm.runInContext(source, context, { filename: 'dsh-fairy-voice/client.js' });
  const plugin = moduleDefinition.factory((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Tooltip: 'Tooltip', IconPauseOutline16: 'Pause', IconPlayOutline16: 'Play', IconStopFill16: 'Stop' };
    }
    throw new Error(`unexpected module: ${id}`);
  });
  const sessionSnapshot = { current: 'empty-chat' };
  plugin.apply({
    effect() {},
    sessions: { list: { getSnapshot: () => sessionSnapshot, subscribe: () => () => {} } },
    slots: {
      inject(_name, register) { register(); },
      register(definition, component) { slots.set(definition.id, component); },
    },
  });
  const wrapper = slots.get('fairy-voice-controller');
  const element = wrapper({ sessionId: 'empty-chat', useSession: (selector) => selector({}) });
  assert.doesNotThrow(() => element.type(element.props));
});

test('keeps the composer voice controls in the official left input slot', () => {
  assert.match(source, /injectVoiceSlot\(ctx, 'conversation\.input\.left'/);
  assert.match(source, /name: 'conversation\.input\.left', id: 'fairy-voice-controller', order: 40/);
  assert.doesNotMatch(source, /ctx\.slots\.inject\('conversation\.input\.right'/);
});

test('composer voice controller always mounts and no longer gates on HDD visual mode', () => {
  const scopedController = source.slice(source.indexOf('function SessionScopedVoiceController'), source.indexOf('function MessageAction'));
  // 原来这条整条钉的是「视觉模式门控」：先确认 useHddVisualMode 观察 html[data-dsh-fairy-visual]，
  // 再断言 SessionScopedVoiceController 里有 `const hddVisualMode = useHddVisualMode();` 与
  // `if (!hddVisualMode) return null;`。兼容改动有意拆掉门控（Fairy 视觉关闭时朗读按钮、
  // 自动播报、音量都必须照常可用），所以改成断言当前契约：控制器完全不读视觉模式属性、
  // 永远渲染，只用 sessionId 做 key 在换会话时强制重挂。
  // 视觉模式助手本身还在（观察 html[data-dsh-fairy-visual]），但已不再被朗读控制器消费；
  // 下面 5 条继续守住这个助手的实现，反向守卫则守住「门控已拆」。
  assert.match(source, /function useHddVisualMode\(\)/);
  assert.match(source, /document\.documentElement\?\.hasAttribute\('data-dsh-fairy-visual'\) === true/);
  assert.match(source, /new MutationObserver\(notify\)/);
  assert.match(source, /attributeFilter: \['data-dsh-fairy-visual'\]/);
  assert.match(source, /return \(\) => observer\.disconnect\(\)/);
  assert.match(scopedController, /function SessionScopedVoiceController\(props\)/);
  assert.doesNotMatch(scopedController, /useHddVisualMode/);
  // 只断言不再读该属性（注释里出现 data-dsh-fairy-visual 是历史说明，不算行为）。
  assert.doesNotMatch(scopedController, /hasAttribute/);
  assert.doesNotMatch(scopedController, /return null/);
  assert.doesNotMatch(scopedController, /display:\s*none/);
  assert.match(scopedController, /return jsx\.jsx\(VoiceController, \{ \.\.\.props, key: String\(props\.sessionId \?\? 'empty-chat'\) \}\);/);
});

test('server retains cancellation through the complete upstream PCM stream', async () => {
  const [server, localTtsProxy] = await Promise.all([
    readFile(new URL('../lib/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/local-tts-proxy.js', import.meta.url), 'utf8'),
  ]);
  assert.match(localTtsProxy, /function openLocalStream\(/);
  assert.match(localTtsProxy, /signal: controller\.signal/);
  assert.match(localTtsProxy, /const release = \(\) => \{[\s\S]*?parentSignal\?\.removeEventListener\('abort', onAbort\)/);
  assert.match(server, /activeTtsController\?\.abort\('superseded'\)/);
  assert.match(server, /releaseUpstream\?\.\(\)/);
  assert.match(server, /dispose: \(\) => \{[\s\S]*?controller\.abort\('disposed'\)/);
});

test('streaming playback reserves enough CPU-inference headroom', () => {
  assert.match(source, /PLAYBACK_PREBUFFER_SECONDS = 0\.65/);
  assert.match(source, /PLAYBACK_MAX_SCHEDULED_SECONDS = 4\.8/);
  assert.match(source, /PLAYBACK_MIN_BUFFER_SECONDS = 0\.08/);
  assert.match(source, /context\.currentTime \+ PLAYBACK_PREBUFFER_SECONDS/);
  assert.match(source, /await waitForQueueCapacity\(\);/);
  assert.match(source, /if \(!final && playableLength < PLAYBACK_MIN_BUFFER_BYTES\)/);
  assert.doesNotMatch(source, /if \(final && playableLength < PLAYBACK_MIN_BUFFER_BYTES\) return;/);
  assert.match(source, /PLAYBACK_SCHEDULE_LEAD_SECONDS/);
});

test('empty PCM responses cannot be reported as successful playback', () => {
  assert.match(source, /let receivedSamples = 0/);
  assert.match(source, /receivedSamples \+= sampleCount/);
  assert.match(source, /Fairy returned empty audio/);
});

test('automatic playback only begins after a fresh user turn and cannot lose a final answer while state settles', () => {
  assert.match(source, /SESSION_BASELINE_SETTLE_MS = 1250/);
  assert.match(source, /FINAL_PLAYBACK_SETTLE_MS = 900/);
  assert.match(source, /for \(const message of snapshot\.found\) seen\.current\.add\(message\.id\);/);
  assert.match(source, /if \(snapshot\.userSeq > current\.lastUserSeq\) \{\s*current\.lastUserSeq = snapshot\.userSeq;\s*current\.armedUserSeq = snapshot\.userSeq;\s*cancelPlayback\(\);/s);
  assert.match(source, /if \(current\.armedUserSeq !== snapshot\.userSeq\) return;/);
  assert.match(source, /const autoRetryTimers = React\.useRef\(new Map\(\)\)/);
  assert.match(source, /const autoRetryCounts = React\.useRef\(new Map\(\)\)/);
  assert.match(source, /autoMessageIds\.current\.has\(id\)/);
  assert.match(source, /retry: count \+ 1/);
  assert.match(source, /const candidate = \[\.\.\.snapshot\.currentTurnFinals\]\.reverse\(\)\.find\(\(message\) => !seen\.current\.has\(message\.id\) && !autoMessageIds\.current\.has\(message\.id\)\);/);
  assert.match(source, /current\.pendingFinal = \{ \.\.\.candidate, userSeq: snapshot\.userSeq \}/);
  assert.match(source, /turnLocation\?\.status !== 'closed'/);
  assert.match(source, /turnLocation\.data\?\.get\?\.\('turn-tail'\)\?\.closing/);
  assert.doesNotMatch(source, /latest\.activity\?\.running && current\.finalWaits/);
  assert.doesNotMatch(source, /seen\.current\.add\(final\.id\);\s*autoMessageIds\.current\.add\(final\.id\);/s);
  assert.match(source, /seen\.current\.add\(id\);\s*autoMessageIds\.current\.add\(id\);/s);
  assert.match(source, /const stillAuthoritative = latest\.currentTurnFinals\.some\(\(message\) => message\.id === final\.id\)/);
});

test('final auto-read is owned by the official closed-turn tail, not settled assistant steps', () => {
  assert.match(source, /const currentTurnFinals = \[\];/);
  assert.match(source, /const timeline = chat\?\.timeline;/);
  assert.match(source, /for \(const turnNumber of timeline\?\.turnOrder \|\| \[\]\)/);
  assert.match(source, /if \(turnLocation\?\.status !== 'closed'\) continue;/);
  assert.match(source, /const closing = turnLocation\.data\?\.get\?\.\('turn-tail'\)\?\.closing;/);
  assert.match(source, /currentTurnFinals\.push\(\{/);
  assert.doesNotMatch(source, /const candidate = \[\.\.\.snapshot\.found\]\.reverse\(\)/);
  assert.doesNotMatch(source, /FINAL_PLAYBACK_MAX_WAITS/);
});

test('message actions use the DSH-provided session id', () => {
  assert.match(source, /function MessageAction\(\{ messageId, sessionId \}\)/);
  // 原来钉的是「直接读全局 activeSessionStore 快照」。0.2.0 的 retention 派生 key 会在挂载后
  // 一小会儿才稳定，必须订阅 activeStore 触发重渲染，否则组件永远停在初始 'empty-chat'
  // 而不渲染。断言改成当前的订阅 + 回落链。
  assert.match(source, /const activeStore = activeSessionStore \|\| emptyActiveSessionStore;/);
  assert.match(source, /const activeSnap = React\.useSyncExternalStore\(activeStore\.subscribe, activeStore\.getSnapshot, activeStore\.getSnapshot\);/);
  assert.match(source, /const sessionKey = String\(sessionId \?\? activeSnap\?\.key \?\? 'empty-chat'\);/);
});

test('message actions reuse one indexed timeline projection per session', () => {
  assert.match(source, /const voiceTimelineStore = createVoiceTimelineStore\(\)/);
  assert.match(source, /messagesById: new Map\(found\.map/);
  assert.match(source, /voiceTimelineStore\.set\(snapshot\)/);
  assert.match(source, /conversation\.messagesById\.get\(String\(messageId\)\)/);
  const actionSource = source.slice(source.indexOf('function MessageAction'), source.indexOf('function apply'));
  assert.doesNotMatch(actionSource, /useSession\(readVoiceTimeline\)|\.found\.find\(/);
});

test('shares one bounded availability request across the controller and all message actions', () => {
  assert.match(source, /const AVAILABILITY_TTL_MS = 30_000/);
  assert.match(source, /const availabilityStore = \{/);
  assert.match(source, /if \(availabilityRequest\) return availabilityRequest/);
  assert.match(source, /if \(availabilityRequest === request\) availabilityRequest = null/);
  assert.match(source, /const availability = React\.useSyncExternalStore\(availabilityStore\.subscribe/);
  const actionSource = source.slice(source.indexOf('function MessageAction'), source.indexOf('function apply'));
  assert.doesNotMatch(actionSource, /getAvailability\(|EVENT_AVAILABILITY/);
  assert.match(source, /disposeAvailability\(\)/);
});

test('releases one-time gesture listeners and plugin-owned styles', () => {
  assert.match(source, /if \(audioReady\) return undefined/);
  assert.match(source, /\[audioReady, primeAudio, volume\]/);
  assert.match(source, /style\.setAttribute\('data-plugin', 'dsh-fairy-voice'\)/);
  assert.match(source, /document\.getElementById\(VOICE_STYLE_ID\)\?\.remove\(\)/);
});

test('voice controls use a compact icon toggle and custom volume slider', () => {
  assert.equal(embeddedClientDom(source), canonicalClientDom);
  assert.match(source, /function ensureVoiceControlStyles\(\)/);
  assert.match(source, /className: 'dsh-fairy-voice-controls'/);
  assert.match(source, /\[FAIRY_VOICE_CONTROL_ATTRIBUTE\]: 'true'/);
  assert.match(source, /className: 'dsh-fairy-voice-auto'/);
  assert.match(source, /className: 'dsh-fairy-voice-volume'/);
  // The volume slider must disappear entirely while the TTS engine is
  // offline: a dead disabled range input was repeatedly mistaken for the
  // reasoning-effort control.
  assert.match(source, /engineAvailable \? jsx\.jsx\(Tooltip, \{ label: `语音音量/);
  assert.match(source, /'aria-label': '语音音量', style: \{ '--dsh-fairy-volume': `\$\{Math\.round\(volume \* 100\)\}%` \} \}\) \}\) : null,/);
  assert.match(source, /IconPauseOutline16/);
  assert.doesNotMatch(source, /children: '本地 Fairy'/);
});

test('whisper-web runs local in-browser inference and no longer depends on Web Speech', () => {
  // 默认 provider 改为 whisper-web 后，语音输入在浏览器内本地跑 Whisper，
  // 而不是委托系统 Web Speech API；加载失败必须带着错误信息回显，不能静默吞掉。
  assert.match(source, /function loadEsmModule\(specifier\)/);
  assert.match(source, /return import\(specifier\);/);
  assert.match(source, /function decodeAudioBlobTo16kMono\(blob\)/);
  assert.match(source, /const transcriber = await pipeline\('automatic-speech-recognition', modelId/);
  assert.match(source, /if \(provider === 'whisper-web'\) startWhisperWebRecognition\(\)/);
  assert.match(source, /else if \(provider === 'browser'\) startBrowserRecognition\(\)/);
  assert.match(source, /本地语音识别失败：/);
  assert.doesNotMatch(source, /catch \{\}/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/);
});

test('voice controls use restrained semantic contrast in both themes', () => {
  assert.match(source, /dsh-fairy-voice-volume::-webkit-slider-runnable-track\{[^}]*var\(--dsw-alias-label-secondary\)/);
  assert.match(source, /dsh-fairy-voice-volume::-webkit-slider-thumb\{[^}]*background:var\(--dsw-alias-label-secondary\)/);
  assert.match(source, /dsh-fairy-voice-auto\[data-on="true"\]\{background:color-mix\(in srgb,var\(--dsw-alias-label-secondary\) 12%,transparent\);color:var\(--dsw-alias-label-secondary\)/);
  assert.doesNotMatch(source, /body\.dsh-hdd-on \.dsh-fairy-voice-(?:auto|volume)/);
});

test('voice brain only derives reports from actual DSH activity metadata', () => {
  // 原来钉的是单参签名 `readVoiceTimeline(snapshot)`；0.3.1 起 useChat 的 chat 作为第二入参
  // 传入（取不到时回落 snapshot.chat），断言改成当前真实签名与回落。
  assert.match(source, /function readVoiceTimeline\(snapshot, __fairyChat\)/);
  assert.match(source, /const chat = __fairyChat \|\| snapshot\?\.chat;/);
  assert.match(source, /function collectRunningTools\(block, activeTools/);
  assert.doesNotMatch(source, /node\?\.kind === 'tool-call' && node\.data\?\.root/);
  // 原来钉的是 `snapshot?.chat?.legacy?.runningCalls` 这条取用路径。当前 chat 由 useChat 直接
  // 传入，运行中工具改读 `chat?.legacy?.runningCalls`，并在该字段缺失时从 chat.nodes.byKey
  // 里挑仍在 running 的 tool 节点兜底。断言换成当前这两段真实来源。
  assert.match(source, /for \(const call of chat\?\.legacy\?\.runningCalls \|\| \[\]\) \{/);
  assert.match(source, /const __fairyIndex = chat\?\.nodes\?\.byKey;/);
  assert.match(source, /function isSearchTool\(name\)/);
  assert.match(source, /activeTools\.some\(\(tool\) => isSearchTool\(tool\.name\)\)/);
  assert.doesNotMatch(source, /reasoning.*searching|searching.*reasoning/i);
});

test('queues the newest status report until the current report finishes', () => {
  assert.match(source, /const pendingStatus = React\.useRef\(null\)/);
  assert.match(source, /pendingStatus\.current = \{ \.\.\.detail, sessionKey \}/);
  assert.match(source, /if \(kind === 'final'\) \{\s*pendingStatus\.current = null/s);
  assert.match(source, /if \(\['idle', 'error'\]\.includes\(detail\.status\)\) drainPendingStatus\(\);/);
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\(EVENT_PLAY, \{ detail: queued \}\)\)/);
});

test('voice brain keeps long-turn status reports sparse, continuous, and cancellable', () => {
  assert.match(source, /VOICE_REPORT_DELAY_MS = 4500/);
  assert.match(source, /VOICE_REPORT_COOLDOWN_MS = 15000/);
  assert.doesNotMatch(source, /VOICE_REPORT_MAX_PER_TURN/);
  assert.match(source, /if \(policy\.timer\) return;/);
  assert.match(source, /if \(live\.phase === phase && live\.silencedTurn !== reportUserSeq\) \{/);
  assert.doesNotMatch(source, /seenPhases\.has\(phase\)/);
  assert.match(source, /schedule\(VOICE_REPORT_COOLDOWN_MS\)/);
  assert.match(source, /kind: 'status', priority: 10, sessionKey/);
  assert.match(source, /window\.addEventListener\('pagehide', clearTimer\)/);
  assert.match(source, /detail\.stop && detail\.kind === 'status'/);
});

test('final answers preempt status synthesis and playback', () => {
  assert.match(source, /const kind = detail\.kind === 'status' \? 'status' : 'final';/);
  assert.match(source, /if \(kind === 'status'\) \{[\s\S]*?if \(activeIntent\.current\?\.priority >= priority \|\| prepareController\.current\) \{[\s\S]*?pendingStatus\.current/s);
  assert.match(source, /if \(kind === 'final'\) \{\s*[\s\S]*?cancelPlayback\(\);/);
  assert.match(source, /activeIntent\.current = null;\s*prepareController\.current\?\.abort\(\);/s);
});

test('only long final answers use the optional local voice-brief bridge', () => {
  assert.match(source, /const VOICE_BRIEF_THRESHOLD = 260/);
  assert.match(source, /kind === 'final' && voiceBrainConfigured\.current/);
  assert.match(source, /createVoiceBrief\(markdown, controller\.signal\)/);
  assert.match(source, /VoiceBrainSection/);
  assert.match(source, /function requestVoiceBrainConfig\(payload\)/);
  assert.match(source, /无法连接本地语音简报服务。请重新加载 DSH 后重试。/);
  // 原来钉的是 voice 包自己注册 `settings.section`（设置里出现独立的「Fairy 朗读」面板）。
  // 0.2.0 起设置入口并入 fairy-visual 的单个 Fairy 面板，voice 不再注册自己的 section ——
  // 断言随之翻转为「不得再出现 settings.section」，防止把独立面板又挂回去。
  assert.doesNotMatch(source, /settings\.section/);
  assert.match(source, /deepseek-v4-flash/);
  assert.match(source, /The visible answer is already authoritative/);
});

test('smooths PCM fragment edges and fades scheduled sources before stopping', () => {
  assert.match(source, /const PCM_EDGE_RAMP_SAMPLES = Math\.round\(PCM_SAMPLE_RATE \* 0\.005\)/);
  assert.match(source, /function applyPcmEdgeRamp\(samples\)/);
  assert.match(source, /samples\[index\] \*= ratio/);
  assert.match(source, /samples\[samples\.length - 1 - index\] \*= ratio/);
  assert.match(source, /linearRampToValueAtTime\(0, now \+ STOP_FADE_SECONDS\)/);
  assert.match(source, /source\.stop\(now === null \? undefined : now \+ STOP_FADE_SECONDS\)/);
  assert.match(source, /if \(played !== true\) retryAutomatic\(\);/);
});

test('voice client boundaries remain separated and scheduler is used by playback', () => {
  assert.match(source, /function createSessionTimelineStore\(/);
  assert.match(source, /function createVoiceTimelineStore\(/);
  assert.match(source, /function createLocalTtsTransport\(/);
  assert.match(source, /function createPcmStreamHandler\(/);
  assert.match(source, /function createWebAudioScheduler\(/);
  assert.match(source, /const scheduler = createWebAudioScheduler\(/);
  assert.match(source, /const \{ waitForPlayback, waitForQueueCapacity \} = scheduler/);
  assert.match(source, /function createAutoReadPolicy\(/);
  assert.match(source, /const samples = buffer\.getChannelData\(0\);\s*pcmStreamHandler\.decodeInto\(bytes, samples\);\s*applyPcmEdgeRamp\(samples\);/s);
  assert.doesNotMatch(source, /new Float32Array\(bytes\.length/);
  assert.doesNotMatch(source, /function legacy(?:Prepare|GetAvailability|GetVoiceBrainStatus|CreateVoiceBrief|RequestVoiceBrainConfig)/);
});
