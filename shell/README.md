# shell/ — Fairy-DSH-Fresh 独立桌面壳（②-C）

Electron 桌面壳：双击即用、无黑窗口、关窗即停后端。按「借壳不借包」红线
（`docs/02` §3）在对不明来源安装包 755 行 `main.js` 做**人工审计后重写**——
只借架构思路（生命周期、圆角实现、最大化状态机、启动门控），零二进制、
零配置复用。

## 布局（打包后，`tools/pack-shell.mjs` 产出）

```
<root>/Fairy-DSH-Fresh.exe          官方 electron.exe 改名
<root>/resources/app/               本目录的壳文件（package.json main.js …）
<root>/resources/app/media/         启动视频（用户批准复用参考包媒体资产，D-052）
<root>/resources/runtime/node.exe   官方 Node 22（后端专用，Electron 内置
                                    Node 24 解析不了 rc.2 插件，见 04 §1）
<root>/resources/kernel/node_modules/   @deepseek-ai/dsh 0.2.0-rc.2
<root>/resources/repo/              整合仓快照（去掉 5 条 link: junction）
<root>/data/                        便携数据（home / 日志 / 窗口状态）
```

数据目录规则：包根可写 → 用 `<root>/data`（便携）；不可写（装进 Program
Files）→ 自动落 `%LOCALAPPDATA%\Fairy-DSH-Fresh`。zip 解压会丢 junction，
首启由 `tools/restore-link-deps.mjs --apply` + `bless-build-mtimes.mjs --apply`
自动重建（幂等，每次启动都跑，代价秒级）。

首启还有两件自动事（都是 D-052 的教训）：
1. **`<home>/profiles/web` → 仓 profile 的 junction**——内核解析活动 profile
   只认 `<home>/profiles/<名>`，全新 home 不建它就会被内核自举成**裸
   profile**（零 bundle，用户看到的就是「插件全没启用」）；
2. **`settings.yaml.imported` 通用种子**——只压欢迎通知 + HDD 视觉默认开
   （`fairy-visual.enabled: true`），不含任何凭据；凭据首启走引导页。

## 文件

| 文件 | 作用 |
| --- | --- |
| `main.js` | 壳主进程：恢复 → 起后端 → 等 303+cookie 就绪 → 开窗；单实例、渲染进程一次自愈、外链走系统浏览器、token 永不落日志 |
| `preload.js` | contextBridge：窗控 4 件事 + 跳过动画；渲染进程 sandbox:true |
| `startup-animation.cjs` | 启动门控（②-C 是纯 CSS 版；视频导入/ffmpeg 留给③期，接口已留） |
| `startup.html/css/js` | Fairy 眼睛呼吸动画，点击即跳过 |
| `verify/observe.mjs` | 真机验收 harness（冷启×3 GPU 0 崩、关窗停后端、RSS 10min 稳态） |
| `pnpm-workspace.yaml` | 仅声明 `onlyBuiltDependencies: [electron]`（允许其 postinstall 下载官方 dist） |

## 本机开发 / 打包

```bash
# 1. 依赖（electron dist 缺失时手动补）
cd shell && corepack pnpm install --no-frozen-lockfile
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js

# 2. 打包（FAIRY_NODE / FAIRY_KERNEL_MODULES 由本机环境提供，不入仓）
FAIRY_NODE=<node22 的 node.exe> FAIRY_KERNEL_MODULES=<内核 node_modules 前缀> \
  node tools/pack-shell.mjs                 # 便携 zip
NSIS_EXE=<makensis.exe> 同上 …              # 追加 NSIS 安装包
# 产物在 <repo>/../Fairy-DSH-Dist/，含 SHA256SUMS.txt
```

## 验收纪律

- ★★ 涉及窗口的验证**一律沙箱外跑**（D-049：沙箱内 orb helper GPU 子进程必崩）。
  harness 用法见 `verify/observe.mjs` 头注释；入口用 explorer 代跑 bat。
- 打包机在跑实例时不要打包（内核文件可能被占用）。
- 本仓公开（D-028）：壳链路全部源文件**纯 ASCII**（`tools/tests/shell-hygiene.test.js`
  强制），用户可见中文一律 `\uXXXX` / HTML 实体；本机路径禁止入仓。
