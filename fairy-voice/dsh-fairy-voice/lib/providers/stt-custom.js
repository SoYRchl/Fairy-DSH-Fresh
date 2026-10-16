/*
 * Fairy-DSH [T-130] 运营者自定义的 HTTP 听写端点。URL 与请求头都是设置里的静态数据：
 * 这里不签名、不刷新、不派生任何东西。
 *
 * ★ 形状来源：云朵版 `stt-custom.js`（D-042/D-056：只取形状，重新实现）。
 *   本仓契约：`status(config)` + `transcribe({audio, contentType, language, config, signal})`。
 */
import {
  STT_PROVIDER_FAILED,
  STT_PROVIDER_UNAVAILABLE,
  parseStaticHeaders,
  readResponsePath,
  requestStt,
  sttProviderError,
} from './stt-http.js';

export const CUSTOM_HTTP_STT_ID = 'custom-http';

export const STT_CUSTOM_HTTP_DEFAULTS = Object.freeze({
  url: '',
  headersJson: '{}',
  responsePath: 'text',
});

function resolveConfig(config = {}) {
  return { ...STT_CUSTOM_HTTP_DEFAULTS, ...config };
}

function hasHeader(headers, name) {
  const wanted = String(name || '').toLowerCase();
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === wanted);
}

export function createCustomSttProvider({ fetchImpl = fetch } = {}) {
  return {
    id: CUSTOM_HTTP_STT_ID,
    status(config) {
      const value = resolveConfig(config);
      const url = String(value.url || '').trim();
      if (!url) return { available: false, reason: '未配置自定义语音识别服务地址。' };
      try {
        // 仅做格式校验，不发起请求。
        // eslint-disable-next-line no-new
        new URL(url);
      } catch (error) {
        return { available: false, reason: '自定义语音识别服务地址无效。' };
      }
      try {
        parseStaticHeaders(value.headersJson);
      } catch (error) {
        return { available: false, reason: error.message };
      }
      return { available: true, reason: null };
    },
    async transcribe({ audio, contentType, language, config, signal }) {
      const value = resolveConfig(config);
      const url = String(value.url || '').trim();
      if (!url) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置自定义语音识别服务地址。');
      try {
        // eslint-disable-next-line no-new
        new URL(url);
      } catch (error) {
        throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '自定义语音识别服务地址无效。');
      }
      const headers = { ...parseStaticHeaders(value.headersJson) };
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = contentType;
      const spoken = String(language || '').trim();
      if (spoken && !hasHeader(headers, 'x-fairy-language')) headers['x-fairy-language'] = spoken;
      const response = await requestStt(fetchImpl, url, { method: 'POST', headers, body: audio }, signal);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw sttProviderError(STT_PROVIDER_FAILED, '语音识别服务未返回有效 JSON。');
      }
      const path = String(value.responsePath ?? '').trim();
      const found = readResponsePath(payload, path);
      if (found === undefined || found === null) {
        throw sttProviderError(STT_PROVIDER_FAILED, `语音识别服务返回内容缺少 ${path || 'text'}。`);
      }
      return { text: typeof found === 'string' ? found : String(found) };
    },
  };
}
