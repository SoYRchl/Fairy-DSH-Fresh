import z from '@deepseek-ai/schemastery';
import {
  FAIRY_IDENTITY_SETTINGS_NAMESPACE,
  FAIRY_VISUAL_SETTINGS_NAMESPACE,
  FAIRY_VISUAL_SETTINGS_VERSION,
} from 'dsh-fairy-contracts';
import { createFairyDiagnostics } from 'dsh-fairy-contracts/diagnostics';

// [local patch 2026-10-10] dsh 0.2.0-rc.2 不再导出 `settingsNamespace`。
// 旧内核里它只是"品牌化 + 格式校验"的辅助函数；而 settings.register 这条注册路径
// 在 dsh 0.1.7+ 已被上游移除（见下方 apply() 的 skip 守卫），故内联一份语义完全
// 相同的实现，使模块在 0.2.0-rc.2 上可正常导入，0.1.x 下行为不变。
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
function settingsNamespace(value) {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
  }
  return value;
}

const settingsNamespaceName = FAIRY_VISUAL_SETTINGS_NAMESPACE;
const FAIRY_VISUAL_SETTINGS = settingsNamespace(settingsNamespaceName);
const FAIRY_IDENTITY_SETTINGS = settingsNamespace(FAIRY_IDENTITY_SETTINGS_NAMESPACE);
const diagnostics = createFairyDiagnostics('dsh-fairy-visual');

export const FairyVisualSettings = z.object({
  version: z.number().step(1).default(FAIRY_VISUAL_SETTINGS_VERSION),
  enabled: z.boolean().default(false),
  theme: z.union(['dark', 'light']).default('dark'),
  mascotVisible: z.boolean().default(true),
  mascotScale: z.number().step(0.01).min(0.55).max(1).default(1),
  mascotAnimationSpeed: z.union([z.const(0.7), z.const(1), z.const(1.5)]).default(1),
  powerMode: z.union(['normal', 'low-power']).default('normal'),
  composerDockHeight: z.number().step(1).min(132).max(420).default(132),
});

export const FairyIdentitySettings = z.object({
  mode: z.union(['ling', 'zhe', 'custom']).default('ling'),
  customName: z.string().default(''),
  secondAssistant: z.string().default(''),
  household: z.array(z.string()).default([]),
});

export const name = 'dsh-fairy-visual';

export function apply(ctx) {
  return diagnostics.guard('apply', () => {
    ctx.inject(['settings'], (settingsCtx) => {
      // [compat patch] dsh 0.1.7+ removed register() — skip instead of crashing.
      if (typeof settingsCtx.settings.register !== 'function') return;
      settingsCtx.settings.register(FAIRY_VISUAL_SETTINGS, FairyVisualSettings);
      settingsCtx.settings.register(FAIRY_IDENTITY_SETTINGS, FairyIdentitySettings);
    });
  }, { surface: 'host' });
}
