/*
 * Fairy-DSH [T-128] OpenAI 兼容 `/audio/speech` provider（新增）。
 *
 * ★ 为什么先补它：本仓原有两条路（GPT-SoVITS / MOSS）都要求使用者**本机跑服务**。
 *   对外定位是「给别人用」（D-040），别人机器上没有这些服务 ⇒ 朗读功能等于没有。
 *   OpenAI `/audio/speech` 是事实标准：自建网关、第三方中转、官方 OpenAI 都能接。
 *
 * ★ 刻意的设计选择：
 *   - `available()` **不发网络请求**，只校验配置是否填全。云端 TTS 每次开设置面板
 *     都发一次探测，既慢又会烧额度；填了地址与 Key 就当"可试"，真错了在合成时报错。
 *   - `response_format` 默认 `pcm`（与本地两条路一致，服务端直接 pipe PCM）。
 *     若服务端返回 mp3，客户端仍会按音频播放，只是不再走 PCM 精确定位。
 */
export const OPENAI_ID = 'openai';
export const OPENAI_SAMPLE_RATE = 24_000;
export const OPENAI_DEFAULTS = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'tts-1',
  voice: 'alloy',
  responseFormat: 'pcm',
};

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveConfig(config = {}) {
  return { ...OPENAI_DEFAULTS, ...config };
}

export function createOpenAiProvider({ fetchImpl = fetch, ttsTimeoutMs = 180_000 } = {}) {
  return {
    id: OPENAI_ID,
    status(config) {
      const value = resolveConfig(config);
      if (!String(value.baseURL || '').trim()) return { available: false, reason: '未配置语音服务地址。' };
      if (!String(value.apiKey || '').trim()) return { available: false, reason: '未配置 API Key。' };
      return { available: true, reason: null };
    },
    async stream(text, config, { signal } = {}) {
      const value = resolveConfig(config);
      const apiKey = String(value.apiKey || '').trim();
      const baseURL = trimBase(value.baseURL);
      if (!apiKey) throw Object.assign(new Error('未配置 API Key。'), { code: 'provider-unavailable' });
      if (!baseURL) throw Object.assign(new Error('未配置语音服务地址。'), { code: 'provider-unavailable' });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), ttsTimeoutMs);
      const onAbort = () => controller.abort(signal?.reason || 'client-aborted');
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetchImpl(`${baseURL}/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: value.model,
            voice: value.voice,
            input: text,
            response_format: value.responseFormat,
          }),
          signal: controller.signal,
        });
        return { response, release: null };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
