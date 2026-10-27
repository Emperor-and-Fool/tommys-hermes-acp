# 更新日志

**Rina Hermes ACP** 的所有重要变更均记录于此。

本文档为**简体中文**版本。默认语言（英文）见 [CHANGELOG.md](CHANGELOG.md)。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] - 2026-10-27

面向代理工作时的对话显示，以及历史附加所携带消息的角色筛选。

### 新增

- **历史附加栏上的角色筛选**：用户、助手、思考、工具四个复选框决定哪些消息可以打勾。用户与助手默认开启；思考与工具需手动开启，因为它们携带的文字最多、答案最少。关闭某个角色会同时取消该角色已打的勾
- 筛选旁的**重新渲染**：筛选在卡片构建时生效，因此需要一次显式重新渲染，才能把改动应用到屏幕上已有的对话
- 引导消息在重放时显示为原句并带有**引导**标记，而不再显示它以发送时的包裹文本

### 变更

- **代理书写时，思考与工具卡片保持展开**，并在回合结束时收起到五行与三行的高度，而不再从第一个片段起就被限制
- 回合结束时停在对话底部，此时最后一次 Markdown 渲染与卡片收起都已稳定
- 消息 ID 查询按原句匹配引导消息，历史片段仍能精确指向具体消息
- 每个 webview 资源地址都带有文件修改时间，重新构建的脚本不会因地址不变而命中缓存

### 修复

- 历史卡片没有高度上限：以完整长度渲染，按钮点击后毫无变化。现在采用与思考卡片相同的五行上限，并且只在内容溢出时显示「显示更多」
- 回合结束时的输入模式被设置两次——先依据了尚未更新的标志

### 仓库

- 本地 ACP 补丁纳入 `packaging/hermes-patches` 版本管理
- 移除死代码：无用的 finished-tool 字形测试，以及写入卡片状态而非面板状态的赋值

## [1.0.0] - 2026-10-27

基线版本：`src/` 按运行时拆分，会话记忆、审批与引导。

### 新增

- **会话记忆**：在输入框选择另一段对话，在临时标签页中只读查看，最多勾选十五条消息，作为引用块附加在问题之前。暂存的选择归属于暂存它的标签页
- **审批模式**：每个待处理权限卡片上的 手动 · 智能 · 关闭，通过 `hermes config set approvals.mode` 写入当前配置
- **引导**：输入框有文字时，停止按钮变为引导，文字进入当前运行；引导自身的回复行不会混入助手的回答

### 变更

- `src/` 按运行时划分 —— `host/`、`pane/`、`shared/`，webview 由 esbuild 打包
- webview 协议的两个方向都是 `src/shared/webview.ts` 中的强类型联合
- 代理工作期间，模型与会话记忆选择器互换位置

### 移除

- 旧的当前标签页上下文附加及其消息、设置和测试
- 拆分前的两个单体文件 `chat.js.old` 与 `HermesChatProvider.ts.old`

## [0.4.0] - 2026-10-21

分叉自建名称后的首个构建，基于上游 0.3.2。

### 新增

- 将 Hermes 会话作为标签页接管，并把它们的历史重放进面板
- 侧边栏之外的编辑器面板形态
- 图片粘贴与仅图片发送；浅色主题可读性与字号胶囊
- 标题为「Tommys Dev Chat」的活动栏容器与鲸鱼图标

### 变更

- 更名为 Tommys Hermes ACP：名称、GPL-3.0-or-later、链接与 issue 模板
- 设置命名空间更正为 `tommys.*`

### 修复

- 每次切换都会重新建立会话；修复了输入行与卡片标签

## [0.3.2] - 2026-06-22

### 新增

- **Hermes 初始化提示**：若发送后 25 秒内仍无输出，状态栏会提示 Hermes 仍在初始化（首次对话可能需 1–3 分钟）

### 修复

- **连接卡在「连接中…」/ 连接错误**：流式输出在 prompting 开始时即接受；被替换或取消的 prompt 不再导致客户端阻塞
- **跨会话流式串扰**：`sessionId` 与当前会话不一致的 session update 会被忽略
- **内容解析**：助手与思考块改用 `extractTextFromContentBlock`，更稳健地从 ACP 内容块提取文本

## [0.3.1] - 2026-06-22

### 新增

- **环境检测**（视图标题栏 **环境** 菜单）：分层 Hermes 发现（L0–L5）、版本验证；聊天工具栏显示 **百分比进度** 与可展开的步骤详情
- **ACP 就绪检测**：找到 Hermes 后执行 `hermes acp --check`；失败时尝试 `pip install agent-client-protocol==0.9.0` 并重新检测
- **环境配置**（扳手菜单）：将 Hermes 写入插件设置或系统 PATH；已配置时仍可重新配置
- **智能检测触发**：连接时若插件或系统 PATH 中已有可用 Hermes（含 ACP 快速校验），则跳过全量检测
- **取消检测**：关闭进度条可终止进行中的环境扫描

### 修复

- **Cursor — 配置**：**更多 → 配置** 现打开 VS Code Settings UI 并定位到本扩展（不再尝试打开在 Cursor 中常无可见效果的 `settings.json`）
- 修复 Windows 用户 PATH 写入时因 JSON/PowerShell 转义导致的路径损坏
- 检测完成后的摘要与详情标题正确显示；已完成步骤显示成功图标而非 loading

## [0.3.0] - 2026-06-21

### 新增

- **会话记忆附带**：Agent 重置（切换模型或会话）后，可将上轮消息作为参考文本附带到下一条发送 —— 支持最近 2 条、最近 10 条、全部或自选，含预览与 Token 估算
- **`hermes.contextAttachVisibility` 设置**：控制记忆选择框显示时机 —— `onNewSession`（默认）/ `always` / `never`
- **FAQ 弹窗**（更多 → FAQ）：涵盖会话重置机制、模型/会话切换、Profile 切换、模型列表、更新与 BUG 提交
- **会话重置分隔线**：聊天 UI 标注从本地恢复的消息（仅供查看，不会带入 Agent 上下文）
- **切换会话确认**：生成回复过程中切换 Tab 时弹出确认提示
- `contextAttach` 模块单元测试

### 修复

- 模型列表在 ACP 重新拉取为空时，回退到已缓存的选项

## [0.2.6] - 2026-06-21

### 新增

- 未配置 `hermes.agents` 时，通过 `hermes profile list` 自动发现 Hermes profile
- 按 profile 隔离的本地会话历史与模型偏好存储（`profileStorage`）
- Hermes profile CLI 参数、ACP 模型目录解析与分组展示（`acpModelCatalog`、`hermesProfile`、`profileDiscovery`）

### 修复

- 选择「默认」Profile 时显式传递 `--profile default`，不再以无 profile 参数启动 `hermes acp`（此前会跟随 Hermes 全局激活 profile，导致默认模型显示错误）
- 模型列表改为**仅通过 ACP** 获取：优先调用 Hermes `model.options`，回退到会话 `models.availableModels`；不再读取 `config.yaml`
- 模型下拉按供应商分组显示；当前选中模型优先对齐 ACP 返回的 profile 默认模型
- 重连与重试时保留聊天 UI 中的当前 profile，不再仅依赖工作区设置

## [0.2.5] - 2026-06-21

### 新增

- **聊天内权限审批**：在 WebView 中展示权限请求卡片（替代 `showWarningMessage`），支持批准/拒绝及会话级/永久选项；详情默认折叠，超出三行可展开
- **审批历史持久化**：权限卡片写入会话消息记录，刷新或切换会话后可只读恢复
- **MCP 配置转发**：从 `~/.cursor/mcp.json` 及工作区 `.cursor` / `.vscode` 的 `mcp.json` 读取 MCP 服务器，并在 `session/new` 时传给 Hermes
- **流式推送智能滚动**：默认跟随到底部；用户手动滚动后暂停，5 秒无操作且仍在推送时恢复
- **TOKEN 圆环占比**：圆环中心显示当前 token 使用百分比
- 权限选项 i18n（`permissionOptions.ts`）及 `mcpConfig` / `permissionOptions` 单元测试
- 集成测试脚本 `scripts/test-session-new.mjs`

### 修复

- 审批或工具调用后，后续助手回复不再错误追加到旧气泡，而是开启新消息段
- `allow_session` 选项不再误显示为「始终允许」（`optionId` 优先于 `kind` 映射）

## [0.2.2] - 2026-06-20

### 变更

- 扩展与仓库由 **hermes-ai-chat** 重命名为 **rina-hermes-acp**。
- 改进 `hermes.agents` 配置校验与类型定义（`HermesAgentConfig`）。

## [0.2.0] - 2026-06-13

### 新增

- 侧边栏聊天面板，支持流式 Markdown 渲染（marked、highlight.js、DOMPurify）。
- 多会话 Tab 与本地历史持久化。
- 聊天工具栏模型选择下拉（ACP `configOptions` 与 Hermes 原生 `session/set_model`）。
- 通过 `hermes.agents` 切换命名 Agent（path、profile、cwd）。
- 思考过程与工具调用显示开关（默认关闭）。
- 双语界面：英文与简体中文（跟随 VS Code 显示语言）。
- `@file` 引用、代码块插入、选中内容发送到聊天、集成终端镜像。
- 权限确认、连接重试、Token 用量显示与聊天内诊断日志。

### 修复

- 流式光标使用字面量字符 `▎`，修复 Unicode 转义显示异常。
- 日志面板复制/清空；stderr 过滤以减少无关输出。
- 多轮 Code Review（CR #2–#5）中的稳定性与体验修复。

### 变更

- 面向市场的图标、README 与 VSIX 打包（bundle 中排除 icon.svg）。
- 显示名称定为 **Rina Hermes ACP**（此前受 Marketplace 命名限制经历 **Hermes AI Chat** 等调整）。

[1.1.0]: https://github.com/Emperor-and-Fool/tommys-hermes-acp/releases/tag/v1.1.0
[1.0.0]: https://github.com/Emperor-and-Fool/tommys-hermes-acp/releases/tag/v1.0.0
[0.4.0]: https://github.com/Emperor-and-Fool/tommys-hermes-acp/commits/main
[0.3.2]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.2...v0.2.5
[0.2.2]: https://github.com/jove-rina/rina-hermes-acp/compare/v0.2.0...v0.2.2
[0.2.0]: https://github.com/jove-rina/rina-hermes-acp/releases/tag/v0.2.0
