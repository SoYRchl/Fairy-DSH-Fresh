// Fairy 兼容层（骨架）
//
// 目标（见 焕新方案 §2.2）：**所有插件经它触达内核易变面**，把「跟版考古」
// 变成「改一处 + 契约测试点名」。本文件只做两件最小的事：
//
//   1. **代际探测**：内核换代时哪些面变了？一次探测、结果缓存。
//   2. **降级而非崩溃**：可选能力缺失时打 capability.missing 日志并继续，
//      不要让整页白屏或整包静默跳过。
//
// ⚠️ 现状：**骨架**。已可独立使用与测试，但 5 个插件尚未改成从它读选择器
//    （那是下一步；改法见 README「接线」段）。

// ---------------------------------------------------------------------------
// 1. 内核易变面（唯一事实源；改这里而不是改散落各处的硬编码）
// ---------------------------------------------------------------------------

/** 每一面对应的**并集**选择器/探测式；顺序无关，取第一个命中的。 */
export const UNSTABLE_SURFACES = Object.freeze({
  /** 会话容器：0.1.x 是 conversation，0.2.x 改名 main.conversation */
  conversation: '[data-slot="conversation"], [data-slot="main.conversation"]',
  /** 输入框：0.1.x 是 textarea，0.2.x 是 contenteditable div */
  composerInput: 'textarea, [contenteditable][data-composer-input]',
  /** composer 接管槽（多代同名，保留一处便于集中核查） */
  composerSeat: '[data-composer-seat]',
  /** 0.1.x 的客户端运行时包名（0.2.x 已拆为 dsh-client-modules + dsh-client-store） */
  legacyClientRuntime: '@deepseek-ai/dsh-client-runtime',
  /** 0.2.x 的替代包名 */
  clientRuntime: '@deepseek-ai/dsh-client-modules',
});

/** 已知代际，按探测顺序排列（先匹配到的胜出）。 */
export const GENERATIONS = Object.freeze([
  {
    id: '0.2+',
    // 0.1.2+ 起 systemPrompt 有 getSectionOrder；0.1.1 没有字面 order
    detect: (systemPrompt) => typeof systemPrompt?.getSectionOrder === 'function',
    /** 工具呈现取值在这一代改为 ptc */
    toolPresentation: 'ptc',
    /** 0.2 起 agent preset 不再扫描目录，必须注册成 registry 行 */
    presetNeedsRegistry: true,
    /** 0.2 起 settingsScope 服务消失 → 回落 localStorage */
    settingsScopeService: false,
  },
  {
    id: '0.1.1',
    detect: () => true,
    toolPresentation: 'code',
    presetNeedsRegistry: false,
    settingsScopeService: true,
  },
]);

// ---------------------------------------------------------------------------
// 2. 探测（一次，结果缓存）
// ---------------------------------------------------------------------------

let cached = null;

/**
 * @param {object} [ctx] cordis 上下文（可选）。给了就顺手探测 systemPrompt。
 * @returns {{generation: string, toolPresentation: string, presetNeedsRegistry: boolean, settingsScopeService: boolean, probedAt: string}}
 */
export function probeGeneration(ctx) {
  if (cached) return cached;
  const systemPrompt = ctx?.systemPrompt ?? ctx?.get?.('systemPrompt') ?? null;
  const hit = GENERATIONS.find((g) => {
    try {
      return g.detect(systemPrompt);
    } catch {
      return false;
    }
  });
  cached = Object.freeze({
    generation: hit.id,
    toolPresentation: hit.toolPresentation,
    presetNeedsRegistry: hit.presetNeedsRegistry,
    settingsScopeService: hit.settingsScopeService,
    probedAt: new Date().toISOString(),
  });
  return cached;
}

/** 测试用：清掉缓存 */
export function resetProbeCache() {
  cached = null;
}

// ---------------------------------------------------------------------------
// 3. 降级（warn 日志 + 返回值，不抛错）
// ---------------------------------------------------------------------------

/**
 * 可选能力缺失时的统一出口。
 *
 * @param {string} name        能力名（如 'hddVisualMode'）
 * @param {object} options
 * @param {boolean} [options.required] 必需能力缺失也照样只 warn —— 由调用方决定是否中断
 * @param {(line: string) => void} [options.report] 默认写一条结构化诊断
 * @returns {boolean} 恒为 false（表示"该能力不可用"），方便写成 `if (!degrade(...)) return;`
 */
export function degrade(name, { required = false, report } = {}) {
  const line = `[dsh-fairy-compat] ${required ? 'missing required' : 'degraded'} capability: ${name}`;
  if (report) report(line);
  else console.warn(`DSH_FAIRY_LOG ${JSON.stringify({ schema: 1, timestamp: new Date().toISOString(), level: 'warn', module: 'dsh-fairy-compat', operation: 'capability.missing', event: 'event', context: { capability: name, required } })}`);
  return false;
}

/**
 * 让一段可选逻辑带降级执行。
 * @template T
 * @param {string} name
 * @param {() => T} run
 * @param {T} fallback
 * @param {{ required?: boolean, report?: (line: string) => void }} [options] 透传给 degrade
 * @returns {T}
 */
export function optional(name, run, fallback, options = {}) {
  try {
    const value = run();
    if (value === undefined || value === null) {
      degrade(name, options);
      return fallback;
    }
    return value;
  } catch {
    degrade(name, options);
    return fallback;
  }
}

/** 在浏览器端按并集取第一个命中的元素（选择器散落的唯一入口）。 */
export function pick(surface, doc = typeof document === 'undefined' ? null : document) {
  const selector = UNSTABLE_SURFACES[surface];
  if (!selector || !doc) return null;
  for (const part of selector.split(',')) {
    const hit = doc.querySelector(part.trim());
    if (hit) return hit;
  }
  return null;
}

export default { UNSTABLE_SURFACES, GENERATIONS, probeGeneration, resetProbeCache, degrade, optional, pick };
