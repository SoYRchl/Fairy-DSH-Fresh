/*
 * Fairy-DSH [T-130] Deepgram 预录音转写 provider：`/v1/listen` 收原始容器字节，
 * Token 鉴权，不套 multipart。
 *
 * ★ 形状来源：云朵版 `stt-deepgram.js`（D-042/D-056：只取形状，重新实现）。
 */
import {
  STT_PROVIDER_UNAVAILABLE,
  requestStt,
  sttProviderError,
  trimBaseUrl,
} from './stt-http.js';

export const DEEPGRAM_STT_ID = 'deepgram';

export const STT_DEEPGRAM_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.deepgram.com',
  apiKey: '',
  model: 'nova-3',
  language: 'zh-CN',
});

function resolveConfig(config = {}) {
  return { ...STT_DEEPGRAM_DEFAULTS, ...config };
}

function listenUrl(value, language) {
  const base = trimBaseUrl(value.baseUrl);
  if (!base) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置 Deepgram 服务地址。');
  const query = new URLSearchParams();
  query.set('model', String(value.model ?? '').trim());
  const spoken = String(language || value.language || '').trim();
  if (spoken) query.set('language', spoken);
  query.set('smart_format', 'true');
  query.set('punctuate', 'true');
  return `${base}/v1/listen?${query.toString()}`;
}

export function createDeepgramSttProvider({ fetchImpl = fetch } = {}) {
  return {
    id: DEEPGRAM_STT_ID,
    /** 不发探测：离线状态下只有密钥这一件能判的事。 */
    status(config) {
      const value = resolveConfig(config);
      if (!String(value.apiKey || '').trim()) return { available: false, reason: '未配置 Deepgram API Key。' };
      if (!trimBaseUrl(value.baseUrl)) return { available: false, reason: '未配置 Deepgram 服务地址。' };
      return { available: true, reason: null };
    },
    async transcribe({ audio, contentType, language, config, signal }) {
      const value = resolveConfig(config);
      const apiKey = String(value.apiKey || '').trim();
      if (!apiKey) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置 Deepgram API Key。');
      const url = listenUrl(value, language);
      const response = await requestStt(fetchImpl, url, {
        method: 'POST',
        // Deepgram 自己声明容器：multipart  body 会被当成噪声转写。
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
        body: audio,
      }, signal);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw sttProviderError('provider-failed', '语音识别服务未返回有效响应。');
      }
      const transcript = payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      if (typeof transcript !== 'string' || !transcript.trim()) {
        throw sttProviderError('provider-failed', '语音识别服务未返回识别结果。');
      }
      return { text: transcript.trim() };
    },
  };
}
