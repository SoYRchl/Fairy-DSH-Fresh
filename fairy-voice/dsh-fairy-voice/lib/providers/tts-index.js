/*
 * Fairy-DSH [T-128] TTS provider 表：id 清单、配置分区与默认值、字段清单。
 * 解析与带上限的可用性探测共用 ./registry.js。
 *
 * ★ id 命名沿用本仓既有值（`gpt-sovits` / `moss-nano`），**不改用云朵版的
 *   `local-sovits`**：这两个字符串已经写进使用者的 `~/.dsh/fairy-voice/runtime/config.json`，
 *   改名等于让老用户的配置静默失效。
 */
import { CUSTOM_HTTP_DEFAULTS, CUSTOM_HTTP_ID, createCustomHttpProvider } from './custom-http.js';
import { MOSS_DEFAULTS, MOSS_ID, createMossProvider } from './moss-nano.js';
import { OPENAI_DEFAULTS, OPENAI_ID, createOpenAiProvider } from './openai.js';
import { SOVITS_DEFAULTS, SOVITS_ID, createSovitsProvider } from './local-sovits.js';
import { createVoiceProviderRegistry } from './registry.js';

export const PROVIDER_IDS = [SOVITS_ID, MOSS_ID, OPENAI_ID, CUSTOM_HTTP_ID];
export const DEFAULT_PROVIDER_ID = SOVITS_ID;

const PROVIDER_CONFIG_KEYS = {
  [SOVITS_ID]: 'sovits',
  [MOSS_ID]: 'moss',
  [OPENAI_ID]: 'openai',
  [CUSTOM_HTTP_ID]: 'customHttp',
};
export const PROVIDER_CONFIG_DEFAULTS = {
  sovits: SOVITS_DEFAULTS,
  moss: MOSS_DEFAULTS,
  openai: OPENAI_DEFAULTS,
  customHttp: CUSTOM_HTTP_DEFAULTS,
};
export const PROVIDER_CONFIG_FIELDS = {
  sovits: ['baseURL', 'referenceAudioPath', 'referencePromptPath'],
  moss: ['baseURL', 'referenceAudioPath'],
  openai: ['baseURL', 'apiKey', 'model', 'voice', 'responseFormat'],
  customHttp: ['url', 'method', 'headersJson', 'bodyTemplate'],
};

/** 只认清单内的 id；其余（含配置文件被手改坏）一律回落到默认引擎。 */
export function normalizeProvider(input) {
  return PROVIDER_IDS.includes(input) ? input : DEFAULT_PROVIDER_ID;
}

/* 旧字段兼容：0.3.2 时代的配置只有 sovitsBase / mossBase（那时还没有 providers 分区）。
 * 分区里没写、旧字段有值 ⇒ 沿用旧值，老用户升级后行为不变。 */
export function configForProvider(id, settingsValue) {
  const key = PROVIDER_CONFIG_KEYS[id];
  if (!key) return {};
  const defaults = PROVIDER_CONFIG_DEFAULTS[key] || {};
  const stored = settingsValue?.providers?.[key] || {};
  if (key === 'sovits') {
    const legacy = typeof settingsValue?.sovitsBase === 'string' ? settingsValue.sovitsBase : '';
    return { ...defaults, ...(legacy ? { baseURL: legacy } : {}), ...stored };
  }
  if (key === 'moss') {
    const legacy = typeof settingsValue?.mossBase === 'string' ? settingsValue.mossBase : '';
    return { ...defaults, ...(legacy ? { baseURL: legacy } : {}), ...stored };
  }
  return { ...defaults, ...stored };
}

export function configKeyForProvider(id) {
  return PROVIDER_CONFIG_KEYS[id] || null;
}

export function createTtsProviderRegistry({
  fetchImpl = fetch,
  ttsTimeoutMs = 180_000,
  statusTimeoutMs = 3_000,
  availabilityTimeoutMs = 3_000,
} = {}) {
  return createVoiceProviderRegistry({
    ids: PROVIDER_IDS,
    providers: new Map([
      [SOVITS_ID, createSovitsProvider({ fetchImpl, ttsTimeoutMs, statusTimeoutMs })],
      [MOSS_ID, createMossProvider({ fetchImpl, ttsTimeoutMs, statusTimeoutMs })],
      [OPENAI_ID, createOpenAiProvider({ fetchImpl, ttsTimeoutMs })],
      [CUSTOM_HTTP_ID, createCustomHttpProvider({ fetchImpl, ttsTimeoutMs })],
    ]),
    configFor: configForProvider,
    requestedOf: (settingsValue) => normalizeProvider(settingsValue?.provider),
    fallbackId: DEFAULT_PROVIDER_ID,
    unknownReason: '未知的语音提供方。',
    warnOperation: 'provider.resolve',
    availabilityTimeoutMs,
  });
}
