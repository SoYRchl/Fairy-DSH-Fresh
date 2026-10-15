/*
 * Fairy-DSH [T-128] GPT-SoVITS provider（本仓原有路线的注册表包装）。
 *
 * 这条线**不是新增功能**：它只是把 `server/local-tts-proxy.js` 里已有的
 * GPT-SoVITS 传输层，包成注册表认得的 provider 形状（id / status / stream）。
 * 行为与改动前完全一致 —— 默认引擎仍是它，不填 provider 就等于没改过。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLocalTtsTransport } from '../server/local-tts-proxy.js';

export const SOVITS_ID = 'gpt-sovits';
export const SOVITS_DEFAULTS = {
  baseURL: 'http://127.0.0.1:9880',
  referenceAudioPath: join(homedir(), '.dsh', 'fairy-voice', 'reference', 'fairy_ref.wav'),
  referencePromptPath: join(homedir(), '.dsh', 'fairy-voice', 'reference', 'fairy_ref.txt'),
};
const REFERENCE_PROMPT_FALLBACK = '根据用户协议，我无权回复该问题。主人将在合适的时间与合适的场合获知答案。';

/* 参考音频对应的提示文本。读不到就用内置兜底 —— 只影响音色，不影响能否出声。
 * 这里不复用 server/voice-selfcheck.js 的 readReferencePrompt，是为了避免
 * providers ↔ voice-selfcheck 互相 import 形成循环依赖。 */
function readReferencePrompt(path) {
  try {
    const text = readFileSync(path, 'utf8').trim();
    return text === '' ? REFERENCE_PROMPT_FALLBACK : text;
  } catch {
    return REFERENCE_PROMPT_FALLBACK;
  }
}

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function createSovitsProvider({
  fetchImpl = fetch,
  ttsTimeoutMs = 180_000,
  statusTimeoutMs = 3_000,
} = {}) {
  return {
    id: SOVITS_ID,
    async status(config = {}, { signal } = {}) {
      const base = trimBase(config.baseURL || SOVITS_DEFAULTS.baseURL);
      const transport = createLocalTtsTransport({
        fetchImpl,
        ttsUrl: `${base}/tts`,
        docsUrl: `${base}/docs`,
        referenceAudioPath: config.referenceAudioPath || SOVITS_DEFAULTS.referenceAudioPath,
        referencePrompt: readReferencePrompt(config.referencePromptPath || SOVITS_DEFAULTS.referencePromptPath),
        ttsTimeoutMs,
        statusTimeoutMs,
      });
      try {
        await transport.status(signal);
        return { available: true, reason: null };
      } catch (error) {
        if (signal?.aborted) return { available: false, reason: '检查已取消。' };
        return { available: false, reason: '本地 GPT-SoVITS 服务未启动。' };
      }
    },
    async stream(text, config = {}, { signal } = {}) {
      const base = trimBase(config.baseURL || SOVITS_DEFAULTS.baseURL);
      const transport = createLocalTtsTransport({
        fetchImpl,
        ttsUrl: `${base}/tts`,
        docsUrl: `${base}/docs`,
        referenceAudioPath: config.referenceAudioPath || SOVITS_DEFAULTS.referenceAudioPath,
        referencePrompt: readReferencePrompt(config.referencePromptPath || SOVITS_DEFAULTS.referencePromptPath),
        ttsTimeoutMs,
        statusTimeoutMs,
      });
      const result = await transport.stream(text, signal);
      return { response: result?.response || result, release: result?.release || null };
    },
  };
}
