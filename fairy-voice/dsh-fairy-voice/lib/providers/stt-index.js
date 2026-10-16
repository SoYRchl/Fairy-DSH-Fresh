/*
 * Fairy-DSH [T-130] STT provider 表：id 清单、配置分区与默认值、字段清单。
 * 解析与带上限的可用性探测共用 ./registry.js（与 TTS 同一套脚手架）。
 *
 * ★ 形状来源：云朵版（同源实验分支 `addsas222/Fairy-DSH-Exp` 的
 *   `fairy-voice/lib/providers/stt-index.js`）。按 D-042 / D-056 的口径 ——
 *   **只取接口与形状，重新实现**，不把实验仓引为依赖。
 *
 * ★ 与 TTS 的分区隔离：TTS 用顶层 `providers` / `provider`；STT 用独立的 `stt.providers`
 *   / `stt.provider`，避免两套键互相覆盖（D-065 的教训：读出一套键、写进另一套键会静默失效）。
 *
 * ★ id 命名：沿用云朵版的语义（browser / whisper-web / openai / deepgram / azure /
 *   custom-http）。默认 provider 是 `whisper-web` —— 浏览器内本地跑 Whisper
 *   （transformers.js + WASM），不依赖任何外部 STT 服务，也不走系统 Web Speech API；
 *   首次使用会从 CDN 按需拉取模型权重（`browser` 仍作为可选 provider 保留）。
 */
import { AZURE_STT_ID, STT_AZURE_DEFAULTS, createAzureSttProvider } from './stt-azure.js';
import { BROWSER_STT_ID, STT_BROWSER_DEFAULTS, browserSttProvider } from './stt-browser.js';
import { CUSTOM_HTTP_STT_ID, STT_CUSTOM_HTTP_DEFAULTS, createCustomSttProvider } from './stt-custom.js';
import { DEEPGRAM_STT_ID, STT_DEEPGRAM_DEFAULTS, createDeepgramSttProvider } from './stt-deepgram.js';
import { OPENAI_STT_ID, STT_OPENAI_DEFAULTS, createOpenAiSttProvider } from './stt-openai.js';
import { WHISPER_WEB_STT_ID, STT_WHISPER_WEB_DEFAULTS, whisperWebSttProvider } from './stt-whisper-web.js';
import { createVoiceProviderRegistry } from './registry.js';

/* 把各 provider 的导出在 STT 入口处再导出，让 stt-index 成为 STT 的唯一入口
 * （voice-selfcheck.js / 测试 / 客户端都只从 stt-index 取，避免散落的环形依赖）。 */
export {
  AZURE_STT_ID, STT_AZURE_DEFAULTS,
  BROWSER_STT_ID, STT_BROWSER_DEFAULTS, browserSttProvider,
  CUSTOM_HTTP_STT_ID, STT_CUSTOM_HTTP_DEFAULTS,
  DEEPGRAM_STT_ID, STT_DEEPGRAM_DEFAULTS,
  OPENAI_STT_ID, STT_OPENAI_DEFAULTS,
  WHISPER_WEB_STT_ID, STT_WHISPER_WEB_DEFAULTS, whisperWebSttProvider,
};

export const STT_PROVIDER_IDS = [
  BROWSER_STT_ID,
  WHISPER_WEB_STT_ID,
  OPENAI_STT_ID,
  DEEPGRAM_STT_ID,
  AZURE_STT_ID,
  CUSTOM_HTTP_STT_ID,
];
// 默认：浏览器内本地 Whisper（whisper-web）。不依赖外部 STT 服务，也不依赖系统
// Web Speech API；模型权重首次使用按需从 CDN 拉取。browser 仍可作为可选项保留。
export const DEFAULT_STT_PROVIDER_ID = WHISPER_WEB_STT_ID;

const STT_PROVIDER_CONFIG_KEYS = {
  [BROWSER_STT_ID]: 'browser',
  [WHISPER_WEB_STT_ID]: 'whisperWeb',
  [OPENAI_STT_ID]: 'openai',
  [DEEPGRAM_STT_ID]: 'deepgram',
  [AZURE_STT_ID]: 'azure',
  [CUSTOM_HTTP_STT_ID]: 'customHttp',
};
export const STT_PROVIDER_CONFIG_DEFAULTS = {
  browser: STT_BROWSER_DEFAULTS,
  whisperWeb: STT_WHISPER_WEB_DEFAULTS,
  openai: STT_OPENAI_DEFAULTS,
  deepgram: STT_DEEPGRAM_DEFAULTS,
  azure: STT_AZURE_DEFAULTS,
  customHttp: STT_CUSTOM_HTTP_DEFAULTS,
};
export const STT_PROVIDER_CONFIG_FIELDS = {
  browser: ['lang'],
  whisperWeb: ['moduleUrl', 'modelId', 'device', 'dtype', 'language', 'resourceBase'],
  openai: ['baseURL', 'apiKey', 'model', 'language'],
  deepgram: ['baseUrl', 'apiKey', 'model', 'language'],
  azure: ['endpoint', 'apiKey', 'locale'],
  customHttp: ['url', 'headersJson', 'responsePath'],
};

/** 只认清单内的 id；其余（含配置文件被手改坏）一律回落到默认 provider。 */
export function normalizeSttProvider(input) {
  return STT_PROVIDER_IDS.includes(input) ? input : DEFAULT_STT_PROVIDER_ID;
}

/** 是否纯客户端 provider（浏览器/whisper-web）：识别在浏览器那一半完成，`/fairy-voice/stt` 答 409。 */
export function isClientSideSttProvider(id) {
  return id === BROWSER_STT_ID || id === WHISPER_WEB_STT_ID;
}

/** 读取某个 STT provider 的分区配置（默认值 ← 分区里存的值）。
 * 默认值来自各 provider 模块导出的 `*_DEFAULTS`，这里按需取，避免重复维护。 */
export function configForSttProvider(id, settingsValue) {
  const key = STT_PROVIDER_CONFIG_KEYS[id];
  if (!key) return {};
  const defaults = STT_PROVIDER_CONFIG_DEFAULTS[key] || {};
  const stored = settingsValue?.stt?.providers?.[key] || {};
  return { ...defaults, ...stored };
}

export function configKeyForSttProvider(id) {
  return STT_PROVIDER_CONFIG_KEYS[id] || null;
}

/* 服务端只实例化真正会走网络的 provider；browser / whisper-web 是纯客户端标记，
 * 它们的 `transcribe` 会直接被调用方识别为 client-side（见 index.js 的 409 分支）。 */
function serverProviderInstances({ fetchImpl } = {}) {
  return new Map([
    [OPENAI_STT_ID, createOpenAiSttProvider({ fetchImpl })],
    [DEEPGRAM_STT_ID, createDeepgramSttProvider({ fetchImpl })],
    [AZURE_STT_ID, createAzureSttProvider({ fetchImpl })],
    [CUSTOM_HTTP_STT_ID, createCustomSttProvider({ fetchImpl })],
    [BROWSER_STT_ID, browserSttProvider],
    [WHISPER_WEB_STT_ID, whisperWebSttProvider],
  ]);
}

export function createSttProviderRegistry({
  fetchImpl = fetch,
  availabilityTimeoutMs = 3_000,
} = {}) {
  return createVoiceProviderRegistry({
    ids: STT_PROVIDER_IDS,
    providers: serverProviderInstances({ fetchImpl }),
    configFor: configForSttProvider,
    requestedOf: (settingsValue) => normalizeSttProvider(settingsValue?.stt?.provider),
    fallbackId: DEFAULT_STT_PROVIDER_ID,
    unknownReason: '未知的语音识别提供方。',
    warnOperation: 'stt.provider.resolve',
    availabilityTimeoutMs,
  });
}
