/*
 * Fairy-DSH [T-130] STT provider 共享请求边界。
 *
 * ★ 形状来源：云朵版（同源实验分支 `addsas222/Fairy-DSH-Exp` 的
 *   `fairy-voice/lib/providers/http.js` + `stt-online.js`）。按 D-042/D-056
 *   的口径 —— **只取接口与形状，重新实现**，不把实验仓引为依赖。
 *
 * ★ 与 TTS 侧（./registry.js）的分工：那边管「id → provider 表 + 兜底 + 探测上限」，
 *   这边只管「一次上游请求的取消、传输失败与错误码」。wire 形状由各 provider 自己拥有。
 *
 * 设计红线（沿袭 TTS 侧）：
 *  - 取消时保留服务端自己的 reason（timeout / client-aborted / disposed / superseded），
 *    让 HTTP 状态映射继续成立；
 *  - 错误一律带 code，调用方（index.js）按 code 翻人话，不在这里翻。
 */

export const STT_PROVIDER_UNAVAILABLE = 'provider-unavailable';
export const STT_PROVIDER_FAILED = 'provider-failed';
export const STT_PROVIDER_CLIENT_SIDE = 'client-side';

export function sttProviderError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** 去掉尾部斜杠，`${base}/path` 不会双分隔符。 */
export function trimBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/**
 * 本地 whisper.cpp / faster-whisper / speaches 服务器通常不带鉴权，
 * 所以空密钥在「确实是本机」时合法。主机名取自 URL 解析器 ——
 * 字符串前缀测试会把 `127.0.0.1.evil.com` 也当成本机。
 */
export function isLoopbackBaseUrl(baseURL) {
  let hostname;
  try {
    hostname = new URL(String(baseURL ?? '').trim()).hostname;
  } catch (error) {
    return false;
  }
  // WHATWG 会保留 IPv6 字面量的方括号（`[::1]`）。
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * 上游服务从 multipart 文件名的后缀嗅探容器，后缀贴错会在读音频前就被拒。
 * 宿主只传 `type/subtype` 字符串，不带参数。
 */
const AUDIO_EXTENSIONS = new Map([
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/wave', 'wav'],
  ['audio/flac', 'flac'],
  ['audio/x-flac', 'flac'],
]);

export function audioFileName(contentType) {
  const extension = AUDIO_EXTENSIONS.get(String(contentType || '').trim().toLowerCase());
  return `audio.${extension || 'bin'}`;
}

/** 点分路径取值（`text`、`data.text`、`0.text`）。只要点分段，不引入 JSONPath 依赖。 */
export function readResponsePath(value, path) {
  const parts = String(path ?? '').trim().split('.').filter(Boolean);
  if (!parts.length) return undefined;
  let current = value;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/** 静态请求头：只认合法 JSON 对象，键值都转字符串；CRLF 一概拒绝（防头注入）。 */
export function parseStaticHeaders(headersJson) {
  let value;
  try {
    value = JSON.parse(String(headersJson ?? '{}'));
  } catch (error) {
    throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '请求头不是合法 JSON。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '请求头必须是 JSON 对象。');
  }
  const headers = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = String(key).trim();
    if (!name) throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '请求头存在空键名。');
    const headerValue = typeof raw === 'string' ? raw : String(raw ?? '');
    if (/[\r\n]/.test(name) || /[\r\n]/.test(headerValue)) {
      throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '请求头不允许包含换行。');
    }
    headers[name] = headerValue;
  }
  return headers;
}

/**
 * 只存在于设置卡片里的 provider：宿主没有它的传输通道，`/fairy-voice/stt`
 * 对它答 409，真正的活在浏览器那一半。
 */
export function clientSideSttProvider(id, message) {
  return Object.freeze({
    id,
    status: () => ({ available: true, reason: null }),
    transcribe: () => Promise.reject(sttProviderError(STT_PROVIDER_CLIENT_SIDE, message)),
  });
}

/** 一次上游 fetch + 错误码归类。取消保留服务端自己的 reason。 */
export async function requestStt(fetchImpl, url, options, signal) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal });
  } catch (error) {
    if (signal?.aborted) throw sttProviderError(signal.reason || 'client-aborted', '语音识别请求已取消。');
    throw sttProviderError(STT_PROVIDER_UNAVAILABLE, '语音识别服务连接失败。');
  }
  if (!response || typeof response.ok !== 'boolean') {
    throw sttProviderError(STT_PROVIDER_FAILED, '语音识别服务未返回有效响应。');
  }
  if (!response.ok) throw sttProviderError(STT_PROVIDER_FAILED, `语音识别服务返回 ${response.status}`);
  return response;
}
