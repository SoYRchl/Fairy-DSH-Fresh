# Fairy-DSH 跨内核兼容版

> **DSH Desktop 跨内核兼容版 Fairy 插件套件** —— 在 `dsh` 内核代际切换期间，让 Fairy（视觉浮层 / HDD 主题 / 朗读 / 余额）继续可用。
>
> 本仓库由 **[SoYRchl](https://github.com/SoYRchl)** 维护，是 Apache-2.0 开源项目 **Fairy-DSH** 的下游二次开发分支。**当前为开发进行中状态**，文档与功能会随进度调整。

| | |
| --- | --- |
| **当前版本** | 基线 `v0.3.8`（孤舟版）+ 31 个兼容提交 → `v0.3.8-compat.1` |
| **适配内核** | `dsh 0.1.5-rc.1` ~ `dsh 0.2.0-rc.2` ｜ DSH Desktop `2.0.9` ~ `2.0.17` |
| **许可** | Apache-2.0（继承自上游） |

---

## 一、血缘与归属

本仓库**不是原创项目**，是 Fairy-DSH 生态的下游分支。完整血缘：

- **原作者**：**橙汁本色**（`Chengzhibense`）—— Fairy 插件套件的全部原创代码（人设语料、HDD 视觉、布局、mascot、朗读逻辑）。
- **上游整合分支**：**孤舟蓑笠**（`Guzhou2002/Fairy-DSH-Optimized`，v0.3.8）—— 本仓库的直接基线，提供了可分发的整合包。
- **上游整合分支**：**playinginzzz**（`playinginzzz/Fairy-DSH-compat`）—— 同为上游整合分支。
- **同源功能实验分支**：**addsas222**（`addsas222/Fairy-DSH-Exp`）—— 同源，其人格包引擎 / 多会话 / 多 TTS 引擎等适用功能将**兼容吸收**进本仓库。
- **本仓库（SoYRchl）**：修复 `dsh` 内核换代造成的故障（31 个兼容提交、10 类故障、双内核 feature-detection 兼容）。

⚠️ 本仓库是**非官方**分支，不代表原作者、上游或 DeepSeek 官方立场，未获任何背书。问题请开 **[本仓库 Issues](https://github.com/SoYRchl/Fairy-DSH-Fresh/issues)**，不要打扰上游作者。

---

## 二、安装

> ⚠️ **当前为源码发布形态**，预构建 Release 尚未发布。现阶段请由 Agent 按 [AGENTS.md](AGENTS.md) 从源码安装，或自行 `dsh plugin --profile web add <本地路径>`。
>
> ⚠️ 孤舟版 / 云朵版装的东西会互相覆盖，**同一 DSH 实例只装一套**。

**让 Agent 装**（把下面这段丢给 DSH Agent）：

> 从 https://github.com/SoYRchl/Fairy-DSH-Fresh 安装 `dsh-fairy-visual`、`dsh-fairy-voice`、`dsh-balance-meter` 到我的 web profile，**不要**装 `dsh-fairy-startup` 和 `dsh-browser-dock`。详见 AGENTS.md。

**命令行**（会敲命令）：

```powershell
dsh plugin --profile web add `
  <本仓库 dsh-fairy-visual 路径或 .tgz> `
  <dsh-fairy-voice 路径或 .tgz> `
  <dsh-balance-meter 路径或 .tgz>
```

要求：已装 DSH（适配 `0.1.5-rc.1`~`0.2.0-rc.2`）、Node.js ≥ 20、pnpm（装 DSH 时不会自带，需 `npm i -g pnpm`）、能连 GitHub / npm。

---

## 三、启用

1. **重启 DSH**（关掉再打开）
2. 设置 → **Fairy** → 打开最上面的「**启用**」
3. （可选）想当默认人设：同页打开「**Fairy 人设预设**」
4. （可选）想用朗读：点「**开始自检**」确认能出声

> 插件装好后默认是关着的（故意的）。第 2 步不做，视觉和朗读都不会出现。

---

## 四、朗读引擎

`dsh-fairy-voice` 支持**两个朗读引擎**，按你的环境选，二者无优劣之分：

| 引擎 | 需要什么 | 适合 |
| --- | --- | --- |
| **GPT-SoVITS** | 本机跑 SoVITS 服务（默认 `127.0.0.1:9880`）+ 参考音频 | 有显卡、想要流式合成 |
| **MOSS-TTS-Nano** | 本机跑 MOSS 服务（默认 `127.0.0.1:18083`）+ 同一份参考音频 | 无显卡、CPU 可跑 |

- 在 **设置 → Fairy → 朗读设置 → 朗读引擎** 切换，**即时生效、不用重启**；两个引擎各自记住地址，来回切不丢。
- 参考音频两份引擎共用，只配一次。
- 没跑对应服务时，**朗读按钮是灰色的、不会出声** —— 这是上游设计，不是故障。
- MOSS 是**整句合成完再出声**（非流式），按了朗读要等几秒才响，设计如此。MOSS 服务端由本仓库 `tools/moss-tts-server/server.py` 提供，详情见 [docs/本地改动.md](docs/本地改动.md)。

---

## 五、兼容性说明

本仓库通过 **feature-detection（能力探测）** 而非判版本号来跨两代 `dsh` 内核（`0.1.x` 与 `0.2.x`）兼容：

- 两代 API 并存时取其一（如 `IconPlayOutline16 ?? IconPlayOutlineRegular`），新旧内核零分叉；
- 被改名的服务不硬声明，探测失败即降级兜底，**保证启动**；
- 三个包声明了宽松的 `peerDependencies` 覆盖两条内核线。

> ⚠️ **DSH 升级后建议先跑一次根目录的 `verify.cmd` 自检**：上游依赖官方 DOM 选择器与私有 slot 契约，升级后可能静默降级。本仓库的适配层只在已知变更点生效，**新出现的内核变更仍可能造成故障**。

---

## 六、本地改动（相对上游）

- **本仓库（SoYRchl）**：31 个跨内核兼容提交（10 类故障，见 [docs/DSH Desktop × Fairy 兼容性适配报告.pdf](<docs/DSH Desktop × Fairy 兼容性适配报告.pdf>)）。
- **上游整合分支（孤舟版）**：一键安装器、Release + SHA256、朗读自检面板、设置栏合并、MOSS-TTS-Nano 第二朗读引擎等。
- 全部改动遵循 Apache-2.0 §4(b)：上游文件修改均带 `[local patch]` 注释，逐条见 [docs/本地改动.md](docs/本地改动.md)。
- **表现层（人设语料 / 布局 / 样式）一个字节没动**；改的都是内核接口适配层。

---

## 七、已知限制

- 会和别的改界面插件抢 DOM（`beauticode`、`whale-widget`、`live2d-companion`、`liang-slider`、`ui-task-board`），建议先禁用一部分再启用 Fairy。
- `fairy-startup` 每次加载清空会话选择，**默认不装**。
- `browser-dock` 暴露控制 token、缓存截图，**不建议安装**（默认不装）。
- 兼容层仍有未端到端验证项（见适配报告 §07）：回退演练、设置暂存同步、中间版本未逐一实测、未做长时间压测。

---

## 八、Contributors

| 角色 | 作者 | 仓库 |
| --- | --- | --- |
| **维护者 / Owner** | **SoYRchl** | [SoYRchl/Fairy-DSH-Fresh](https://github.com/SoYRchl/Fairy-DSH-Fresh) |
| **原作者（原创代码）** | **橙汁本色** | [Chengzhibense/Fairy-DSH](https://github.com/Chengzhibense/Fairy-DSH) |
| **上游整合分支** | **孤舟蓑笠** | [Guzhou2002/Fairy-DSH-Optimized](https://github.com/Guzhou2002/Fairy-DSH-Optimized) |
| **上游整合分支** | **playinginzzz** | [playinginzzz/Fairy-DSH-compat](https://github.com/playinginzzz/Fairy-DSH-compat) |
| **同源功能实验分支** | **addsas222** | [addsas222/Fairy-DSH-Exp](https://github.com/addsas222/Fairy-DSH-Exp) |

> 上游作者与孤舟版作者**均未参与**本仓库的兼容改动；其提交记录不属于本仓库 Contributors。在此对其 Apache-2.0 开源贡献致谢——没有它们，本仓库无从谈起。

---

## 九、许可与归属

- **上游原创代码**：Apache-2.0，作者橙汁本色（`Chengzhibense`）—— 见 [LICENSE](LICENSE) / [NOTICE](NOTICE) / [UPSTREAM-README.md](UPSTREAM-README.md)
- **孤舟版增补 / 云朵版 / Fairy-DSH-compat 分支 / 本仓库增补**：同一许可
- **第三方依赖**：各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- **商标**：Fairy / DSH / DeepSeek / 《绝区零》相关名称与标识归各自权利人，本许可不授予相关权利 —— 见 [TRADEMARKS.md](TRADEMARKS.md)

---

## 十、更多文档

| 文件 | 内容 |
| --- | --- |
| [CONTRIBUTORS.md](CONTRIBUTORS.md) | 谁做了什么、归属边界 |
| [AGENTS.md](AGENTS.md) | 给 AI Agent 的安装指令、可装/不可装清单、故障判定表 |
| [docs/本地改动.md](docs/本地改动.md) | 相对上游改了什么、为什么 |
| [docs/仓库与上游.md](docs/仓库与上游.md) | fork 维护：合并上游更新、结构性冲突点 |
| [docs/DSH Desktop × Fairy 兼容性适配报告.pdf](<docs/DSH Desktop × Fairy 兼容性适配报告.pdf>) | 跨内核适配全记录 |

### 开发与构建

```powershell
node tools\run-tests.mjs            # 跑测试（每个文件 60s 超时）
node tools\bootstrap.mjs            # 依赖 → junction → 产物 mtime → 自检（幂等）
node tools\bootstrap.mjs --check   # 只体检
```

详见 [docs/测试与CI.md](docs/测试与CI.md)。

### 出问题了？

设置 → **Fairy** → 点「**开始自检**」会逐项告诉你卡在哪层。仍不行就点面板底部「**复制诊断信息**」直接贴进 Issue（不含任何聊天内容）。更细的故障判定表见 [AGENTS.md](AGENTS.md)。
