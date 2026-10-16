/*
 * Fairy-DSH [T-130] OpenAI 兼容 `/audio/transcriptions` provider（multipart 上传）。
 *
 * ★ 形状来源：云朵版 `stt-openai.js`（D-042/D-056：只取形状，重新实现）。
 *   本仓 provider 契约与 TTS 侧对齐：`status(config)`（同步、不发请求）+
 *   `transcribe({ audio, contentType, language, config, signal })`。
 *
 * ★ 为什么 status 不发探测请求：云端 STT 每开一次设置面板就发一次探测，
 *   既慢又烧额度；地址与密钥填全就当"可试"，真错了在识别时报错。
 *   —— 与 TTS 的 openai provider 同一立场。
 *
 * ★ 本地服务免密钥：whisper.cpp / faster-whisper / speaches 通常不带鉴权，
 *   空密钥 + loopback 地址即合法；空 `Bearer ` 头会让某些本地服务答 401，
 *   所以无密钥时干脆不带 Authorization 头。
 */
import {
  STT_PROVIDER_UNAVAILABLE,
  audioFileName,
  isLoopbackBaseUrl,
  requestStt,
  sttProviderError,
  trimBaseUrl,
} from './stt-http.js';

export const OPENAI_STT_ID = 'openai';

export const STT_OPENAI_DEFAULTS = Object.freeze({
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'whisper-1',
  language: 'zh',
});

function resolveConfig(config = {}) {
  return { ...STT_OPENAI_DEFAULTS, ...config };
}

export function createOpenAiSttProvider({ fetchImpl = fetch } = {}) {
  return {
    id: OPENAI_STT_ID,
    status(config) {
      const value = resolveConfig(config);
      if (!trimBaseUrl(value.baseURL)) return { available: false, reason: '未配置语音识别服务地址。' };
      if (!String(value.apiKey || '').trim()) {
        if (isLoopbackBaseUrl(value.baseURL)) return { available: true, reason: '本地服务无需密钥。' };
        return { available: false, reason: '未配置 API Key。' };
      }
      return { available: true, reason: null };
    },
    async transcribe({ audio, contentType, language, config, signal }) {
      const value = resolveConfig(config);
      const apiKey = String(value.apiKey || '').trim();
      const baseURL = trimBaseUrl(value.baseURL);
      if (!baseURL) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置语音识别服务地址。');
      if (!apiKey && !isLoopbackBaseUrl(baseURL)) {
        throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置 API Key。');
      }
      const form = new FormData();
      form.append('file', new Blob([audio], { type: contentType }), audioFileName(contentType));
      form.append('model', String(value.model ?? '').trim());
      // 请求头的语言优先于存档默认值：一次会话可以自定口语语言，不必改设置。
      const spoken = String(language || value.language || '').trim();
      if (spoken) form.append('language', spoken);
      // ⚠ 不能在这里设 Content-Type：fetch 自己派生 multipart boundary，
      //   手动设会把 boundary 抹掉，上游 body 直接不可解析。
      const response = await requestStt(fetchImpl, `${baseURL}/audio/transcriptions`, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body: form,
      }, signal);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw sttProviderError('provider-failed', '语音识别服务未返回有效响应。');
      }
      const text = typeof payload?.text === 'string' ? payload.text : '';
      if (!text.trim()) throw sttProviderError('provider-failed', '语音识别服务未返回识别结果。');
      return { text: text.trim() };
    },
  };
}
