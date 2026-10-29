import { LocaleStrings } from '../../../shared/i18n';

export const zhCn: LocaleStrings = {
    selectCodeFirst: '请先选中一些代码。',
    allowHermesRun: '允许 Hermes 执行：{0}',
    allow: '允许',
    deny: '拒绝',
    waitForResponse: '请等待当前回复完成后再切换模型。',
    failedSwitchModel: '切换模型失败：{0}',
    savedModelUnavailable: '已保存的模型「{0}」不可用。',
    modelPreferenceSaved: '模型偏好已本地保存。请在设置中配置 Hermes 模型或 tommys.models。',
    hermesNotConnected: 'Hermes 未连接。',
    couldNotOpenFile: '无法打开文件：{0}',
    hermesNotConnectedConnecting: 'Hermes 未连接，正在连接…',
    fileAccessDenied: '无法访问该文件',
    fileReadError: '无法读取文件',
    newChat: '新对话',
    noActiveTabHint: '没有打开的对话。使用“打开标签页”以打开已关闭的对话或开始新的对话。',
    sessionNotFound: '此对话没有关联的 Hermes 会话（{0}）。请从已关闭的对话中重新打开。',
    sessionNotWritable: '此对话未连接到 Hermes 会话，因此未发送任何内容。请从已关闭的对话中重新打开。',
    profileExcluded: '“{0}”是主代理正在使用的配置档。请为此面板选择另一个。',
    modelSwitchIncomplete: '模型未能切换到 {0}，对话保持原样。',
    openTab: '打开标签页',
    chooseChat: '选择对话',
    closedSessionsHeader: '已关闭的会话',
    noClosedSessions: '没有已关闭的会话',
    defaultAgent: '默认',
    statusStartingAcp: '正在加载 Profile 与会话…',
    statusHermesThinking: 'Hermes 正在思考…',
    statusHermesInitializing: 'Hermes 正在初始化（首次对话可能需 1–3 分钟）…',
    statusProcessError: '进程错误：{0}',
    statusProcessExited: '进程已退出（code: {0}, signal: {1}）',
    statusConnectionFailed: '连接失败：{0}',
    statusNewSessionFailed: '新建会话失败：{0}',
    detectEnvironmentProgress: '正在检测 Hermes 环境…',
    detectEnvironmentProgressPrefix: '环境检测：{0}',
    detectEnvironmentStepCompleteShort: '完成',
    detectEnvironmentCancelled: '环境检测已取消',
    detectEnvironmentNotFound: '未找到 Hermes 可执行文件。请先安装 Hermes Agent，或在设置中手动配置 tommys.path。',
    detectEnvironmentPickExecutable: '选择 Hermes 可执行文件',
    detectEnvironmentConfigureTitle: '如何配置 Hermes 路径？',
    detectEnvironmentConfigurePlugin: '配置到插件',
    detectEnvironmentConfigurePluginDesc: '写入 tommys.path，仅对本插件生效并立即重连',
    detectEnvironmentConfigureSystem: '配置到系统环境',
    detectEnvironmentConfigureSystemDesc: '写入环境变量 {0}（{1}）',
    detectEnvironmentSystemVarTargetWindows: 'Windows 用户级 Path 环境变量',
    detectEnvironmentSystemVarTargetUnix: 'Linux/macOS Shell 配置文件中的 PATH',
    detectEnvironmentConfigureSystemConfirm: '将把 {0} 加入环境变量 {1}（{2}）。此操作会修改系统环境，是否继续？',
    detectEnvironmentConfigureSystemConfirmYes: '确认配置',
    detectEnvironmentConfigureSystemConfirmNo: '取消',
    detectEnvironmentPluginConfigured: '已将 Hermes 路径写入插件设置：{0}',
    detectEnvironmentSystemConfigured: '已将 {0} 加入环境变量 {1}（{2}）。请重启 Cursor/VS Code 或新开终端后生效。',
    detectEnvironmentSystemAlreadyConfigured: '环境变量 {0} 已包含 {1}，无需修改。',
    detectEnvironmentSystemNeedsRestart: '重启 Cursor/VS Code',
    detectEnvironmentBroken: '找到了 Hermes 文件，但无法运行（hermes --version 失败）。请尝试重新安装 Hermes Agent。',
    detectEnvironmentSourceConfig: '插件配置',
    detectEnvironmentSourcePathLookup: 'PATH 查找',
    detectEnvironmentSourceKnownPath: '已知安装路径',
    detectEnvironmentSourcePip: 'pip 安装',
    detectEnvironmentSourcePythonImport: 'Python 包',
    detectEnvironmentSourceHermesHome: 'HERMES_HOME',
    detectEnvironmentCandidateVerified: '已验证',
    detectEnvironmentCandidateUnverified: '未验证',
    detectEnvironmentDetectTitle: '环境检测中....',
    detectEnvironmentCompleteTitle: '环境检测完成',
    detectEnvironmentStepConfig: 'L0 · 插件配置 (tommys.path)',
    detectEnvironmentStepPath: 'L1 · PATH 查找 (where / command -v)',
    detectEnvironmentStepKnownPath: 'L2 · 已知安装路径',
    detectEnvironmentStepPip: 'L3 · pip 安装 (pip show hermes-agent)',
    detectEnvironmentStepPython: 'L4 · Python 包 (import hermes_cli)',
    detectEnvironmentStepHermesHome: 'L5 · HERMES_HOME 目录',
    detectEnvironmentStepVerify: 'V1 · 运行 hermes --version 验证',
    detectEnvironmentStepAcpCheck: 'ACP · 运行 hermes acp --check',
    detectEnvironmentStepAcpInstall: 'ACP · 安装 agent-client-protocol',
    detectEnvironmentStepAcpOk: 'Hermes ACP check OK',
    detectEnvironmentStepAcpFail: 'ACP 不可用',
    detectEnvironmentStepAcpInstallOk: 'ACP 依赖安装成功',
    detectEnvironmentStepAcpInstallFail: 'ACP 依赖安装失败',
    detectEnvironmentStepSummary: '检测完成',
    detectEnvironmentStepNotFound: '未找到',
    detectEnvironmentStepSkipped: '已跳过',
    detectEnvironmentStepFoundCount: '找到 {0} 个',
    detectEnvironmentStepVerifyCount: '已验证 {0}/{1}',
    detectEnvironmentSummaryReady: 'Hermes 环境已就绪，可正常使用。',
    detectEnvironmentSummaryBroken: '找到 Hermes 文件但无法运行，请重新安装 Hermes Agent。',
    detectEnvironmentSummaryNotFound: '未找到 Hermes，请先安装 Hermes Agent。',
    detectEnvironmentSummaryInstall: '未检测到 Hermes，请先安装 Hermes Agent。',
    detectEnvironmentSummaryConfigureViaMenu: '已找到 Hermes，但尚未写入插件配置。请点击工具栏扳手图标中的「环境配置」。',
    detectEnvironmentSummaryAcpBroken: 'Hermes 已安装，但 ACP 依赖缺失。检测将尝试自动安装 agent-client-protocol。',
    detectEnvironmentSummaryAcpManual: 'ACP 依赖安装后仍无法通过检测，请在终端执行 hermes acp 进行排查。',
    detectEnvironmentViewDetails: '查看详情',
    detectEnvironmentHideDetails: '收起详情',
    viewChatTitle: '聊天',
    detectEnvironmentAlreadyConfigured: 'Hermes 环境已就绪，无需配置。',
    detectEnvironmentRunFirst: '请先执行「环境检测」。',
    detectEnvironmentClose: '关闭检测面板',

    configureEnvironmentTitle: '环境配置',
    configureEnvironmentPathLabel: 'Hermes 路径',
    configureEnvironmentPathPlaceholder: '选择或检测 Hermes 可执行文件路径',
    configureEnvironmentBrowse: '选择',
    configureEnvironmentDetect: '检测',
    configureEnvironmentDetecting: '正在检测 Hermes 环境…',
    configureEnvironmentCandidatesTitle: '检测到的 Hermes 环境',
    configureEnvironmentNoCandidates: '未检测到可用的 Hermes 环境',
    configureEnvironmentSave: '保存',
    configureEnvironmentCancel: '取消',
    configureEnvironmentBrowseTitle: '选择 Hermes 可执行文件或安装目录',
    configureEnvironmentInvalidPath: '无效路径：请选择可执行的 Hermes 文件',
    configureEnvironmentSaveFailed: '保存失败：{0}',
    configureEnvironmentSystemVarHint: '将修改环境变量 {0} · {1}',
    configureEnvironmentOpenDirectory: '打开目录',
    configureEnvironmentClearPath: '清空路径',

    connectionStatus: '连接状态',
    statusDisconnected: '未连接',
    statusConnecting: '连接中…',
    statusReady: '就绪',
    statusThinking: '思考中…',
    statusThinkingProvider: '{provider} 已接入',
    loadingMessageChunks: '消息块：{0}',
    statusError: '错误',
    connectionLostRetrying: '与 Hermes 的连接已断开，正在重新连接…',
    retry: '重新连接',
    switchProfile: '切换 Hermes Profile',
    profile: 'Profile',
    profiles: 'Profiles',
    switchModel: '切换模型',
    model: '模型',
    models: '模型列表',
    modelPlaceholder: '选择模型',
    newChatBtn: '+ 新建',
    moreOptions: '更多选项',
    menuAbout: '关于',
    menuSettings: '配置',
    menuHelp: '帮助',
    menuFaq: 'FAQ',
    menuLogs: '日志',

    connectingTitle: '正在连接 Hermes Agent…',
    connectingHint: '请确认已安装 Hermes 且可正常访问',
    readyPlaceholder: '就绪。开始新的对话吧。',
    connectionError: '连接错误。',
    retryConnect: '重新连接',
    detectEnvironment: '检测环境',

    inputPlaceholder: '与 {profile} 对话（使用 @ 引用文件）',
    resizeHandle: '拖拽调整输入框高度',
    filePicker: '文件选择器',
    searchChat: '搜索当前对话…',
    searchPrev: '上一个匹配 (↑)',
    searchNext: '下一个匹配 (↓)',
    clearChat: '清空当前对话',
    clearInput: '清空输入框',
    copySession: '复制当前会话',
    quickActions: '快捷操作',
    quickActionsExpand: '展开快捷操作',
    quickActionsCollapse: '收起快捷操作',
    tokenUsage: '输入 TOKEN 占比',
    send: '发送',
    stop: '停止',
    cancelResponse: '停止回复',

    hermesLogs: 'Hermes 日志',
    copy: '复制',
    copyCode: '复制代码',
    replyAction: '引用',
    replyActionBlocked: '无法引用',
    replySelectionLost: '选中内容已丢失——请重新选择。',
    replyStreamingBlocked: '选中内容包含正在写入的消息，引用未采集。请在回复结束后重新选择。',
    replyTitle: '引用 {count} 条消息',
    replyTruncated: '已在 6,000 字符处截断',
    imageMissing: '图片不在聊天中——修复将在更新中提供',
    clear: '清空',
    noLogs: '（暂无日志）',
    aboutTitle: '关于 Tommys Hermes ACP',
    helpTitle: '帮助 — 如何启动 ACP',
    faqTitle: '常见问题',

    aboutVersion: '版本',
    aboutDescription: '在 VS Code 侧边栏直接与本地 <strong>Hermes Agent</strong> 对话。插件通过 ACP 协议自动启动 <code>hermes acp</code> 子进程，支持流式回复、多会话 Tab、模型切换与终端集成。',
    aboutFeatureTabs: '多会话 Tab 管理历史对话',
    aboutFeaturePickers: 'Profile / Model 选择器',
    aboutFeatureInsert: '代码块/表格复制与插入（对话框/编辑器）',
    aboutFeatureTools: '工具调用与思考过程（可配置显示）',
    repository: '仓库',

    helpHtml: `
            <h3>ACP 是什么？</h3>
            <p>本插件通过 <strong>Agent Client Protocol (ACP)</strong> 与本地 Hermes 通信。插件会自动启动 <code>hermes acp</code> 子进程，无需手动开终端。</p>

            <h3>1. 安装 Hermes</h3>
            <pre><code>curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash</code></pre>
            <p class="dim">安装后通常位于 <code>~/.hermes/hermes-agent/venv/bin/hermes</code>，或已在 PATH 中。</p>

            <h3>2. 验证 ACP 可启动</h3>
            <p>在终端手动测试（成功后会等待 stdin 输入，Ctrl+C 退出）：</p>
            <pre><code># 默认 profile
hermes acp

# 指定 profile
hermes --profile &lt;name&gt; acp</code></pre>

            <h3>3. 插件配置（Settings）</h3>
            <ul>
                <li><code>tommys.path</code> — Hermes 可执行文件路径（留空则自动检测）</li>
                <li><code>tommys.profile</code> — 对应 <code>--profile</code> 参数</li>
                <li><code>tommys.cwd</code> — Agent 工作目录（默认工作区根目录）</li>
            </ul>
            <p>点击视图标题栏 <strong>更多 → 配置</strong> 可打开 Settings，修改后<strong>实时生效</strong>（连接相关项会自动重连）。</p>

            <h3>4. 连接失败排查</h3>
            <ul>
                <li>确认 <code>hermes acp</code> 在终端能正常启动</li>
                <li>在 Settings 中设置正确的 <code>tommys.path</code></li>
                <li>点击视图标题栏 <strong>更多 → 日志</strong> 查看 ERROR/WARNING 日志</li>
            </ul>`,

    faqHtml: `
            <h3>1. 切换模型 / 切换会话，为什么会「重置」？</h3>
            <p><strong>聊天记录没有丢失</strong>，是 Hermes Agent 的<strong>内存上下文</strong>被清空了。</p>
            <p>插件通过 ACP 与 Hermes 通信时，底层 Agent 同一时刻只维护一份对话上下文。以下操作都会触发 <code>newSession</code>，清空 Agent 记忆：</p>
            <ul>
                <li><strong>切换模型</strong> — 需为新型号重建 ACP 会话</li>
                <li><strong>切换 Tab（会话）</strong> — 各 Tab 可能使用不同模型；切回时需把 Agent 绑定到该 Tab 的模型与状态</li>
            </ul>
            <p>因此会出现 <strong>「以上为历史会话记忆，不会带入新会话」</strong> 分隔线：上方消息从本地恢复，<strong>仅供浏览</strong>；Agent 并不记得这些内容。分隔线下方的新消息，<strong>不会自动带上方的对话</strong>作为上下文。</p>
            <p>这是 Hermes ACP 的架构限制，<strong>不是 bug</strong>。</p>
            <p><strong>如何续上之前的讨论？</strong> 使用输入区的时钟选择器，它会列出所有会话（含当前会话）。选择一条会话，在打开的只读视图中最多勾选 15 条消息，然后点击「附带」。仅 <strong>用户与助手</strong> 消息可勾选。</p>
            <ul>
                <li>选择器始终可用；在你发送自己的消息之前不会发送任何内容</li>
                <li>附带的片段显示在你的消息上方，并随该消息一并发给 Agent</li>
            </ul>
            <p class="dim"><strong>建议：</strong>需连续上下文时尽量在同一 Tab 内完成；切换后若要延续话题，使用记忆附带；重要结论及时复制或导出会话。</p>

            <h3>2. 切换会话时，模型会怎样？</h3>
            <p>每个 Tab <strong>独立记住</strong>所选模型。在某 Tab 切换模型后，会写入该会话元数据；切回时自动恢复。</p>
            <ul>
                <li><strong>新 Tab</strong>：若尚未单独选过模型，继承当前 Profile 下最近一次使用的模型</li>
                <li><strong>切换 Tab</strong>：恢复该 Tab 的模型，并重置 Agent 上下文（见上文）</li>
                <li><strong>模型已不可用</strong>：弹出「已保存的模型「xxx」不可用」，需手动重选</li>
                <li><strong>正在生成回复时</strong>：不可切换模型；若其他 Tab 在生成，切换时会先中断该 Tab 的回复</li>
            </ul>

            <h3>3. 切换 Profile 会引起什么变化？</h3>
            <p>Profile 切换等于<strong>重连 Hermes 子进程</strong>（类似 <code>hermes --profile &lt;name&gt; acp</code> 重新启动）。</p>
            <ul>
                <li><strong>会话列表换一套</strong> — 每个 Profile / <code>tommys.agents</code> 命名 Agent 有独立本地存储，Tab 历史、活跃 Tab、模型偏好互不共享</li>
                <li><strong>模型列表刷新</strong> — 来自新 Profile 下 Hermes 暴露的可用模型，可能与旧 Profile 完全不同</li>
                <li><strong>聊天内容</strong> — 按新 Profile 下的活跃会话重新加载</li>
                <li><strong>Settings 变更</strong> — 修改 <code>tommys.profile</code>、<code>tommys.path</code> 等连接项也会自动重连，效果类似切换 Profile</li>
            </ul>

            <h3>4. 模型列表为什么不全？</h3>
            <p>列表展示的是<strong>当前 Hermes Profile 实际可用</strong>的模型，不是「全网所有模型」。插件通过 ACP 从 Hermes 获取（<code>session/new</code> 的 <code>models.availableModels</code> 或 <code>model.options</code>）。</p>
            <p><strong>常见原因：</strong></p>
            <ul>
                <li>Profile 未配置对应 Provider 或 API Key</li>
                <li>该 Profile 只启用了部分模型</li>
                <li>Hermes 版本或 ACP 未返回完整列表</li>
                <li>Agent 未连接或未返回列表 — 可在 Settings 配置备用列表 <code>tommys.models</code></li>
            </ul>
            <p class="dim">排查：用相同 Profile 在终端运行 <code>hermes acp</code> 确认 Hermes 侧是否正常；检查 Hermes 配置文件。</p>

            <h3>5. 会持续更新吗？</h3>
            <p><strong>会。</strong> 本扩展通过 VS Code 扩展市场发布；顶部 <strong>「…」→ 检查更新</strong> 可触发市场检查并定位到本扩展。</p>
            <p>Hermes Agent 与扩展<strong>独立演进</strong>：扩展跟进 ACP、模型选择、Profile 等；底层能力（模型、工具等）取决于 Hermes 本身。可关注 <a href="#" data-url="https://github.com/Emperor-and-Fool/tommys-hermes-acp">GitHub 仓库</a> 的 Release 与 Issue。</p>

            <h3>6. BUG 怎么反馈？</h3>
            <p>请到 GitHub 提交 Issue：<br><a href="#" data-url="https://github.com/Emperor-and-Fool/tommys-hermes-acp/issues">github.com/jove-rina/tommys-hermes-acp/issues</a></p>
            <p><strong>建议包含：</strong></p>
            <ul>
                <li>VS Code 版本（帮助 → 关于）</li>
                <li>扩展版本（「…」→ 关于）</li>
                <li>Hermes 版本（终端 <code>hermes --version</code>）</li>
                <li>复现步骤、预期 vs 实际</li>
                <li>相关日志（「…」→ 日志，复制 ERROR / WARNING 行）</li>
            </ul>

            <h3>7. 期望的新功能怎么告诉我？</h3>
            <p>同样通过 <a href="#" data-url="https://github.com/Emperor-and-Fool/tommys-hermes-acp/issues">GitHub Issues</a> 提交，标题标明 <code>[Feature Request]</code>。</p>
            <p>请说明：<strong>使用场景</strong>、<strong>期望行为</strong>、是否接受替代方案。描述越具体，越便于排期。</p>`,

    roleYou: '你',
    roleHermes: 'Hermes',
    roleThought: '思考',
    roleTool: '工具',
    roleMessage: '消息',
    permissionTitle: '需要授权',
    permissionCancelled: '已取消',
    permissionAllowOnce: '允许一次',
    permissionAllowAlways: '始终允许',
    permissionAllowSession: '本会话允许',
    permissionRejectOnce: '拒绝一次',
    permissionRejectAlways: '始终拒绝',
    permissionDeny: '拒绝',
    permissionExpand: '展开',
    permissionCollapse: '收起',
    permissionShowMore: '展开更多',
    permissionCardCollapse: '收起详情',
    permissionCardExpand: '展开详情',
    permissionSelected: '已选择：{0}',
    insert: '插入',
    emptyFile: '（空文件）',
    noMatchingFiles: '没有匹配的文件',
    searchingFiles: '搜索文件中…',
    configureAgents: '请在 Settings 中配置 tommys.agents',
    noModels: '无可用模型 — 请检查 Hermes profile 或 tommys.models',
    modelFromAgent: '来自 Hermes profile 的模型',
    modelLocalPreference: '本地模型偏好（Settings 回退）',
    tokenUsageLabel: '输入 TOKEN: {0} / {1} ({2}%)',
    copied: '已复制',
    clickToInsert: '点击插入到输入框',
    insertToInput: '插入到对话框',
    insertToEditor: '插入到编辑器',
    insertMenu: '插入',
    noActiveEditor: '请先打开一个编辑器',
    selectMessages: '选择',
    forwardToOtherPane: '转发到 {0}',
    forwardedFromHeader: '{0}@{1}',
    otherPaneNotLive: '另一个面板未打开',
    peerCardDeliver: '递送',
    peerCardDismiss: '忽略',
    peerCardDelivered: '已递送给代理',
    peerCardDismissed: '已忽略',
    peerCardHeader: '{0}@{1}',
    multiSelectAll: '全选',
    multiSelectDeselectAll: '取消全选',
    multiSelectDelete: '删除',
    multiSelectCopy: '复制',
    multiSelectExport: '导出',
    multiSelectExit: '退出',
    multiSelectCount: '已选 {0} 项',
    fileLinkTitle: '点击打开 · 悬停预览',
    tabClose: '关闭',
    tabContextSid: 'SID',
    tabContextExport: '导出',
    tabContextCopy: '复制',
    tabContextRename: '重命名',
    tabContextClose: '关闭',
    tabContextCloseOthers: '关闭其他',
    tabContextCloseLeft: '关闭左侧',
    tabContextCloseRight: '关闭右侧',
    tabContextCloseAll: '全部关闭',
    tabContextPin: '固定',
    tabContextUnpin: '释放',
    copySid: '复制会话 ID',
    sessionExportSessionId: '会话ID：{0}',
    sessionExportModel: '模型：{0}',
    sessionExportDate: '日期：{0}',
    sessionRendering: '正在渲染消息…',
    localHistoryDivider: '以上为历史会话记忆，不会带入新会话',
    localHistoryDividerTitle: '历史会话记忆不会自动带入 Agent 新会话上下文',
    localHistoryBadge: '本地',

    switchSessionPromptTitle: 'Hermes 正在回复',
    switchSessionPromptBody: '切换会话将中断当前回复。请选择继续等待，或确认切换。',
    switchSessionConfirm: '切换',
    switchSessionStopNow: '停止并切换',
    undeliveredNotice: '上一条消息未送达——Hermes 没有记录。',
    undeliveredRestore: '恢复',
    undeliveredDiscard: '丢弃',
    switchSessionQueuedBody: '本次运行结束后切换。立即停止以马上切换。',
    switchSessionQueuedTitle: '切换已排队',
    switchSessionStay: '停留',

    historyCardHeader: '来自对话：{0}',
    historyCardCount: '{0} 条消息',
    historyCardSpan: '范围',
    historyCardAnchor: '定位片段',
    historyAttachCount: '附带（{0}/{1}）',
    historyViewerCancel: '取消',
    historyViewerLoading: '正在载入对话…',
    historyViewerEmpty: '这段对话没有消息。',
    historyViewerFetchFailed: '无法从 Hermes 读取这段对话。',
    historyRoleUser: '用户',
    historyRoleAssistant: '助手',
    historyRoleThought: '思考',
    historyRoleTool: '工具',
    historyRoleReload: '重新渲染',
    historyPickerPlaceholder: '选择会话记忆',
    historyPickerHeader: '会话记忆',
    historyPickerEmpty: '暂无其他会话',
    historyPickerHidden: '已隐藏',
    historyChipSummary: '{0} 条消息，来自 {1}',
    historyChipPending: '正在查找消息 ID',
    historyChipClear: '移除附带的记忆',
    approvalModeManual: '手动',
    approvalModeSmart: '智能',
    approvalModeOff: '关闭',
    approvalModeTooltip: '该审批模式作用于整个 profile，包括命令行中的 Hermes。关闭会完全跳过智能审批。',
    approvalModeFailed: '无法更改审批模式。',
    steer: '引导',
    steerHint: '作为引导发送到正在运行的一轮中',
};
