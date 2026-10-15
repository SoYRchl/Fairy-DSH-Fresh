/*
 * Fairy-DSH [T-128 · 云朵版兼容吸收]
 *
 * TTS provider 注册表的公共脚手架：id→provider 表、带硬上限的可用性探测、
 * 未知 id 的兜底解析与逐项列表。
 *
 * ★ 形状来源：云朵版（同源实验分支 `addsas222/Fairy-DSH-Exp` 的
 *   `fairy-voice/lib/providers/registry.js`）。按 D-042 / D-056 的口径 ——
 *   **只取接口与形状，重新实现**，不把实验仓引为依赖。
 *
 * ★ 与本仓的差异（为什么不能直接照抄）：
 *   云朵版的 provider.stream 是 `stream(text, config, {signal, format})`，
 *   返回 `{response, release, sampleRate}`（它要喂浏览器的 Web Audio 重采样）；
 *   本仓的传输层契约是 `status(signal)` / `stream(text, signal)`，
 *   返回 `{response, release}`，PCM 由服务端 `pcmStreamHandler` 直接 pipe 给客户端。
 *   所以这里**保留本仓契约**，只吸收「id 表 + 分区配置 + 兜底 + 探测上限」这四件事。
 *
 * 设计红线：
 *  - 探测预算是**硬上限**：不理会 signal 的 provider 不能把设置卡片一直吊着（3s 必回）。
 *  - 未知 id **不抛错**，回落到 fallbackId 并留一条 warn —— 配置文件被手改坏也要能起来。
 */
import { createFairyDiagnostics } from '../../vendor/diagnostics.js';

const diagnostics = createFairyDiagnostics('dsh-fairy-voice');

export function createVoiceProviderRegistry({
  ids,
  providers,
  configFor,
  requestedOf,
  fallbackId,
  unknownReason = '未知的语音提供方。',
  warnOperation = 'provider.resolve',
  availabilityTimeoutMs = 3_000,
}) {
  const PROVIDERS = providers;

  const check = (id, settingsValue, signal) => {
    const provider = PROVIDERS.get(id);
    if (!provider) return Promise.resolve({ id, available: false, reason: unknownReason });
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason || 'client-aborted');
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    let timer;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort('timeout');
        resolve({ id, available: false, reason: '检查超时。' });
      }, availabilityTimeoutMs);
    });
    const probe = (async () => {
      try {
        const result = await provider.status(configFor(id, settingsValue), { signal: controller.signal });
        if (result?.available === true) return { id, available: true, reason: null };
        return { id, available: false, reason: String(result?.reason || '不可用。') };
      } catch (error) {
        if (controller.signal.aborted) return { id, available: false, reason: '检查超时。' };
        return { id, available: false, reason: String(error?.message || '不可用。') };
      }
    })();
    return Promise.race([probe, expired]).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    });
  };

  return {
    PROVIDERS,
    /** 未知或缺省 id 回落到 fallbackId，并留一条诊断。 */
    resolve(settingsValue) {
      const requested = requestedOf(settingsValue);
      const provider = PROVIDERS.get(requested);
      if (!provider) {
        diagnostics.warn(warnOperation, { provider: requested, fallback: fallbackId });
        return { id: fallbackId, provider: PROVIDERS.get(fallbackId), config: configFor(fallbackId, settingsValue) };
      }
      return { id: requested, provider, config: configFor(requested, settingsValue) };
    },
    check,
    list(settingsValue, { signal } = {}) {
      return Promise.all(ids.map((id) => check(id, settingsValue, signal)));
    },
  };
}
