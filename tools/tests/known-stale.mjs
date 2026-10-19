/*
 * 已知失效的上游测试（显式记录，不静默跳过）
 *
 * 为什么有这份名单
 * ----------------
 * 本仓库 34 个测试文件全部来自上游（原作者的 `4c1a161 Initial public Fairy DSH
 * plugin suite`），而 18 个兼容提交**从未改动过任何一个 test 文件**。
 * 结果：这些测试断言的是**上游当初的代码结构**，而兼容工作**故意改掉了**那些
 * 结构（合并 settings.section、拆掉视觉模式门控、把 fairy-contracts 内联进
 * vendor/ …）。所以它们从兼容工作开始的那一刻就失效了 —— 只是因为**此前没有
 * 任何 CI**，一直没人发现。
 *
 * 2026-10-14（T-107）补充：`fairy-system/test/` 的 6 个文件同样从未进过任何 CI
 * （`run-tests.mjs` 的包清单里没有 `fairy-system`），实测 23 项失败。现已把该目录
 * 纳入收集范围，并**当场修掉大部分**：
 *   · accepted-baseline.test.js —— 2 项：`new URL().pathname` 在 Windows 上的盘符
 *     拼接 bug + `--diff` 依赖 `/usr/bin/diff`（Windows 没有）→ 已修，现全绿。
 *   · preflight.test.js —— 6 项：夹具依赖**本机** `~/.local/.../dsh` + 相对符号链接
 *     在 Windows 上静默失效 → 已改为夹具自带官方 dsh / 绝对 junction，现全绿。
 *   · upgrade.test.js —— 7 项：2026-10-19 语义级重写（显式 profile 根 + 0.2.x 版本/包名 +
 *     夹具自带 profile/运行时/capability matrix，并补三条「闸门遇到 0.2.x 漂移如何 fail closed」）
 *     → 现全绿并从名单摘除。至此 fairy-system 测试目录全部为绿。
 *
 * 处理原则（重要）
 * ----------------
 * 1. **不删除、不静默跳过。** 静默跳过等于把信号藏起来；这份名单本身就是
 *    "还剩多少历史债务"的可见账本。
 * 2. **每条都要写清为什么失效、以及该怎么修。** 只写"xfail"是无用的。
 * 3. **新测试不允许进这份名单。** 只收这 34 个上游测试的历史遗留。
 * 4. CI 里它们记为 `stale` 而不是 `fail`，但**会打印出来**；
 *    若某个 stale 测试**通过了**，也照样打印（说明该更新名单了）。
 *
 * 消除它们的正确做法：把断言改成针对**当前有意行为**。
 * 例如 settings.section 已并入 fairy-visual 面板 → 断言应改为
 * "voice 包**不再**注册自己的 section"，而不是断言它注册了。
 */
export const KNOWN_STALE = new Map([
  /*
   * 2026-10-19：**名单已清空**。
   *
   * 原先的 5 条历史遗留全部按本文件自己的原则处理完毕 —— 把断言改成针对**当前
   * 有意行为**，而不是放宽或删除：
   *   · fairy-voice/client-contract、fairy-voice/index      → 33 / 22 全绿
   *   · fairy-visual/settings-contract                      → 3 全绿（并修掉失效的包名 import）
   *   · fairy-system/upgrade                                → 10 全绿（按 0.2.1-rc.2 语义级重写）
   *   · browser-dock/startup                                → 1 全绿（根因是 t.after 死等已退出的子进程）
   *
   * 保留这个空 Map 和下面的接口，是为了让 run-tests.mjs 的判定逻辑不变，
   * 也让「以后又出现历史遗留」时有地方写清楚原因与修法 —— 但**新测试不允许进来**。
   */
]);

/**
 * @param {string} suiteLabel 套件标签（如 'fairy-voice/dsh-fairy-voice'）
 * @param {string} fileName   测试文件名（如 'index.test.js'）
 */
export function staleInfoFor(suiteLabel, fileName) {
  return KNOWN_STALE.get(`${suiteLabel}/test/${fileName}`) ?? null;
}