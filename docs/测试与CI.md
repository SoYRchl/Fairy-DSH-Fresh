# 测试体系与 CI

> 这份文档回答两件事：**怎么跑测试**，以及**为什么有 7 个测试是失效的**。
>
> 在此之前，本仓库**没有任何 CI**，34 个测试文件从来没有被自动跑过。
> 测试存在但不执行，价值接近零 —— 更糟的是，**没人知道它们其实早就失败了**。

---

## 1. 怎么跑

```powershell
# 全部（本仓库 + 各包上游测试）
node tools\run-tests.mjs

# 只跑本仓库自己的（快，约 1 秒，37 项）
node tools\run-tests.mjs --tools-only

# 自定义单文件超时（默认 60s）
$env:FAIRY_TEST_TIMEOUT_MS = '120000'; node tools\run-tests.mjs
```

首次需要在各包目录安装依赖（仓库没有根 workspace 声明）：

```powershell
foreach ($d in @('fairy-visual\dsh-fairy-visual','fairy-voice\dsh-fairy-voice',
                 'balance-meter\dsh-balance-meter','browser-dock\dsh-browser-dock',
                 'fairy-startup\dsh-fairy-startup')) {
  Push-Location $d; pnpm install --ignore-scripts; Pop-Location
}
```

---

## 2. 三组测试，三种作用

| 组 | 位置 | 数量 | 作用 |
| --- | --- | --- | --- |
| **本仓库 · 兼容层回归** | `tools/tests/compat-patches.test.js` | 11 | 钉住兼容提交的关键点，防止升级或"重新生成"把兼容代码**悄悄删掉** |
| **本仓库 · 发布卫生** | `tools/tests/release-hygiene.test.js` | 11 | 编码契约、URL 指向、版本一致性、lock 文件 |
| **本仓库 · 壳与自举** | `tools/tests/shell-hygiene.test.js` | 10 | 壳源码纯 ASCII、禁本机路径、关窗即停标记 |
| **本仓库 · 一键复现** | `tools/tests/bootstrap.test.js` | 5 | `bootstrap.mjs` 的装包点、junction、mtime 契约 |
| **上游 · 各包自带** | `<包>/test/*.test.js` | 45 文件 | 上游原有的契约与行为测试（含 `fairy-system` / `fairy-compat`） |

**当前实测口径**（2026-10-19）：

| 跑法 | 结果 |
| --- | --- |
| `--tools-only` | **37 pass / 0 fail / 0 stale** |
| 本地全量 | **259 pass / 2 fail / 5 stale** |
| CI（windows-latest，Node 22 + 24） | **251 pass / 7 fail / 5 stale** |

本地 2 项红：`fairy-visual/test/contract.test.js`（断言了一处已被有意改掉的调用写法）、
`browser-dock/test/state-watch.test.js`。CI 上另有 `fairy-system/test/preflight.test.js` 6 项
（夹具依赖本机目录形态，本机通过）。它们都是**待修项**，不是被静默跳过的。

### 为什么兼容层测试是**存在性/形状**测试

它们直接读产物与配置，断言"这个兼容处理还在"，而不是跑起真实内核。
这类测试很粗，但能捕获最危险的情况：**兼容代码被删掉而没人发现**。

真实内核的端到端验证仍然只能靠人工 —— `verify-isolated.ps1` 需要完整的
DSH 环境（Node ≥20 + pnpm + Chrome/Edge），无法进 CI。这一点是已知边界。

---

## 3. ⚠️ 5 个上游测试为什么失效

**全部** 上游测试文件都来自原作者的首次公开提交
（`4c1a161 Initial public Fairy DSH plugin suite`），而**兼容提交从未改动
过任何一个 `test` 文件**。所以它们断言的是**兼容改动之前的结构**，
而兼容工作**故意改掉了**那些结构。

> 这不是"最近才坏"——它们从兼容工作开始的那一刻就失效了，
> 只因**此前没有 CI**，一直没人发现。

失效清单与修法在 [`tools/tests/known-stale.mjs`](../tools/tests/known-stale.mjs)，
每条都写了**为什么失效**和**该怎么修**。**当前剩 5 条**：

| 测试 | 失效原因 | 修法方向 |
| --- | --- | --- |
| `fairy-voice/test/client-contract.test.js` | 断言上游原结构，与兼容改动冲突（槽位所有权 `cf9c055`、活动会话推导 `e64308e`、视觉门控 `39be114`、`settings.section` 合并、`readVoiceTimeline` 签名） | 改为断言**当前有意行为** |
| `fairy-voice/test/index.test.js` | 同上（宿主侧：`settings.register` 守卫、自启加固、配置透传） | 断言当前的守卫/降级行为 |
| `fairy-visual/test/settings-contract.test.js` | 按字面核对 `client.js` 内部形态，而它是**生成物**且被多个兼容提交改过 | 改为断言**契约**（已由 `compat-patches.test.js` 示范） |
| `fairy-system/test/upgrade.test.js` | 整套断言停在 `0.1.1-rc.2` 时代 + 依赖本机现役 home，CI 与整合仓都不成立 | 按当前内核重写断言，或标注所需外部环境 |
| `browser-dock/test/startup.test.js` | 在本机环境**挂死**（60s 超时），疑似等待不会到达的事件 | 定位挂点或标注所需外部环境 |

> 已从名单摘除（真修好了，不是跳过）：`fairy-visual/capability.test.js`（改为断言当前契约）、
> `browser-dock/contract.test.js`（改为比对 `vendor/diagnostics.js`）、
> `browser-dock/state-watch.test.js`（`src/index.js` 的 vendor 内联已补全，Windows 权限位断言加了平台分支）。

### 处理原则（重要）

`known-stale.mjs` **不是"跳过名单"**，它是一个**可见的历史债务账本**：

1. **不删除、不静默跳过。** 静默跳过等于把信号藏起来。
2. **每条都写清原因与修法。** 只写 `xfail` 是无用的。
3. **新测试不允许进名单。** 只收这 34 个上游测试的历史遗留；
   `tools/tests/` 下的测试若失败，一律计为真实失败。
4. 跑测试时它们标记为 `stale` 并**打印出来**；若它们**通过了**，
   也会提示"请从名单移除"，防止名单腐化。
5. 名单里列了但文件已不存在的条目会让 CI **失败**，强制清理。

---

## 4. CI

[`.github/workflows/test.yml`](../.github/workflows/test.yml)

| Job | 内容 |
| --- | --- |
| `test` | windows-latest，Node **22 与 24** 双版本；先跑本仓库测试（最快给出兼容信号），再跑上游测试 |
| `encoding` | 单独 job 复验编码契约：`.ps1` 必须有 BOM；`.cmd` 编码契约与 U+FFFD |

**为什么用 windows-latest**：本仓库的核心缺陷类型（CP936 编码、BOM、
`.cmd` 中文）只在 Windows 上成立。用 ubuntu 跑会漏掉最该守的那一类。

---

## 5. 版本一致性

版本号此前散在 5 处，发版时至少 3 处要手工同步。已收敛为**一个参数**：

```powershell
node tools\sync-version.mjs          # 报告（不一致时退出码 1）
node tools\sync-version.mjs --bump   # 递增 compat 序号并同步 client.js 与生成器
```

单一来源是仓库根的 [`VERSION`](../VERSION)。⚠️ **注意现状**：版本线已改为独立的
`0.1.0-alpha.N`，而 `sync-version.mjs` 仍只认裸三段版本号（`0.3.8` 那种），
对 `0.1.0-alpha.5` 会**报错退出**（`VERSION 不是裸三段版本号`）。这是已知缺口，
发版时靠手工同步，见 README「已知限制」。同步器原本负责写入：

- `fairy-visual/…/lib/client.js` 的 `LOCAL_VERSION`
- `lib/settings-merge.ps1` 的 `$localVersionSuffix`（生成器里的同一份信息）

各包 `package.json` 的 `version` 是**独立**的（插件市场靠它判断更新），不参与发布版本。

> 📌 真实事故：`LOCAL_VERSION` 曾停在 `'0.3.5'`；改成 `'0.3.8-compat.1'` 后又发现
> 即使带上后缀，旧比较逻辑因 `Number('compat')` 是 `NaN` 仍判为"不更新"。
> 现在这两点都有测试钉住。
