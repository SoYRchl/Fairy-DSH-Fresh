/*
 * Fairy-DSH [T-130] STT provider 注册表 + 各 provider 契约测试。
 *
 * 覆盖最容易回归的事：
 *   ① 默认 provider 是 whisper-web（浏览器内本地 Whisper，不依赖系统 Web Speech、不依赖服务器）
 *   ② 未知 id 回落到默认而非抛错（配置文件被手改坏也能起）
 *   ③ 纯客户端 provider（browser / whisper-web）被识别，传输层 isClientSide=true
 *   ④ 四个服务端 provider 按预期发请求并返回识别文本
 *   ⑤ readRuntimeConfig 暴露 stt 视图，且不破坏既有 TTS 字段
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSttProviderRegistry,
  normalizeSttProvider,
  DEFAULT_STT_PROVIDER_ID,
  STT_PROVIDER_IDS,
  configForSttProvider,
  configKeyForSttProvider,
  isClientSideSttProvider,
} from '../lib/providers/stt-index.js';
import { buildSttTransport, readRuntimeConfig } from '../lib/server/voice-selfcheck.js';

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('default STT provider is whisper-web (in-browser local inference, no Web Speech, no server)', () => {
  assert.equal(DEFAULT_STT_PROVIDER_ID, 'whisper-web');
  assert.equal(normalizeSttProvider(undefined), 'whisper-web');
  assert.equal(normalizeSttProvider('nope'), 'whisper-web');
  assert.ok(STT_PROVIDER_IDS.includes('browser'), 'browser 仍作为可选项保留');
  assert.ok(STT_PROVIDER_IDS.includes('whisper-web'));
  assert.ok(STT_PROVIDER_IDS.includes('openai'));
  assert.ok(STT_PROVIDER_IDS.includes('deepgram'));
  assert.ok(STT_PROVIDER_IDS.includes('azure'));
  assert.ok(STT_PROVIDER_IDS.includes('custom-http'));
});

test('config keys are distinct from ids so disk writes never collide with reads', () => {
  const ids = [...STT_PROVIDER_IDS];
  const keys = ids.map((id) => configKeyForSttProvider(id));
  assert.equal(new Set(keys).size, ids.length, '每个 provider 必须有唯一配置键');
  for (const id of ids) {
    const key = configKeyForSttProvider(id);
    const seeded = configForSttProvider(id, { stt: { providers: { [key]: { marker: id } } } });
    assert.equal(seeded.marker, id, `${id} 写进 stt.providers.${key} 必须能被自己读回`);
  }
});

test('client-side providers are detected and their transport reports isClientSide', () => {
  assert.equal(isClientSideSttProvider('browser'), true);
  assert.equal(isClientSideSttProvider('whisper-web'), true);
  assert.equal(isClientSideSttProvider('openai'), false);
  const transport = buildSttTransport({ stt: { provider: 'browser' } }, { fetchImpl: async () => okResponse({ text: 'x' }) });
  assert.equal(transport.isClientSide, true);
  assert.equal(transport.providerId, 'browser');
});

test('registry resolves an unknown id to the default instead of throwing', () => {
  const registry = createSttProviderRegistry({ fetchImpl: async () => okResponse({ text: 'x' }) });
  const resolved = registry.resolve({ stt: { provider: 'totally-unknown' } });
  assert.equal(resolved.id, DEFAULT_STT_PROVIDER_ID);
  assert.ok(resolved.provider, '回落必须拿到一个可用 provider');
});

test('openai STT transcribes via multipart and returns the text', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return okResponse({ text: '你好世界' }); };
  const registry = createSttProviderRegistry({ fetchImpl });
  const { provider, config } = registry.resolve({
    stt: { provider: 'openai', providers: { openai: { baseURL: 'https://stt.example.com/v1/', apiKey: 'sk-x' } } },
  });
  assert.equal(provider.id, 'openai');
  const result = await provider.transcribe({ audio: new Uint8Array([1, 2, 3]), contentType: 'audio/webm', config });
  assert.equal(result.text, '你好世界');
  assert.equal(seen.url, 'https://stt.example.com/v1/audio/transcriptions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-x');
});

test('openai STT status: loopback without a key is still usable', () => {
  const registry = createSttProviderRegistry({ fetchImpl: async () => okResponse({ text: 'x' }) });
  const { provider, config } = registry.resolve({
    stt: { provider: 'openai', providers: { openai: { baseURL: 'http://127.0.0.1:9000/v1/' } } },
  });
  assert.equal(provider.status(config).available, true, '本地服务无密钥应判为可用');
  const remote = registry.resolve({
    stt: { provider: 'openai', providers: { openai: { baseURL: 'https://stt.example.com/v1/' } } },
  });
  assert.equal(remote.provider.status(remote.config).available, false, '远端无密钥应判为不可用');
});

test('deepgram STT posts raw audio bytes and returns the transcript', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return okResponse({ results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] } }); };
  const registry = createSttProviderRegistry({ fetchImpl });
  const { provider, config } = registry.resolve({
    stt: { provider: 'deepgram', providers: { deepgram: { baseUrl: 'https://api.deepgram.com', apiKey: 'key', model: 'nova-3' } } },
  });
  const result = await provider.transcribe({ audio: new Uint8Array([9]), contentType: 'audio/wav', config });
  assert.equal(result.text, 'hello');
  assert.match(seen.url, /api\.deepgram\.com\/v1\/listen\?/);
  assert.equal(seen.init.headers.Authorization, 'Token key');
  assert.equal(seen.init.headers['Content-Type'], 'audio/wav');
});

test('azure STT sends multipart audio + definition and joins phrases', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return okResponse({ combinedPhrases: [{ text: '识别结果' }] });
  };
  const registry = createSttProviderRegistry({ fetchImpl });
  const { provider, config } = registry.resolve({
    stt: { provider: 'azure', providers: { azure: { endpoint: 'https://e.cognitiveservices.azure.com', apiKey: 'k', locale: 'zh-CN' } } },
  });
  const result = await provider.transcribe({ audio: new Uint8Array([1]), contentType: 'audio/wav', config });
  assert.equal(result.text, '识别结果');
  assert.match(seen.url, /transcriptions:transcribe/);
  assert.equal(seen.init.headers['Ocp-Apim-Subscription-Key'], 'k');
});

test('custom-http STT posts raw audio and reads the response path', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return okResponse({ data: { transcript: '定制结果' } }); };
  const registry = createSttProviderRegistry({ fetchImpl });
  const { provider, config } = registry.resolve({
    stt: { provider: 'custom-http', providers: { customHttp: { url: 'https://my.example/stt', headersJson: '{}', responsePath: 'data.transcript' } } },
  });
  const result = await provider.transcribe({ audio: new Uint8Array([5]), contentType: 'audio/ogg', config });
  assert.equal(result.text, '定制结果');
  assert.equal(seen.url, 'https://my.example/stt');
  assert.equal(seen.init.headers['Content-Type'], 'audio/ogg');
});

test('readRuntimeConfig exposes the STT view without dropping TTS fields', () => {
  const config = readRuntimeConfig();
  assert.equal(config.sttProvider, 'whisper-web');
  assert.equal(config.sttProviderIds.length, 6);
  assert.equal(Object.keys(config.sttProviders).length, 6);
  assert.equal(config.provider, 'gpt-sovits', 'TTS 字段必须原样保留');
  assert.ok(Array.isArray(config.providerIds) && config.providerIds.length === 4);
});
