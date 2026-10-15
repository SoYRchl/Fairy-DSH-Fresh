/*
 * Fairy-DSH [T-128] 自定义 HTTP provider（新增）。
 *
 * 给"我有个自己的 TTS 接口"的人留的口子：填 URL / 方法 / 请求头 / 请求体模板，
 * 模板里的 `{{text}}` 会被替换成要朗读的文本（JSON 转义由这里负责，不用手写转义）。
 *
 * ★ 安全口径：这是**服务端发起**的请求（DSH 后端进程），使用者自己填自己的地址，
 *   不经过浏览器，也不存在跨域问题。响应体原样 pipe 给客户端当音频。
 */
export const CUSTOM_HTTP_ID = 'custom-http';
export const CUSTOM_HTTP_DEFAULTS = {
  url: '',
  method: 'POST',
  headersJson: '{"Content-Type":"application/json"}',
  bodyTemplate: '{"text":"{{text}}"}',
};

function resolveConfig(config = {}) {
  return { ...CUSTOM_HTTP_DEFAULTS, ...config };
}

function parseHeaders(headersJson) {
  try {
    const value = JSON.parse(String(headersJson || '{}'));
    const headers = {};
    for (const [key, raw] of Object.entries(value || {})) {
      if (typeof raw === 'string' || typeof raw === 'number') headers[String(key)] = String(raw);
    }
    return headers;
  } catch {
    throw Object.assign(new Error('请求头不是合法的 JSON。'), { code: 'provider-config-invalid' });
  }
}

export function createCustomHttpProvider({ fetchImpl = fetch, ttsTimeoutMs = 180_000 } = {}) {
  return {
    id: CUSTOM_HTTP_ID,
    status(config) {
      const value = resolveConfig(config);
      if (!String(value.url || '').trim()) return { available: false, reason: '未配置接口地址。' };
      try {
        new URL(String(value.url).trim());
      } catch {
        return { available: false, reason: '接口地址格式不对（要带 http:// 或 https://）。' };
      }
      try {
        parseHeaders(value.headersJson);
      } catch (error) {
        return { available: false, reason: error.message };
      }
      return { available: true, reason: null };
    },
    async stream(text, config, { signal } = {}) {
      const value = resolveConfig(config);
      const url = String(value.url || '').trim();
      if (!url) throw Object.assign(new Error('未配置接口地址。'), { code: 'provider-unavailable' });
      const body = String(value.bodyTemplate ?? '').split('{{text}}').join(JSON.stringify(text).slice(1, -1));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), ttsTimeoutMs);
      const onAbort = () => controller.abort(signal?.reason || 'client-aborted');
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetchImpl(url, {
          method: String(value.method || 'POST').toUpperCase(),
          headers: parseHeaders(value.headersJson),
          body,
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
