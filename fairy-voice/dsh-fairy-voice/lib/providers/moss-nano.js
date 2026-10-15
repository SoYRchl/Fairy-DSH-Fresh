/*
 * Fairy-DSH [T-128] MOSS-TTS-Nano provider（本仓第二条朗读路线的注册表包装）。
 * 与 local-sovits 同理：包装已有传输层，不新增行为。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMossTtsTransport } from '../server/moss-tts-transport.js';

export const MOSS_ID = 'moss-nano';
export const MOSS_DEFAULTS = {
  baseURL: 'http://127.0.0.1:18083',
  referenceAudioPath: join(homedir(), '.dsh', 'fairy-voice', 'reference', 'fairy_ref.wav'),
};

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function createMossProvider({
  fetchImpl = fetch,
  ttsTimeoutMs = 180_000,
  statusTimeoutMs = 3_000,
} = {}) {
  const build = (config = {}) => {
    const base = trimBase(config.baseURL || MOSS_DEFAULTS.baseURL);
    return createMossTtsTransport({
      fetchImpl,
      base,
      generateUrl: `${base}/api/generate`,
      healthUrl: `${base}/health`,
      referenceAudioPath: config.referenceAudioPath || MOSS_DEFAULTS.referenceAudioPath,
      timeoutMs: ttsTimeoutMs,
      statusTimeoutMs,
    });
  };
  return {
    id: MOSS_ID,
    async status(config = {}, { signal } = {}) {
      try {
        await build(config).status(signal);
        return { available: true, reason: null };
      } catch (error) {
        if (signal?.aborted) return { available: false, reason: '检查已取消。' };
        return { available: false, reason: '本地 MOSS-TTS-Nano 服务未启动。' };
      }
    },
    async stream(text, config = {}, { signal } = {}) {
      const result = await build(config).stream(text, signal);
      return { response: result?.response || result, release: result?.release || null };
    },
  };
}
