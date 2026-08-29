# DSH 工程审计记录（2026-08-28）

本轮沿启动器、Web profile、Fairy runtime、Visual、Voice、Browser Dock、Balance Meter 与验证链追踪了实际调用关系。修改仅落在有可验证收益的路径。

## 已落地

- 普通消息在运行时分类后直接跳过 WORLD CORE 与 Fairy cognition 检索；游戏知识问题继续使用正式查询路由。
- 语气资产增加线上句感底线，并由 JS/Python 编译器共同消费；训练、评估、生成索引与线上人格资产通过 `ASSET-BOUNDARIES.json` 分层。
- 增加覆盖输入、分类、上下文、知识检索、工具边界和最终输出审查的 golden pipeline。
- Balance Meter 在连续远端失败时复用既有不可用状态，避免每个轮询周期创建新状态并触发无意义渲染。
- Browser Dock 的文件系统事件通知按微任务合并，降低原子替换产生的重复 SSE 写入；状态内容和通知时序语义不变。

## 保持不变的边界

- 未修改产品入口、设置默认值、UI 所有权、视觉动画、音频协议和公开路由。
- 未引入新的常驻线程、后台轮询或大型依赖。
- 未删除训练资料；仅明确其不应直接进入线上人格上下文。

## 验证证据

`fairy-system/check.sh` 全部通过：静态预检、accepted baseline、live verify、Fairy Python 测试、runtime 27 项、Visual 119 项、Voice 55 项、Browser Dock 11 项、Startup 3 项、系统测试 33 项。
