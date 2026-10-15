/*
 * Fairy-DSH [T-128] TTS provider 注册表契约测试。
 *
 * 覆盖的是「吸收过来的形状」里最容易回归的四件事：
 *   ① 未知 id 必须回落而不是抛错（配置文件被手改坏也要能起来）
 *   ② 旧字段（sovitsBase / mossBase）必须仍然生效（老用户升级不该变行为）
 *   ③ 探测预算是硬上限（不理会 signal 的 provider 不能把设置卡片吊死）
 *   ④ 两条新增的云端路按预期发请求
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTtsProviderRegistry,
  normalizeProvider,
  PROVIDER_IDS,
  configForProvider,
  configKeyForProvider,
} from '../lib/providers/tts-index.js';
import { DEFAULT_PROVIDER_ID } from '../lib/providers/tts-index.js';
import { buildTtsTransport, runVoiceSelfCheck } from '../lib/server/voice-selfcheck.js';

/* 分区键必须是【配置键】（sovits / moss / openai / customHttp），不能是 provider id。
 * 落盘的 config.json 就是按配置键存的；UI 读的 providers 视图若按 id 分组，
 * 保存一次就会读出一套键、写进另一套键，配置静默失效。 */
test('provider sections round-trip through the same config key', () => {
  assert.equal(configKeyForProvider('gpt-sovits'), 'sovits');
  assert.equal(configKeyForProvider('moss-nano'), 'moss');
  assert.equal(configKeyForProvider('openai'), 'openai');
  assert.equal(configKeyForProvider('custom-http'), 'customHttp');
  for (const id of PROVIDER_IDS) {
    const key = configKeyForProvider(id);
    const seeded = configForProvider(id, { providers: { [key]: { marker: id } } });
    assert.equal(seeded.marker, id, `${id} 写进 providers.${key} 后必须能被自己读回来`);
  }
});

/* 对外发包的使用者【默认一台 TTS 都没装】。此时自检不能把他当成"坏了"来报，
 * 结论句必须说清「不影响聊天，只是不出声」，UI 据此显示成琥珀色的「未配置」。 */
const offlineConfig = (configured) => ({
  engine: 'gpt-sovits',
  provider: 'gpt-sovits',
  base: 'http://127.0.0.1:59999',
  ttsUrl: 'http://127.0.0.1:59999/tts',
  docsUrl: 'http://127.0.0.1:59999/docs',
  referenceAudioPath: 'C:/definitely/not/here/fairy_ref.wav',
  referencePromptPath: 'C:/definitely/not/here/fairy_ref.txt',
  providers: { sovits: {}, moss: {}, openai: {}, customHttp: {} },
  configured,
});
const offlineFetch = async () => { throw new Error('ECONNREFUSED'); };

test('a fresh install with no TTS reads as "not configured", not as a failure', async () => {
  const fresh = await runVoiceSelfCheck({
    fetchImpl: offlineFetch, withSynthesis: false, config: offlineConfig(false),
  });
  assert.equal(fresh.unconfigured, true);
  assert.match(fresh.headline, /还没配置朗读服务/);
  assert.match(fresh.headline, /不出声/);
});

test('a configured install still reports real failures as failures', async () => {
  const broken = await runVoiceSelfCheck({
    fetchImpl: offlineFetch, withSynthesis: false, config: offlineConfig(true),
  });
  assert.equal(broken.unconfigured, false);
  assert.doesNotMatch(broken.headline, /还没配置朗读服务/);
  assert.equal(broken.ok, false);
});

const fakeResponse = () => ({ ok: true, headers: { get: () => 'audio/raw' } });

test('provider ids keep the legacy names so stored configs keep working', () => {
  assert.ok(PROVIDER_IDS.includes('gpt-sovits'));
  assert.ok(PROVIDER_IDS.includes('moss-nano'));
  assert.ok(PROVIDER_IDS.includes('openai'));
  assert.ok(PROVIDER_IDS.includes('custom-http'));
  assert.equal(normalizeProvider('gpt-sovits'), 'gpt-sovits');
  assert.equal(normalizeProvider('moss-nano'), 'moss-nano');
});

test('unknown provider ids fall back to the default engine instead of throwing', () => {
  assert.equal(normalizeProvider('nope'), DEFAULT_PROVIDER_ID);
  assert.equal(normalizeProvider(undefined), DEFAULT_PROVIDER_ID);
  const registry = createTtsProviderRegistry({ fetchImpl: async () => fakeResponse() });
  const resolved = registry.resolve({ provider: 'totally-unknown' });
  assert.equal(resolved.id, DEFAULT_PROVIDER_ID);
  assert.ok(resolved.provider, '回落后必须拿到一个可用的 provider');
});

test('legacy sovitsBase / mossBase still seed the provider sections', () => {
  const sovits = configForProvider('gpt-sovits', { sovitsBase: 'http://127.0.0.1:1234' });
  assert.equal(sovits.baseURL, 'http://127.0.0.1:1234');
  const moss = configForProvider('moss-nano', { mossBase: 'http://127.0.0.1:9999' });
  assert.equal(moss.baseURL, 'http://127.0.0.1:9999');
  // 分区里显式写的优先于旧字段
  const overridden = configForProvider('gpt-sovits', {
    sovitsBase: 'http://127.0.0.1:1234',
    providers: { sovits: { baseURL: 'http://127.0.0.1:5678' } },
  });
  assert.equal(overridden.baseURL, 'http://127.0.0.1:5678');
});

test('availability probe is bounded: a provider that never answers reports timeout', async () => {
  const registry = createTtsProviderRegistry({
    fetchImpl: () => new Promise(() => {}), // 永不 resolve
    availabilityTimeoutMs: 60,
  });
  const started = Date.now();
  const [first] = await registry.list({ provider: 'gpt-sovits' });
  assert.ok(Date.now() - started < 2_000, '探测必须被硬上限掐断');
  assert.equal(first.available, false);
  assert.match(first.reason, /超时/);
});

test('openai provider posts to /audio/speech with the bearer key', async () => {
  let seen = null;
  const registry = createTtsProviderRegistry({
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return fakeResponse();
    },
  });
  const { provider, config } = registry.resolve({
    provider: 'openai',
    providers: { openai: { baseURL: 'https://tts.example.com/v1/', apiKey: 'sk-test-key', voice: 'shimmer' } },
  });
  assert.equal(provider.id, 'openai');
  const { response } = await provider.stream('你好', config, {});
  assert.equal(response.ok, true);
  assert.equal(seen.url, 'https://tts.example.com/v1/audio/speech');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test-key');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.input, '你好');
  assert.equal(body.voice, 'shimmer');
  // 尾部斜杠必须被吃掉，否则会出现 //audio/speech
  assert.ok(!seen.url.includes('//audio'));
});

test('custom-http provider substitutes {{text}} with JSON-safe escaping', async () => {
  let seen = null;
  const registry = createTtsProviderRegistry({
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return fakeResponse();
    },
  });
  const { provider, config } = registry.resolve({
    provider: 'custom-http',
    providers: { customHttp: { url: 'https://my.example/tts', bodyTemplate: '{"q":"{{text}}"}' } },
  });
  await provider.stream('带"引号"的文本', config, {});
  assert.equal(seen.url, 'https://my.example/tts');
  assert.doesNotThrow(() => JSON.parse(seen.init.body), '模板替换后必须仍是合法 JSON');
  assert.equal(JSON.parse(seen.init.body).q, '带"引号"的文本');
});

test('buildTtsTransport dispatches to the selected provider without changing its shape', () => {
  const transport = buildTtsTransport({ provider: 'openai', providers: { openai: { apiKey: 'k' } } }, {
    fetchImpl: async () => fakeResponse(),
  });
  assert.equal(transport.providerId, 'openai');
  assert.equal(typeof transport.status, 'function');
  assert.equal(typeof transport.stream, 'function');
  const fallback = buildTtsTransport({ provider: 'garbage' }, { fetchImpl: async () => fakeResponse() });
  assert.equal(fallback.providerId, DEFAULT_PROVIDER_ID, '未知 id 的传输层也必须能构造出来');
});
