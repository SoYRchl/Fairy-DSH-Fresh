# dsh-fairy-compat · 兼容层骨架

## 这是什么

跨内核的**唯一易变面入口**。目标（焕新方案 §2.2）：

| 换代时的工作 | 旧模式（考古式） | 新模式 |
| --- | --- | --- |
| 定位破坏面 | 复现 → 解 asar → 逐插件猜 | 契约测试直接点名失败行 |
| DOM 改名 | 改散落各处的硬编码 | 改 `UNSTABLE_SURFACES` 一处 |
| 预设失效 | 手工二分 patch | 契约测试 + `tools/check-presets.mjs` |
| 回归验证 | 真机肉眼看 | `node tools/run-tests.mjs` + 隔离实例 + 真机五查 |

## 现状（诚实标注）

**骨架，已可独立使用与测试**，但**5 个插件尚未改成从它读选择器**。
也就是说：`fairy-compat` 现在是"可用的工具 + 事实源"，还不是"唯一的路径"。

## API

```js
import { probeGeneration, degrade, optional, pick, UNSTABLE_SURFACES } from 'dsh-fairy-compat';

probeGeneration(ctx);   // → { generation:'0.2+', toolPresentation:'ptc', presetNeedsRegistry:true, settingsScopeService:false }
pick('conversation');   // 跨代并集取元素；选择器只在 UNSTABLE_SURFACES 里维护
optional('hddVisualMode', () => probeHdd(), false);  // 缺失/抛错 → 一条 capability.missing + 回落值
```

`probeGeneration` 一次探测、进程内缓存；测试里用 `resetProbeCache()` 清。

## 接线（下一步，尚未做）

1. `fairy-visual/src/client/dom-adapter.js`：把 `OFFICIAL_SELECTORS` 改成从 `UNSTABLE_SURFACES` 派生。
   ⚠️ 产物是权威（见 `docs/compat/换代风险登记.md` §3）——`lib/client.js` 与
   `lib/index.iife.js` 都要同步打补丁，并让 `test/guard-modules.test.js` 这类指纹测试守住。
2. 5 个插件的 `package.json` 加 `dsh-fairy-compat` 依赖（`link:../../fairy-compat`）。
3. `profiles/web/cordis.patch.yml` 里不需要注册（它不是 bundle，`dsh.bundle.patch` 指向一个空的
   `cordis.patch.yml`，只为了让声明自洽）。

## 边界

- 它**不做**：不改内核文件、不装依赖、不改官方产物。
- 它**只做**：探测 + 降级 + 选择器事实源。
