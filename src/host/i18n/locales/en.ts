import { LocaleStrings } from '../../../shared/i18n';

export const en: LocaleStrings = {
    selectCodeFirst: 'Select some code first.',
    allow: 'Allow',
    deny: 'Deny',
    waitForResponse: 'Wait for the current response before changing model.',
    failedSwitchModel: 'Failed to switch model: {0}',
    savedModelUnavailable: 'Saved model "{0}" is no longer available.',
    modelPreferenceSaved: 'Model preference saved locally. Configure Hermes models or tommys.models in Settings.',
    hermesNotConnected: 'Hermes is not connected.',
    couldNotOpenFile: 'Could not open file: {0}',
    hermesNotConnectedConnecting: 'Hermes is not connected. Connecting...',
    fileAccessDenied: 'Cannot access this file',
    fileReadError: 'Cannot read file',
    newChat: 'New Chat',
    noActiveTabHint: 'No chat is open. Use Open to pick a session, or start a new one.',
    sessionNotFound: 'This chat has no Hermes session ({0}). Reopen it from the closed chats.',
    sessionResumeFailed: 'Hermes would not resume this chat (session {0}): {1}',
    searchOpen: 'Search this conversation',
    searchClose: 'Close search',
    jumpToTop: 'Back to the start',
    jumpToNow: 'Jump to now',
    jumpToTopHint: 'Scroll to the first message in this conversation.',
    jumpToNowHint: 'Follow the conversation again from the newest message.',
    sessionReplayFailed: 'This conversation could not be loaded from Hermes. Reopen it from Open, or reload the window.',
    sessionNotWritable: 'This chat is not connected to a Hermes session, so nothing was sent. Reopen it from the closed chats.',
    profileExcluded: '"{0}" is the profile {1} is using. Pick another one for this pane.',
    holderPrimaryHere: "this window's primary agent",
    holderSecondantHere: "this window's secondant agent",
    holderPrimaryElsewhere: 'a primary agent in another window',
    holderSecondantElsewhere: 'a secondant agent in another window',
    profileMissing: '"{0}" is not a profile Hermes has any more. Pick another one; nothing was moved or deleted.',
    modelSwitchIncomplete: 'The model did not change to {0}. The chat was left as it was.',
    openTab: 'Open',
    chooseChat: 'Closed Sessions',
    closedSessionsHeader: 'Closed sessions',
    permissionModeBtn: 'Permission Mode',
    permissionModeBtnTemplate: 'Permissions: {mode}',
    permissionModeMan: 'Man',
    permissionModeSmart: 'Smart',
    permissionModeNone: 'None',
    permissionModeAll: 'ALL',
    permissionModeBtnTooltip: 'To allow session permissions mode must be manual',
    permissionModeTitle: 'Permission mode',
    permissionModeClose: 'Close',
    permissionOpenTooltip: 'DANGER! Everything runs, deny rules cleared. Edits: free everywhere. '
        + 'Sensitive files always ask.',
    permissionEditHint: 'Edits ask here because of the button, the permission root or a protected file. '
        + 'Change the button or the root; it applies from the next run.',
    permissionRootLabel: 'Permission root',
    permissionRootTitle: 'Permission root',
    permissionRootBody: 'This workspace opens {folders} folders side by side. Hermes can work in one of them. '
        + 'Choose the folder {profile} works in; outside it, edits ask for permission.',
    permissionRootNew: 'New',
    permissionRootMissing: 'missing',
    permissionRootMoveRefused: 'Hermes could not move this session to {folder}. It stays in {previous}.',
    permissionRootRootRemoved: '{folder} left the workspace. This session still works there until you pick another root.',
    permissionRootLastRemoved: 'Last root removed: projects are no longer reachable from this window. '
        + 'Their sessions stay untagged, available only through the Hermes TUI or by reopening the folder.',
    appliesNextRun: 'Applies from the next run.',
    noFolderOpen: 'Open a folder or workspace to start',
    permissionOpenConfirm: 'Press again: approvals off and approvals.deny cleared. The deny patterns are kept in a JSON backup.',
    permissionRestoreLabel: 'Restore deny rules',
    noClosedSessions: 'No closed sessions',
    defaultAgent: 'Default',
    statusStartingAcp: 'Loading profile & session...',
    statusHermesThinking: 'Hermes is thinking...',
    statusHermesInitializing: 'Hermes is initializing (first reply may take 1–3 min)...',
    statusProcessError: 'Process error: {0}',
    statusProcessExited: 'Process exited (code: {0}, signal: {1})',
    statusConnectionFailed: 'Connection failed: {0}',
    statusNewSessionFailed: 'New session failed: {0}',
    detectEnvironmentProgress: 'Detecting Hermes environment...',
    detectEnvironmentProgressPrefix: 'Environment: {0}',
    detectEnvironmentCancelled: 'Environment detection cancelled',
    detectEnvironmentNotFound: 'Hermes executable not found. Install Hermes Agent or set tommys.path manually in Settings.',
    detectEnvironmentPickExecutable: 'Select Hermes executable',
    detectEnvironmentConfigureSystem: 'Configure for system',
    detectEnvironmentConfigureSystemDesc: 'Write to environment variable {0} ({1})',
    detectEnvironmentSystemVarTargetWindows: 'Windows user-level Path',
    detectEnvironmentSystemVarTargetUnix: 'PATH in Linux/macOS shell profile',
    detectEnvironmentConfigureSystemConfirm: 'Add {0} to environment variable {1} ({2}). This modifies system environment. Continue?',
    detectEnvironmentConfigureSystemConfirmYes: 'Confirm',
    detectEnvironmentConfigureSystemConfirmNo: 'Cancel',
    detectEnvironmentPluginConfigured: 'Hermes path saved to extension settings: {0}',
    detectEnvironmentSystemConfigured: 'Added {0} to environment variable {1} ({2}). Restart Cursor/VS Code or open a new terminal.',
    detectEnvironmentSystemAlreadyConfigured: 'Environment variable {0} already includes {1}.',
    detectEnvironmentSystemNeedsRestart: 'Restart Cursor/VS Code',
    detectEnvironmentBroken: 'Hermes files were found but could not run (hermes --version failed). Try reinstalling Hermes Agent.',
    detectEnvironmentSourceConfig: 'Extension setting',
    detectEnvironmentSourcePathLookup: 'PATH lookup',
    detectEnvironmentSourceKnownPath: 'Known install path',
    detectEnvironmentSourcePip: 'pip install',
    detectEnvironmentSourcePythonImport: 'Python package',
    detectEnvironmentSourceHermesHome: 'HERMES_HOME',
    detectEnvironmentCandidateVerified: 'verified',
    detectEnvironmentCandidateUnverified: 'unverified',
    detectEnvironmentDetectTitle: 'Detecting environment....',
    detectEnvironmentCompleteTitle: 'Environment detection complete',
    detectEnvironmentStepConfig: 'L0 · Extension setting (tommys.path)',
    detectEnvironmentStepPath: 'L1 · PATH lookup (where / command -v)',
    detectEnvironmentStepKnownPath: 'L2 · Known install paths',
    detectEnvironmentStepPip: 'L3 · pip install (pip show hermes-agent)',
    detectEnvironmentStepPython: 'L4 · Python package (import hermes_cli)',
    detectEnvironmentStepHermesHome: 'L5 · HERMES_HOME directory',
    detectEnvironmentStepVerify: 'V1 · Run hermes --version',
    detectEnvironmentStepAcpCheck: 'ACP · Run hermes acp --check',
    detectEnvironmentStepAcpInstall: 'ACP · Install agent-client-protocol',
    detectEnvironmentStepAcpOk: 'Hermes ACP check OK',
    detectEnvironmentStepAcpFail: 'ACP unavailable',
    detectEnvironmentStepAcpInstallOk: 'ACP dependency installed',
    detectEnvironmentStepAcpInstallFail: 'ACP dependency install failed',
    detectEnvironmentStepSummary: 'Detection complete',
    detectEnvironmentStepNotFound: 'Not found',
    detectEnvironmentStepSkipped: 'Skipped',
    detectEnvironmentStepFoundCount: 'Found {0}',
    detectEnvironmentStepVerifyCount: 'Verified {0}/{1}',
    detectEnvironmentSummaryReady: 'Hermes environment is ready.',
    detectEnvironmentSummaryBroken: 'Hermes files were found but could not run. Try reinstalling Hermes Agent.',
    detectEnvironmentSummaryNotFound: 'Hermes not found. Please install Hermes Agent first.',
    detectEnvironmentSummaryInstall: 'Hermes not found. Please install Hermes Agent first.',
    detectEnvironmentSummaryConfigureViaMenu: 'Hermes was found but tommys.path is not set. Open the wrench menu and choose Environment configuration.',
    detectEnvironmentSummaryAcpBroken: 'Hermes is installed but ACP dependencies are missing. Detection will try installing agent-client-protocol.',
    detectEnvironmentSummaryAcpManual: 'ACP still fails after installing dependencies. Run hermes acp in a terminal to troubleshoot.',
    detectEnvironmentViewDetails: 'View details',
    detectEnvironmentHideDetails: 'Hide details',
    detectEnvironmentClose: 'Close detection panel',

    configureEnvironmentTitle: 'Environment configuration',
    configureEnvironmentPathLabel: 'Hermes path',
    configureEnvironmentPathPlaceholder: 'Select or detect the Hermes executable path',
    configureEnvironmentBrowse: 'Browse',
    configureEnvironmentDetect: 'Detect',
    configureEnvironmentCandidatesTitle: 'Detected Hermes environments',
    configureEnvironmentNoCandidates: 'No usable Hermes environment was detected',
    configureEnvironmentSave: 'Save',
    configureEnvironmentCancel: 'Cancel',
    configureEnvironmentBrowseTitle: 'Select Hermes executable or install directory',
    configureEnvironmentInvalidPath: 'Invalid path: select an executable Hermes file',
    configureEnvironmentSaveFailed: 'Save failed: {0}',
    configureEnvironmentSystemVarHint: 'Modifies environment variable {0} · {1}',
    configureEnvironmentOpenDirectory: 'Open folder',
    configureEnvironmentClearPath: 'Clear path',

    connectionStatus: 'Connection status',
    statusDisconnected: 'Disconnected',
    statusConnecting: 'Connecting...',
    statusReady: 'Ready',
    statusThinking: 'Thinking...',
    statusThinkingProvider: '{provider} engaged',
    loadingMessageChunks: 'Message chunks: {0}',
    statusError: 'Error',
    connectionLostRetrying: 'Connection to Hermes lost. Reconnecting…',
    retry: 'Retry',
    switchProfile: 'Switch Hermes profile',
    profile: 'Profile',
    profiles: 'Profiles',
    switchModel: 'Switch model',
    model: 'Model',
    models: 'Models',
    modelPlaceholder: 'Select model',

    readyPlaceholder: 'Ready. Start a new conversation.',
    connectionError: 'Connection error.',
    retryConnect: 'Reconnect',
    detectEnvironment: 'Detect environment',

    inputPlaceholder: 'Chat with {profile} (use @ to reference a file)',
    resizeHandle: 'Drag to resize input area',
    filePicker: 'File picker',
    searchChat: 'Search current conversation…',
    searchPrev: 'Previous match (↑)',
    searchNext: 'Next match (↓)',
    clearInput: 'Clear input',
    copySession: 'Copy current session',
    quickActions: 'Quick actions',
    quickActionsExpand: 'Expand quick actions',
    quickActionsCollapse: 'Collapse quick actions',
    tokenUsage: 'Input token usage',
    send: 'Send',
    stop: 'Stop',
    cancelResponse: 'Stop response',

    hermesLogs: 'Hermes Logs',
    copy: 'Copy',
    copyCode: 'Copy code',
    replyAction: 'Reply',
    replyActionBlocked: 'Reply unavailable',
    replySelectionLost: 'The selection was lost before the quote was taken — select again.',
    replyStreamingBlocked: 'The selection touched the message still being written, so the quote was not captured. Select again once the turn ends.',
    replyTitle: 'Replying to {count} message(s)',
    replyTruncated: 'truncated at 6,000 characters',
    imageMissing: 'image outside chat — fix will arrive in updates',
    clear: 'Clear',
    noLogs: '(no logs yet)',
    aboutTitle: 'About Tommys Hermes ACP',
    helpTitle: 'Help — How to start ACP',
    faqTitle: 'FAQ',

    aboutVersion: 'Version',
    aboutDescription: 'Chat with the local <strong>Hermes Agent</strong> directly in the VS Code sidebar. The extension starts a <code>hermes acp</code> subprocess via the ACP protocol, with streaming replies, multi-session tabs, model switching, and terminal integration.',
    aboutFeatureTabs: 'Multi-session tab management',
    aboutFeaturePickers: 'Profile / Model selectors',
    aboutFeatureInsert: 'Copy/insert code blocks and tables (chat input or editor)',
    aboutFeatureTools: 'Tool calls and thinking process (configurable)',
    repository: 'Repository',

    helpHtml: `
            <h3>What is ACP?</h3>
            <p>This extension talks to the local Hermes agent via the <strong>Agent Client Protocol (ACP)</strong>. It automatically starts a <code>hermes acp</code> subprocess — no manual terminal needed.</p>

            <h3>1. Install Hermes</h3>
            <pre><code>curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash</code></pre>
            <p class="dim">After install, Hermes is usually at <code>~/.hermes/hermes-agent/venv/bin/hermes</code>, or already on your PATH.</p>

            <h3>2. Verify ACP starts</h3>
            <p>Test manually in a terminal (on success it waits for stdin; press Ctrl+C to exit):</p>
            <pre><code># default profile
hermes acp

# named profile
hermes --profile &lt;name&gt; acp</code></pre>

            <h3>3. Extension settings</h3>
            <ul>
                <li><code>tommys.path</code> — path to the Hermes executable (empty = auto-detect)</li>
                <li><code>tommys.profile</code> — maps to <code>--profile</code></li>
            </ul>
            <p>Open <strong>More → Settings</strong> from the view title bar; connection-related changes <strong>take effect immediately</strong> (reconnects automatically).</p>

            <h3>4. Troubleshooting connection</h3>
            <ul>
                <li>Confirm <code>hermes acp</code> starts in a terminal</li>
                <li>Set the correct <code>tommys.path</code> in Settings</li>
                <li>Open <strong>More → Logs</strong> from the view title bar to inspect ERROR/WARNING logs</li>
            </ul>`,

    faqHtml: `
            <h3>1. Why does switching model/session "reset" the conversation?</h3>
            <p><strong>Your chat history is not lost</strong> — only the Hermes Agent's <strong>in-memory context</strong> is cleared.</p>
            <p>Over ACP, the underlying agent maintains one conversation context at a time. These actions trigger <code>newSession</code> and clear agent memory:</p>
            <ul>
                <li><strong>Switching model</strong> — requires a new ACP session for the new model</li>
                <li><strong>Switching tabs (sessions)</strong> — each tab may use a different model; switching back rebinds the agent to that tab's model and state</li>
            </ul>
            <p>You will see the <strong>"Prior session memory above — not carried into the new session"</strong> divider: messages above are restored from disk for <strong>viewing only</strong>; the agent does not remember them. New messages below the divider <strong>do not automatically include</strong> the conversation above as context.</p>
            <p>This is an architectural limitation of Hermes ACP, <strong>not a bug</strong>.</p>
            <p><strong>How to continue a prior discussion?</strong> Use the clock picker in the composer: it lists every session, this one included. Pick one, tick up to 15 messages in the read-only viewer that opens, and press Attach. Only <strong>user and assistant</strong> messages can be ticked.</p>
            <ul>
                <li>The picker is always there; nothing is sent until you send your own message</li>
                <li>The attached slice is shown above your message and goes to the agent with it</li>
            </ul>
            <p class="dim"><strong>Tip:</strong> stay in one tab for continuous context; use memory attach after switching; copy or export important conclusions.</p>

            <h3>2. What happens to the model when I switch sessions?</h3>
            <p>Each tab <strong>remembers its own</strong> model choice. After you switch model in a tab, it is saved to that session's metadata and restored when you return.</p>
            <ul>
                <li><strong>New tab</strong>: if no model was chosen yet, inherits the most recently used model under the current Profile</li>
                <li><strong>Switch tab</strong>: restores that tab's model and resets agent context (see above)</li>
                <li><strong>Model no longer available</strong>: warning "Saved model … is no longer available" — pick a new one manually</li>
                <li><strong>While generating</strong>: cannot switch model; switching tabs may interrupt an in-flight reply on another tab</li>
            </ul>

            <h3>3. What changes when I switch Profile?</h3>
            <p>Switching Profile <strong>reconnects the Hermes subprocess</strong> (like restarting <code>hermes --profile &lt;name&gt; acp</code>).</p>
            <ul>
                <li><strong>Different session list</strong> — each Profile has separate local storage; tab history, active tab, and model preferences do not carry over</li>
                <li><strong>Model list refreshes</strong> — from models exposed by Hermes under the new Profile; may differ completely</li>
                <li><strong>Chat content</strong> — reloads the active session under the new Profile</li>
                <li><strong>Settings changes</strong> — editing <code>tommys.profile</code>, <code>tommys.path</code>, etc. also reconnects, similar to switching Profile</li>
            </ul>

            <h3>4. Why isn't the model list complete?</h3>
            <p>The list shows models <strong>actually available under the current Hermes Profile</strong>, not every model on the internet. The extension fetches them via ACP (<code>models.availableModels</code> from <code>session/new</code>, or <code>model.options</code>).</p>
            <p><strong>Common reasons:</strong></p>
            <ul>
                <li>Provider or API key not configured in the Profile</li>
                <li>Profile only enables a subset of models</li>
                <li>Hermes version or ACP did not return the full list</li>
                <li>Agent not connected or returned no list — configure fallback <code>tommys.models</code> in Settings</li>
            </ul>
            <p class="dim">Check: run <code>hermes acp</code> in a terminal with the same Profile; review Hermes config files.</p>

            <h3>5. Will this extension keep getting updates?</h3>
            <p><strong>Yes.</strong> Published on the VS Code Marketplace; use <strong>More → Check for Updates</strong> to check and jump to this extension.</p>
            <p>Hermes Agent and this extension <strong>evolve independently</strong>: the extension tracks ACP, model selection, Profile support, etc.; underlying capabilities depend on Hermes itself. Watch <a href="#" data-url="https://github.com/Emperor-and-Fool/tommys-hermes-acp">Releases and Issues on GitHub</a>.</p>

            <h3>6. How do I report a bug?</h3>
            <p>Open an Issue on GitHub:<br><a href="#" data-url="https://github.com/Emperor-and-Fool/tommys-hermes-acp/issues">github.com/jove-rina/tommys-hermes-acp/issues</a></p>
            <p><strong>Please include:</strong></p>
            <ul>
                <li>VS Code version (Help → About)</li>
                <li>Extension version (More → About)</li>
                <li>Hermes version (<code>hermes --version</code> in terminal)</li>
                <li>Steps to reproduce, expected vs actual behavior</li>
                <li>Relevant logs (More → Logs, copy ERROR / WARNING lines)</li>
            </ul>

            <h3>7. How do I suggest a new feature?</h3>
            <p>Same channel: <a href="#" data-url="https://github.com/Emperor-and-Fool/tommys-hermes-acp/issues">GitHub Issues</a>, with <code>[Feature Request]</code> in the title.</p>
            <p>Describe the <strong>use case</strong>, <strong>expected behavior</strong>, and whether alternatives are acceptable. The more specific, the easier to prioritize.</p>`,

    roleYou: 'You',
    roleHermes: 'Hermes',
    roleThought: 'Thought',
    roleTool: 'Tool',
    roleMessage: 'Message',
    permissionTitle: 'Permission required',
    permissionTimedOut: 'No answer after {0} seconds, so the request was cancelled.',
    permissionCancelled: 'Cancelled',
    permissionAllowOnce: 'Allow once',
    permissionAllowAlways: 'Always allow',
    permissionAllowSession: 'Allow for session',
    permissionRejectOnce: 'Reject once',
    permissionRejectAlways: 'Always deny',
    permissionDeny: 'Deny',
    permissionCollapse: 'Collapse',
    permissionShowMore: 'Show more',
    permissionCardCollapse: 'Collapse details',
    permissionCardExpand: 'Expand details',
    permissionSelected: 'Selected: {0}',
    insert: 'Insert',
    emptyFile: '(empty file)',
    noMatchingFiles: 'No matching files',
    searchingFiles: 'Searching files…',
    noHermesProfiles: 'No Hermes profiles found — check tommys.path',
    noModels: 'No models — check Hermes profile or tommys.models',
    modelFromAgent: 'Model from Hermes profile',
    modelLocalPreference: 'Local model preference (Settings fallback)',
    tokenUsageLabel: 'Input TOKEN: {0} / {1} ({2}%)',
    copied: 'Copied',
    insertToInput: 'Insert into chat input',
    insertToEditor: 'Insert into editor',
    insertMenu: 'Insert',
    noActiveEditor: 'Open an editor first',
    selectMessages: 'Select',
    forwardToOtherPane: 'Forward to {0}',
    otherPaneNotLive: 'The other pane is not open',
    peerCardDeliver: 'Deliver',
    peerCardDismiss: 'Dismiss',
    peerCardDelivered: 'Delivered to agent',
    peerCardDismissed: 'Dismissed',
    peerCardExpired: 'Expired',
    peerForwardCancelled: 'Forward from {0} — cancelled',
    peerForwardExpired: 'Forward from {0} — expired',
    peerCardHeader: '{0}@{1}',
    multiSelectAll: 'Select all',
    multiSelectDeselectAll: 'Deselect all',
    multiSelectDelete: 'Delete',
    multiSelectCopy: 'Copy',
    multiSelectExport: 'Export',
    multiSelectExit: 'Exit',
    multiSelectCount: '{0} selected',
    fileLinkTitle: 'Click to open · hover to preview',
    tabClose: 'Close',
    tabContextSid: 'SID',
    tabContextExport: 'Export',
    tabContextCopy: 'Copy',
    tabContextRename: 'Rename',
    tabContextClose: 'Close',
    tabContextCloseOthers: 'Close Others',
    tabContextCloseLeft: 'Close to the Left',
    tabContextCloseRight: 'Close to the Right',
    tabContextCloseAll: 'Close All',
    createProject: 'Create Project',
    tabContextMoveProject: 'Move to project',
    tabContextRenameProject: 'Rename project',
    tabContextDeleteProject: 'Delete project',
    tabContextMoveWorkspace: 'Move to workspace',
    tabContextNoProject: 'No project',
    tabContextSticky: 'Make It Sticky',
    tabContextUnstick: 'Drop',
    copySid: 'Copy session ID',
    sessionExportSessionId: 'Session ID: {0}',
    sessionExportModel: 'Model: {0}',
    sessionExportDate: 'Date: {0}',
    sessionRendering: 'Rendering messages…',

    switchSessionPromptTitle: 'Hermes is responding',
    switchSessionPromptBody: 'Switching sessions will interrupt the current reply. Wait for it to finish, or confirm to switch.',
    switchSessionConfirm: 'Switch',
    switchSessionStopNow: 'Stop & switch',
    undeliveredNotice: 'Your last message was not delivered — Hermes has no record of it.',
    undeliveredRestore: 'Restore',
    undeliveredDiscard: 'Discard',
    switchSessionQueuedBody: 'Switching when this run ends. Stop it to switch now.',
    switchSessionQueuedTitle: 'Switch queued',
    switchSessionStay: 'Stay',

    historyCardHeader: 'From conversation: {0}',
    historyCardCount: '{0} messages',
    historyCardSpan: 'Span',
    historyCardAnchor: 'Anchor quote',
    historyAttachCount: 'Attach ({0}/{1})',
    historyViewerCancel: 'Cancel',
    historyViewerLoading: 'Loading conversation…',
    historyViewerEmpty: 'This conversation has no messages.',
    historyViewerFetchFailed: 'Could not read this conversation from Hermes.',
    historyRoleUser: 'User',
    historyRoleAssistant: 'Assistant',
    historyRoleThought: 'Thought',
    historyRoleTool: 'Tool',
    historyRoleReload: 'Re-render',
    historyPickerPlaceholder: 'Select session memory',
    historyPickerHeader: 'Session memory',
    historyPickerEmpty: 'No other sessions yet',
    historyPickerHidden: 'hidden',
    historyChipSummary: '{0} messages from {1}',
    historyChipPending: 'looking up message ids',
    historyChipClear: 'Remove attached memory',
    approvalModeManual: 'Manual',
    approvalModeSmart: 'Smart',
    approvalModeOff: 'None',

    approvalModeManualTip: 'Commands and edits ask first.',
    approvalModeSmartTip: 'Commands: Hermes judges, risky ones ask. Edits: free inside the permission '
        + 'root, ask outside.',
    approvalModeNoneTip: 'Commands run, except your deny rules. Edits: free inside the permission '
        + 'root, ask outside.',
    approvalModeSensitiveTip: 'Sensitive files (.git, .ssh, .env, keys, agent instruction files) '
        + 'always ask.',
    approvalModeFailed: 'Could not change the approval mode.',
    steer: 'Steer',
    steerHint: 'Send this as guidance into the running turn',
    approvalNoteLabel: 'Approval',

    notesMirrorTitle: 'Where should the folder \'PAs - AgentsProfileInfo\' be created?',
    notesMirrorConfirm: 'Create {0}?',
    notesMirrorCreateHere: 'Create here',
    notesMirrorBack: 'Back',
    notesMirrorOpenFolder: 'Open folder',
    notesMirrorOldKept: 'The folder we left was not touched: it holds something that is not our link ({0}).',
    notesMirrorOldFailed: 'The folder we left could not be removed ({0}).',
    notesMirrorDocuments: 'Documents in your home folder',
    notesMirrorChoose: 'Choose a folder…',
    notesMirrorDone: 'Notes mirror: {0} created, {1} renamed, {2} findings.',
    notesMirrorCaseClash: '"{0}": two agents differ only in case — the second is not linked.',
    notesMirrorRealEntry: '"{0}" in the mirror is a real file or folder, not our link: left alone.',
    notesMirrorNotOurs: '"{0}" is a link this extension did not make: left alone.',
    notesMirrorNameTaken: '"{0}" is already taken: the old link was left as it was.',
    notesMirrorTargetRestored: '"{0}" pointed at a folder that was gone; the folder was made again.',
    notesMirrorLinkFailed: 'Could not create "{0}" ({1}).',
    notesMirrorFolderFailed: 'Could not create the mirror folder {0} ({1}).',
    notesOpenFailed: 'Could not open the notes folder ({0}).',
    notesAskMirror: 'Your agents have their own notes. Mirror them where you can read along? '
        + 'Obsidian is recommended.',
    notesAskDoIt: "Let's do it",
    notesAskLater: 'Remind me in 2 weeks',
    notesAskNever: "Don't ask again",
    memorySizeTitle: '{0} — memory {1} / {2} ({3}%)',
    memorySizeRecommended: 'Recommended: {0}',
    memorySizeKeep: 'Keep {0}',
    memorySizeOther: 'Other…',
    memorySizeInput: 'Memory limit, in characters (at least {0})',
    memorySizeInvalid: 'A whole number, {0} or more.',
    memorySizeConfirmAdd: 'About +{0} tokens in every session of {1}. Applies from its next session.',
    memorySizeConfirmFewer: 'About {0} fewer tokens in every session of {1}. Applies from its next session.',
    memorySizeLower: 'Lower the limit from {0} to {1}?',
    memorySizeLowerConfirm: 'Lower it',
    memorySizeApply: 'Set it',
    memorySizeCancel: 'Cancel',
    memorySizeDone: 'Memory limit set to {0} for {1}. {2}',
    memorySizeFailed: 'Hermes could not set the limit: {0}',
    memorySizeUnchanged: '{0} is already the limit for {1}.',
    memorySizeNoAgent: 'No agent is connected yet.',
    budgetPrimary: 'primary agent',
    budgetSecondant: 'secondant agent',
    budgetConnected: 'connected',
    budgetConnecting: 'connecting',
    budgetNotConnected: 'not connected',
    budgetUnavailable: 'balance unavailable: {0}',
    budgetNothingToShow: 'the account reports no balance',
    budgetNoApi: 'no balance API for the "{0}" provider',
    budgetNoProvider: 'the profile names no provider',
    budgetNoKey: 'no {0} in the profile',
    budgetUnknownError: 'no reason given',
    budgetPeak: 'Peak pricing',
    budgetOffPeak: 'Off-peak pricing (half rate)',
    budgetPeakHours: 'Peak hours: 09:00-12:00 and 14:00-18:00 (UTC+8); weekends bill at off-peak rates all day.',
    budgetClickRefresh: 'Click to refresh',
    catalogNeedsPatch: 'Hermes does not answer the session catalog, so this window cannot see its chats. This Hermes ({0}) needs the patch for {1}: open the folder below, or see Details.',
    catalogNoPatchKnown: 'Hermes does not answer the session catalog, so this window cannot see its chats. No patch set is known for Hermes {0}.',
    catalogOpenPatchFolder: 'Open patch folder',
    catalogDetails: 'Details',
    catalogDetailsBody: 'What Hermes answered: {0}\n\n{1}\n\nPatch files: {2}',
    catalogNoFiles: 'none for this version',
    desktopPreparing: 'Preparing Hermes Desktop… (the first build takes a few minutes)',
    desktopReady: 'Hermes Desktop is ready ({0}).',
    desktopFailed: 'Hermes Desktop could not be built.',
    desktopFailedBody: 'Hermes\' last lines:\n{0}',
    desktopTryAgain: 'Try again',
    desktopDetails: 'Details',
    trayAsk: 'Start Hermes Desktop in the tray when you log in?',
    trayAskYes: 'Yes, start in the tray',
    trayAskLater: 'Remind me in 2 weeks',
    trayAskNever: 'Don\'t ask again',
    traySettingOff: 'Hermes Desktop only starts in the tray when its own setting is on: Settings → Appearance → Window layout → Minimize to tray, in Hermes Desktop. Until then it starts as a normal window and stays open.',
    trayInstalled: 'Hermes Desktop will start in the tray when you log in. The shortcut is in {0}; the ⋯ menu turns it off again.',
    trayRemoved: 'The login shortcut is gone ({0}).',
    trayFailed: 'Hermes Desktop could not be set to start in the tray: {0}',
    trayWindowsOnly: 'Starting Hermes Desktop in the tray is a Windows feature.',
};
