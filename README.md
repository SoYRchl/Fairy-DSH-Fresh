# Fairy-DSH 焕新 · 独立桌面应用 + Fairy 插件套件

> **把 Fairy（绝区零风格的 AI 助手界面）完整搬进 DeepSeek Harness，并且能双击运行、不占浏览器。**
>
> 本仓库由 **[SoYRchl](https://github.com/SoYRchl)** 维护，是 Apache-2.0 开源项目 **Fairy-DSH** 的下游整合分支：在原作者与上游整合分支的成果之上，做了 DSH 内核换代适配、独立 Electron 桌面壳、以及 TTS / STT 多引擎等增强。**当前为 alpha 阶段**，功能可用但仍在迭代。

| | |
| --- | --- |
| **当前版本** | `0.1.0-alpha.6`（独立版本线，已不再沿用上游 `v0.3.x`） |
| **最新发布** | [v0.1.0-alpha.6](https://github.com/SoYRchl/Fairy-DSH-Fresh/releases/latest) · 便携 zip + 安装包 + SHA256 |
| **实测内核** | `dsh 0.2.1-rc.2`（最新；`0.2.0-rc.2` 同样可用，见 §五） |
| **许可** | Apache-2.0（继承自上游） |

---

## 一、这是什么

一句话：**一个能双击启动的 Fairy 桌面客户端，同时它也是一套可单独安装的 DSH 插件。**

三件事同时成立：

1. **独立桌面应用** —— 自带 Electron 壳、托盘、启动动画和内核运行时（**`dsh 0.2.1-rc.2`**），解压即用，不依赖浏览器标签页。
2. **Fairy 插件套件** —— 视觉（HDD 主题 / 舞台 / 表情）、人设、朗读、语音输入、余额卡，拆成独立插件包，也可以只装进你自己的 DSH。
3. **跨内核兼容层** —— 用能力探测而不是判版本号，在 `dsh 0.1.x → 0.2.x` 的破坏性变更之间保持可用；升级内核后有一套契约测试点名失败行。

---

## 二、下载即用（推荐）

去 [Releases](https://github.com/SoYRchl/Fairy-DSH-Fresh/releases/latest) 下三件套之一：

| 产物 | 体积 | 适合 | 说明 |
| --- | --- | --- | --- |
| `Fairy-DSH-Fresh-<版本>-portable.zip` | 约 466 MB | **推荐** | 解压到任意可写目录，双击 `Fairy-DSH-Fresh.exe`。数据落在包内 `data/` |
| `Fairy-DSH-Fresh-<版本>-setup.exe` | 约 281 MB | 想进开始菜单 | NSIS 安装。装进 `Program Files` 后目录只读，数据自动改落 `%LOCALAPPDATA%\Fairy-DSH-Fresh` |
| `SHA256SUMS.txt` | — | 必看 | 下载后先校验完整性 |

**首启会做三件事**（都是自动的，别惊讶）：

- 重建 `node_modules` 里的 junction（zip 解压会丢链接）；
- 建 `<数据目录>/profiles/web` 指向内置插件目录（内核只认这个路径，缺了会退化成"零插件"）；
- 写入一份不含任何凭据的 `settings.yaml.imported`，并把 Fairy 人设预设装进 home。

> ⚠️ **安装态（setup.exe）为 P1**：装进 `Program Files` 后，插件通过 junction 回写 profile 会失败。要稳就用便携 zip。

### 用起来

1. 启动后等启动动画播完（或点右下角「跳过动画」）
2. 首次使用按引导填模型 / API Key（壳不内置任何凭据）
3. **设置 → Fairy → 打开「启用」**（视觉默认已开，人设预设按需开）
4. 想听声音：设置 → Fairy → 朗读设置 → 「开始自检」

**壳的行为**（都是有意设计）：

- **点关闭 = 隐藏到托盘**，后端继续跑；只有托盘菜单「退出」才真正停后端。
- 托盘右键：打开 / 隐藏 / 后端状态（显示端口）/ 重启后端 / **开机自启**（默认关）/ 退出。
- 右上角有常驻的最小化 / 最大化·还原 / 关闭三个按键。
- 单实例：重复双击会唤醒已有窗口，不会开第二个后端。
- 默认端口 **3090**，被占用会直接报错而不是悄悄换端口。

---

## 三、功能

### 视觉与人设（`dsh-fairy-visual`）

- HDD（H.D.D.）主题：夜间/日间切换、辉光、舞台、输入区接管、滚动与决策指针守卫
- Fairy 舞台与表情、mascot 缩放
- **设置页宿主**：Fairy 的所有设置都在「设置 → Fairy」这一页
- 人设预设：可设为新会话默认人格（语料完全沿用上游，未做改写）

### 朗读 TTS（`dsh-fairy-voice`）

**四路引擎，设置里即时切换、不用重启**，各自记住地址：

| id | 引擎 | 需要什么 | 备注 |
| --- | --- | --- | --- |
| `gpt-sovits` | GPT-SoVITS | 本机服务 `127.0.0.1:9880` + 参考音频 | **默认**，流式合成 |
| `moss-nano` | MOSS-TTS-Nano | 本机服务 `127.0.0.1:18083` + 同一份参考音频 | 无显卡也能跑，整句合成后出声 |
| `openai` | OpenAI 兼容云端 TTS | 填 baseURL / key / 模型 | 不出声时先查 key |
| `custom-http` | 自定义 HTTP 接口 | 自己提供 | 给折腾的人 |

- 参考音频各引擎共用，只配一次；默认 `~/.dsh/fairy-voice/reference/fairy_ref.wav`。
- **一台 TTS 都没装是正常状态**：面板会显示琥珀色「还没配置朗读服务」，Fairy 照常打字，只是不出声——不是包坏了。
- MOSS 服务端在 `tools/moss-tts-server/server.py`，安装说明见 [docs/install-moss.md](docs/install-moss.md)。

### 语音输入 STT（`dsh-fairy-voice`）

六路 provider，麦克风按钮挂在输入框左侧。**默认 `whisper-web`**——模型跑在你自己的浏览器里，零配置、不需要任何外部服务：

| id | 语义 | 跑在哪 |
| --- | --- | --- |
| `browser` | 系统 Web Speech API | 浏览器端 |
| `whisper-web` | 浏览器内本地 Whisper（transformers.js + WASM） | 浏览器端，**默认**；首次从 CDN 拉模型权重 |
| `openai` | OpenAI 兼容 `/audio/transcriptions` | 服务端转发 |
| `deepgram` | Deepgram `/v1/listen` | 服务端转发 |
| `azure` | Azure 快速听写 | 服务端转发 |
| `custom-http` | 自定义听写端点 | 服务端转发 |

> ⚠️ **STT 目前还没有设置界面**（TTS 有）。切 provider 要改 `~/.dsh/fairy-voice/runtime/config.json` 的 `stt.provider`，或 POST `/fairy-voice/config`。UI 在待办里。

### 余额卡（`dsh-balance-meter`）

- 三行：**余额** / **今日 token**（HDD 模式下叫「今日电量」）/ **今日估算**
- 官方 DeepSeek 模型按内置价目计；**非官方通道**只记 token、金额跳过，显示 `¥x.xx*` 并提示"含未定价模型"，避免编造金额
- 可在 bundle config `balancePricing.models` 里按模型手动定价
- 失败时给具体原因：未配置 / 密钥无效 / 账户欠费 / 无权限 / 请求过快 / 网络失败

### 悬浮球（`dsh-orb`，已打补丁）

- 默认外观换成 **Fairy 眼睛**（192×192 PNG，按视觉插件的 CSS 规格 1:1 生成），预设画廊首位加「Fairy」
- 修掉 Windows 把透明窗口悄悄移出 topmost 带导致的「球自己消失」：15 秒周期无条件重设置顶
- 补丁是幂等的 `tools/patch-dsh-orb.mjs`，挂在 `profiles/web` 的 postinstall，没装该包时静默跳过

---

## 四、只想要插件？（不装桌面壳）

如果你已经在用 DSH 桌面端，可以只把插件装进自己的 profile：

**让 Agent 装**（把下面这段丢给 DSH Agent）：

> 从 `https://github.com/SoYRchl/Fairy-DSH-Fresh` 这个仓库的本地克隆安装 `dsh-fairy-visual`、`dsh-fairy-voice`、`dsh-balance-meter` 到我的 web profile，**不要**装 `dsh-fairy-startup` 和 `dsh-browser-dock`。详见 AGENTS.md。

**命令行**：

```powershell
git clone https://github.com/SoYRchl/Fairy-DSH-Fresh.git
cd Fairy-DSH-Fresh
node tools\bootstrap.mjs          # 装依赖 + 补 junction + 对齐产物 mtime，幂等
dsh plugin --profile web add `
  .\fairy-visual\dsh-fairy-visual `
  .\fairy-voice\dsh-fairy-voice `
  .\balance-meter\dsh-balance-meter
```

> ⚠️ **资产直链不能写 `releases/latest/download/`** —— 本仓库**只发 prerelease**，GitHub 的 `/releases/latest` 只指向非预发布，那个前缀下的文件会 404。**必须带版本号**：
> ```
> https://github.com/SoYRchl/Fairy-DSH-Fresh/releases/download/v0.1.0-alpha.6/dsh-fairy-visual.tgz
> ```
> 也可以完全跳过网络：`.\pack.ps1` 本地打 tgz 到 `release/`。

要求：已装 DSH、Node.js ≥ 20、pnpm（装 DSH 时不自带，需 `npm i -g pnpm`）、能连 GitHub / npm。

**两个包默认不装，且不建议装**：

| 包 | 为什么不装 |
| --- | --- |
| `dsh-fairy-startup` | 每次加载清空你的会话选择并强制开新会话，会丢掉没结束的对话 |
| `dsh-browser-dock` | 会落盘控制 token 与页面截图，攻击面大 |

---

## 五、兼容性

本仓库用 **feature-detection（能力探测）** 而不是判版本号来跨两代内核：

- 选择器取并集而不是分支：会话容器同时匹配 `[data-slot="conversation"]` 与 `[data-slot="main.conversation"]`，输入框同时匹配 `textarea` 与 `[contenteditable][data-composer-input]`；
- 被改名/移除的服务不硬声明（硬声明会让 fiber 永久挂起），改用 `ctx.get("settingsScope")` 探测，拿不到就回落到同契约的 localStorage 实现，**保证启动**；
- 三个核心包（visual / voice / balance-meter）把 `@deepseek-ai/dsh-settings` 声明成**可选** peer 依赖，范围 `^0.1.0-rc.7 || ^0.1.1-rc.2 || ^0.1.2-alpha.2 || ^0.2.0-rc.1`：宿主没装这个包也照常加载，装了则按上面那条规则探测。

**口径要说清楚**：

| 项 | 事实 |
| --- | --- |
| 随包内核 | `dsh 0.2.1-rc.2`（壳内置） |
| 已实测可用 | `0.2.1-rc.2` 与 `0.2.0-rc.2`：五个插件 apply 全成功、页面渲染出 Fairy 视觉与设置面板、控制台零报错 |
| peer 声明范围 | `^0.2.0-rc.1 || ^0.2.1-rc.1`（即 `>=0.2.0-rc.1 <0.3.0`；声明为 optional） |
| 更老的 `0.1.x` | 上游设计基线；本仓库的双代兼容路径覆盖它，但不再作为验收目标 |
| 更新 | DSH 升级后**先跑一次根目录的 `verify.cmd`**；遇到问题请带上 `dsh --version` 开 Issue |

> ⚠️ **DSH 升级后先跑一次根目录的 `verify.cmd` 自检**：上游依赖官方 DOM 选择器与私有 slot 契约，升级后可能静默降级。本仓库的适配层只在已知变更点生效，**新出现的内核变更仍可能造成故障**。

---

## 六、开发与构建

```powershell
node tools\bootstrap.mjs            # 依赖 → junction → 产物 mtime → 自检（幂等）
node tools\bootstrap.mjs --check    # 只体检，会真报错
node tools\run-tests.mjs            # 全量契约测试（逐文件 spawn，单文件 60s 超时）
node tools\run-tests.mjs --tools-only   # 只跑本仓库自己的工具测试（快）
```

- 依赖要装**两处**：`profiles/web` **和** 各插件包自己的 `node_modules`；pnpm 11/12 不建 `link:` 链接，靠 `tools/restore-link-deps.mjs` 补 junction（幂等）。
- **禁止从 `src/` 重建 `lib/client.js`**：产物里含手工打进去的兼容层（`settingsNamespace` 内联、HDD 接管、首同步归一化等），`pnpm bundle` 会静默抹掉它并导致整页白屏。改客户端逻辑 = 对产物做字符串级补丁 + 把语义等价改动同步回 `src/`。
- 打包壳：`FAIRY_NODE=<node22> FAIRY_KERNEL_MODULES=<内核 node_modules> node tools/pack-shell.mjs`，详见 [shell/README.md](shell/README.md)。

**测试现状（诚实版）**：

| 口径 | 结果 |
| --- | --- |
| `--tools-only` | 36 pass / 0 fail |
| 本地全量 | 258 pass / 2 fail / 5 stale |
| CI（windows-latest，Node 22 + 24） | 250 pass / 7 fail / 5 stale |

- 那 **5 项 stale** 是上游测试因兼容改动失效，已登记在 `tools/tests/known-stale.mjs`，每项都带原因与消除办法。
- 本地 2 项红：`fairy-visual` 契约测试断言了一处已被有意改掉的调用写法；`browser-dock` 的 state-watch 用例。CI 上另有 `fairy-system/preflight` 6 项（本机通过）——都是待修项，不是"绿着但没人知道"。

---

## 七、血缘与归属

**本仓库不是原创项目。** 完整血缘：

- **原作者**：**橙汁本色**（[`Chengzhibense/Fairy-DSH`](https://github.com/Chengzhibense/Fairy-DSH)）—— Fairy 插件套件的全部原创代码（人设语料、HDD 视觉、布局、mascot、朗读逻辑），Apache-2.0。
- **直接上游**：**孤舟蓑笠**（[`Guzhou2002/Fairy-DSH-Optimized`](https://github.com/Guzhou2002/Fairy-DSH-Optimized)，v0.3.8）—— 本仓库的基线，提供可分发整合包、一键安装器、MOSS 第二朗读引擎与自检面板。
- **同源整合分支**：[`playinginzzz/Fairy-DSH-compat`](https://github.com/playinginzzz/Fairy-DSH-compat) —— 跨内核兼容提交的来源之一。
- **同源功能分支**：[`addsas222/Fairy-DSH-Exp`](https://github.com/addsas222/Fairy-DSH-Exp) —— TTS/STT provider 注册表的形状取自它，按接口重新实现，不引为依赖。
- **本仓库（SoYRchl）**：内核换代适配、兼容层与契约测试、独立 Electron 壳、TTS/STT 多引擎、余额计价修正、悬浮球外观与置顶修复、发布链（便携 zip / NSIS / SHA256）。

**同生态的另一套分发（无血缘，仅记录）**：[`FLKSSSSS/dsh-fairy-ui`](https://github.com/FLKSSSSS/dsh-fairy-ui)（v1.4.6）是**独立开发**的再整合包，形态是「改官方 DSH 桌面端 asar 主入口的插件包」，与本仓库的独立壳路线互斥 —— **同一台机器只装一套**。
⚠️ 该仓库**没有任何 LICENSE 文件、`package.json` 也没有 `license` 字段**（默认保留所有权利），所以我们**只参考它公开的做法、不复制它的代码**。详见 [CONTRIBUTORS.md](CONTRIBUTORS.md)。

**为什么要有这个下游**：上游 `Chengzhibense/Fairy-DSH` 自 2026-08-29 起没有新提交，**零 release、零 tag**；孤舟版停在 2026-09-14。而 DSH 内核在此期间连做了两代破坏性变更（`0.1.5 → 0.2.0`），上游本体已跟不上，社区里几个下游分支各自补丁。本仓库把这些补丁、独立应用形态和功能增强收在一处。

⚠️ 本仓库是**非官方**分支，不代表原作者、上游或 DeepSeek 官方立场，未获任何背书。问题请开 **[本仓库 Issues](https://github.com/SoYRchl/Fairy-DSH-Fresh/issues)**，不要打扰上游作者。

---

## 八、已知限制

- **会和别的改界面插件抢 DOM**：`beauticode`、`whale-widget`、`live2d-companion`、`liang-slider`、`ui-task-board`。撞车时先禁用一部分再启用 Fairy。
- **安装态（setup.exe）profile 回写会失败**（`Program Files` 只读），便携 zip 是推荐形态。
- **STT 没有设置 UI**，只能改配置文件或调 API。
- **窗口层验收只能真机做**：受限沙箱里启动会因 GPU 子进程崩溃循环起不来（`exit_code=-1073741819`），这是环境问题不是代码问题——排查时先确认实例是谁启的。
- **兼容层仍有未端到端验证项**：回退演练、设置暂存同步、中间版本未逐一实测、未做长时间压测；hero 投影 / composer 坞拖拽 / 实际出声 未进自动化。
- **每次打开朗读面板会探测 TTS 服务**（3 秒硬上限），服务没起时会等满 3 秒才显示未配置。
- **设置存在渲染进程的 localStorage 里**（0.2.x 内核已无 `settings.register`，插件按设计降级）。功能正常、重启仍在，但**不会写进 profile 配置**，换 profile / 重装后不跟随。改法见 [docs/内核升级-0.2.1.md](docs/内核升级-0.2.1.md) §6.1。
- 版本线处于 alpha。设置面板的版本号由 `tools/sync-version.mjs` 从 `VERSION` 同步（有契约测试钉住），**以 `VERSION` 文件与 Release 为准**。

---

## 九、Contributors

| 角色 | 作者 | 仓库 |
| --- | --- | --- |
| **维护者 / Owner** | **SoYRchl** | [SoYRchl/Fairy-DSH-Fresh](https://github.com/SoYRchl/Fairy-DSH-Fresh) |
| **原作者（原创代码）** | **橙汁本色** | [Chengzhibense/Fairy-DSH](https://github.com/Chengzhibense/Fairy-DSH) |
| **直接上游（基线）** | **孤舟蓑笠** | [Guzhou2002/Fairy-DSH-Optimized](https://github.com/Guzhou2002/Fairy-DSH-Optimized) |
| **同源整合分支** | **playinginzzz** | [playinginzzz/Fairy-DSH-compat](https://github.com/playinginzzz/Fairy-DSH-compat) |
| **同源功能分支** | **addsas222** | [addsas222/Fairy-DSH-Exp](https://github.com/addsas222/Fairy-DSH-Exp) |

> 上游作者与各整合分支作者**均未参与**本仓库的兼容改动与功能增强；其提交记录不属于本仓库 Contributors。在此对其 Apache-2.0 开源贡献致谢——没有它们，本仓库无从谈起。

---

## 十、许可与归属

- **上游原创代码**：Apache-2.0，作者橙汁本色（`Chengzhibense`）—— 见 [LICENSE](LICENSE) / [NOTICE](NOTICE) / [UPSTREAM-README.md](UPSTREAM-README.md)
- **孤舟版增补 / 云朵版 / Fairy-DSH-compat 分支 / 本仓库增补**：同一许可
- **第三方依赖**：各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- **商标**：Fairy / DSH / DeepSeek / 《绝区零》相关名称与标识归各自权利人，本许可不授予相关权利 —— 见 [TRADEMARKS.md](TRADEMARKS.md)

---

## 十一、更多文档

| 文件 | 内容 |
| --- | --- |
| [CONTRIBUTORS.md](CONTRIBUTORS.md) | 谁做了什么、归属边界 |
| [AGENTS.md](AGENTS.md) | 给 AI Agent 的安装指令、可装/不可装清单、故障判定表 |
| [docs/验证报告.md](docs/验证报告.md) | 隔离 profile 实测：宿主/客户端 apply、DOM 指标、未覆盖项 |
| [docs/本地改动.md](docs/本地改动.md) | 孤舟版相对上游改了什么、为什么 |
| [docs/改动清单.md](docs/改动清单.md) | 相对上游的文件分类（Apache-2.0 §4(b) 举证材料） |
| [docs/内核升级-0.2.1.md](docs/内核升级-0.2.1.md) | 0.2.0-rc.2 → 0.2.1-rc.2 升级全记录（差异、验证、未采纳项） |
| [docs/测试与CI.md](docs/测试与CI.md) | 测试入口与 CI 设计 |
| [docs/compat/换代风险登记.md](docs/compat/换代风险登记.md) | DSH 换代会踩的坑与动作清单 |
| [docs/compat/运行时契约.md](docs/compat/运行时契约.md) | 跨内核运行时契约的适用性判定 |
| [docs/风险-DSH换代.md](docs/风险-DSH换代.md) | 内核升级风险总览 |
| [docs/形态对比.md](docs/形态对比.md) | DSH 插件形态 vs 独立 Electron 形态 |
| [docs/install-moss.md](docs/install-moss.md) | MOSS-TTS-Nano 安装任务书 |
| [docs/DSH Desktop × Fairy 兼容性适配报告.pdf](<docs/DSH Desktop × Fairy 兼容性适配报告.pdf>) | 跨内核适配全记录 |
| [shell/README.md](shell/README.md) | Electron 壳的布局、打包与验收纪律 |

### 出问题了？

设置 → **Fairy** → 点「**开始自检**」会逐项告诉你卡在哪层。仍不行就点面板底部「**复制诊断信息**」直接贴进 Issue（不含任何聊天内容）。更细的故障判定表见 [AGENTS.md](AGENTS.md)。

卸载：双击 `uninstall.cmd`（**必须**和 `uninstall.ps1` 放同一目录）。它会备份配置、卸插件、把「新会话默认预设」还原（不还原的话新会话会点不动），并把你该保留的数据路径打给你。
