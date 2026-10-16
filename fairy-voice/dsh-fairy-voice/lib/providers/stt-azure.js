/*
 * Fairy-DSH [T-130] Azure AI Speech 快速听写 provider：一次 multipart POST 同时带音频与
 * JSON `definition`（这正是它「单趟往返」的原因）。
 *
 * ★ 形状来源：云朵版 `stt-azure.js`（D-042/D-056：只取形状，重新实现）。
 *   本仓契约：`status(config)` 同步判离线可判项 + `transcribe({audio, contentType, language, config, signal})`。
 *
 * ★ 为什么 status 不探测：离线时端点 + 密钥就是全部能判的事；真错了在识别时报。
 *   —— 与 openai / deepgram provider 同一立场。
 */
import {
  STT_PROVIDER_FAILED,
  STT_PROVIDER_UNAVAILABLE,
  requestStt,
  sttProviderError,
  trimBaseUrl,
} from './stt-http.js';

export const AZURE_STT_ID = 'azure';

export const STT_AZURE_DEFAULTS = Object.freeze({
  endpoint: '',
  apiKey: '',
  locale: 'zh-CN',
});

const API_VERSION = '2025-10-15';
const TRANSCRIBE_PATH = '/speechtotext/transcriptions:transcribe';

function resolveConfig(config = {}) {
  return { ...STT_AZURE_DEFAULTS, ...config };
}

/**
 * 官方文档给的是资源根，但运维常把完整请求 URL 直接贴进来：路径已命名 API 的就原样保留，
 * 避免重复拼接。调用方自己带 api-version 时以它的为准。
 */
function transcribeUrl(endpoint) {
  const base = trimBaseUrl(endpoint);
  if (!base) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置 Azure 语音终结点。');
  let url;
  try {
    url = new URL(base);
  } catch (error) {
    throw sttProviderError(STT_PROVIDER_UNAVAILABLE, 'Azure 语音终结点无效。');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/transcriptions:transcribe')) url.pathname = path;
  else if (path.endsWith('/speechtotext')) url.pathname = `${path}/transcriptions:transcribe`;
  else url.pathname = `${path}${TRANSCRIBE_PATH}`;
  if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', API_VERSION);
  return url.toString();
}

/** 中文无词间空格；其它语言用空格连接（Azure 每段返回一句）。 */
function joinPhrases(phrases, locale) {
  const parts = (phrases || [])
    .map((phrase) => (typeof phrase?.text === 'string' ? phrase.text.trim() : ''))
    .filter(Boolean);
  return parts.join(/^zh/i.test(locale || '') ? '' : ' ');
}

export function createAzureSttProvider({ fetchImpl = fetch } = {}) {
  return {
    id: AZURE_STT_ID,
    /** 不发探测：离线可判的只有端点与密钥。 */
    status(config) {
      const value = resolveConfig(config);
      if (!String(value.endpoint || '').trim()) return { available: false, reason: '未配置 Azure 语音终结点。' };
      try {
        transcribeUrl(value.endpoint);
      } catch (error) {
        return { available: false, reason: error.message };
      }
      if (!String(value.apiKey || '').trim()) return { available: false, reason: '未配置 Azure 语音 API Key。' };
      return { available: true, reason: null };
    },
    async transcribe({ audio, contentType, language, config, signal }) {
      const value = resolveConfig(config);
      const apiKey = String(value.apiKey || '').trim();
      if (!apiKey) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '未配置 Azure 语音 API Key。');
      const url = transcribeUrl(value.endpoint);
      const locale = String(language || value.locale || '').trim();
      const form = new FormData();
      form.append('audio', new Blob([audio], { type: contentType }));
      // 文档里这个 part 是纯表单文本。
      form.append('definition', JSON.stringify({ locales: locale ? [locale] : [] }));
      // fetch 派生的 boundary 必须保留：在这里设 Content-Type 会把它抹掉，body 直接不可解析。
      const response = await requestStt(fetchImpl, url, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
        body: form,
      }, signal);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw sttProviderError(STT_PROVIDER_FAILED, '语音识别服务未返回有效响应。');
      }
      // combinedPhrases 是服务自带的全说话人拼接；缺它时才退到逐句 join。
      const combined = payload?.combinedPhrases?.[0]?.text;
      if (typeof combined === 'string' && combined.trim()) return { text: combined.trim() };
      if (!Array.isArray(payload?.phrases)) throw sttProviderError(STT_PROVIDER_FAILED, '语音识别服务未返回识别结果。');
      return { text: joinPhrases(payload.phrases, locale) };
    },
  };
}
