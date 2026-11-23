export type SupportedLocale = 'en' | 'zh-cn';

export interface LocaleStrings {
    // Extension host
    selectCodeFirst: string;
    allow: string;
    deny: string;
    waitForResponse: string;
    failedSwitchModel: string;
    savedModelUnavailable: string;
    modelPreferenceSaved: string;
    hermesNotConnected: string;
    couldNotOpenFile: string;
    hermesNotConnectedConnecting: string;
    fileAccessDenied: string;
    fileReadError: string;
    newChat: string;
    noActiveTabHint: string;
    sessionNotFound: string;
    searchOpen: string;
    searchClose: string;
    jumpToTop: string;
    jumpToNow: string;
    jumpToTopHint: string;
    jumpToNowHint: string;
    sessionReplayFailed: string;
    sessionNotWritable: string;
    profileExcluded: string;
    /** Who holds a profile this pane may not run on: the four ways a profile can be held. */
    holderPrimaryHere: string;
    holderSecondantHere: string;
    holderPrimaryElsewhere: string;
    holderSecondantElsewhere: string;
    profileMissing: string;
    modelSwitchIncomplete: string;
    openTab: string;
    chooseChat: string;
    closedSessionsHeader: string;
    /** Rail button that opens the permission-mode row. */
    permissionModeBtn: string;
    permissionModeTitle: string;
    permissionModeClose: string;
    /** The red action: what it does, and what it does on the confirming press. */
    permissionOpenTooltip: string;
    /** Nothing to work in: Hermes is not started until a folder or workspace is open. */
    noFolderOpen: string;
    /** The permission root: which folder Hermes works in when a workspace shows several. */
    /** Edit cards only: why this asks, and what to change. */
    permissionEditHint: string;
    permissionRootLabel: string;
    permissionRootTitle: string;
    permissionRootBody: string;
    permissionRootLastRemoved: string;
    /** The word on a folder that just joined the workspace. */
    permissionRootNew: string;
    /** The word on a folder whose path is gone. */
    permissionRootMissing: string;
    /** A move Hermes refused: {folder} is where it could not go, {previous} where it stays. */
    permissionRootMoveRefused: string;
    /** A root that left the workspace while the session ran: {folder} is the one that went. */
    permissionRootRootRemoved: string;
    appliesNextRun: string;
    permissionOpenConfirm: string;
    /** The way back for the patterns the red action cleared. */
    permissionRestoreLabel: string;
    /** "Permissions: {mode}" and the four short names the rail button can show. */
    permissionModeBtnTemplate: string;
    permissionModeMan: string;
    permissionModeSmart: string;
    permissionModeNone: string;
    permissionModeAll: string;
    permissionModeBtnTooltip: string;
    noClosedSessions: string;
    defaultAgent: string;
    statusStartingAcp: string;
    statusHermesThinking: string;
    statusHermesInitializing: string;
    statusProcessError: string;
    statusProcessExited: string;
    statusConnectionFailed: string;
    statusNewSessionFailed: string;
    detectEnvironmentProgress: string;
    detectEnvironmentProgressPrefix: string;
    detectEnvironmentCancelled: string;
    detectEnvironmentNotFound: string;
    detectEnvironmentPickExecutable: string;
    detectEnvironmentConfigureSystem: string;
    detectEnvironmentConfigureSystemDesc: string;
    detectEnvironmentSystemVarTargetWindows: string;
    detectEnvironmentSystemVarTargetUnix: string;
    detectEnvironmentConfigureSystemConfirm: string;
    detectEnvironmentConfigureSystemConfirmYes: string;
    detectEnvironmentConfigureSystemConfirmNo: string;
    detectEnvironmentPluginConfigured: string;
    detectEnvironmentSystemConfigured: string;
    detectEnvironmentSystemAlreadyConfigured: string;
    detectEnvironmentSystemNeedsRestart: string;
    detectEnvironmentBroken: string;
    detectEnvironmentSourceConfig: string;
    detectEnvironmentSourcePathLookup: string;
    detectEnvironmentSourceKnownPath: string;
    detectEnvironmentSourcePip: string;
    detectEnvironmentSourcePythonImport: string;
    detectEnvironmentSourceHermesHome: string;
    detectEnvironmentCandidateVerified: string;
    detectEnvironmentCandidateUnverified: string;
    detectEnvironmentDetectTitle: string;
    detectEnvironmentCompleteTitle: string;
    detectEnvironmentStepConfig: string;
    detectEnvironmentStepPath: string;
    detectEnvironmentStepKnownPath: string;
    detectEnvironmentStepPip: string;
    detectEnvironmentStepPython: string;
    detectEnvironmentStepHermesHome: string;
    detectEnvironmentStepVerify: string;
    detectEnvironmentStepAcpCheck: string;
    detectEnvironmentStepAcpInstall: string;
    detectEnvironmentStepAcpOk: string;
    detectEnvironmentStepAcpFail: string;
    detectEnvironmentStepAcpInstallOk: string;
    detectEnvironmentStepAcpInstallFail: string;
    detectEnvironmentStepSummary: string;
    detectEnvironmentStepNotFound: string;
    detectEnvironmentStepSkipped: string;
    detectEnvironmentStepFoundCount: string;
    detectEnvironmentStepVerifyCount: string;
    detectEnvironmentSummaryReady: string;
    detectEnvironmentSummaryBroken: string;
    detectEnvironmentSummaryNotFound: string;
    detectEnvironmentSummaryInstall: string;
    detectEnvironmentSummaryConfigureViaMenu: string;
    detectEnvironmentSummaryAcpBroken: string;
    detectEnvironmentSummaryAcpManual: string;
    detectEnvironmentViewDetails: string;
    detectEnvironmentHideDetails: string;
    detectEnvironmentClose: string;

    configureEnvironmentTitle: string;
    configureEnvironmentPathLabel: string;
    configureEnvironmentPathPlaceholder: string;
    configureEnvironmentBrowse: string;
    configureEnvironmentDetect: string;
    configureEnvironmentCandidatesTitle: string;
    configureEnvironmentNoCandidates: string;
    configureEnvironmentSave: string;
    configureEnvironmentCancel: string;
    configureEnvironmentBrowseTitle: string;
    configureEnvironmentInvalidPath: string;
    configureEnvironmentSaveFailed: string;
    configureEnvironmentSystemVarHint: string;
    configureEnvironmentOpenDirectory: string;
    configureEnvironmentClearPath: string;

    // WebView — toolbar & status
    connectionStatus: string;
    statusDisconnected: string;
    statusConnecting: string;
    statusReady: string;
    statusThinking: string;
    statusThinkingProvider: string;
    /** The loading block's counter: `{0}` content chunks received while the replay streams. */
    loadingMessageChunks: string;
    statusError: string;
    connectionLostRetrying: string;
    retry: string;
    switchProfile: string;
    profile: string;
    profiles: string;
    switchModel: string;
    model: string;
    models: string;
    modelPlaceholder: string;

    // WebView — placeholder & connection
    readyPlaceholder: string;
    connectionError: string;
    retryConnect: string;
    detectEnvironment: string;

    // WebView — input area
    inputPlaceholder: string;
    resizeHandle: string;
    filePicker: string;
    searchChat: string;
    searchPrev: string;
    searchNext: string;
    clearInput: string;
    copySession: string;
    quickActions: string;
    quickActionsExpand: string;
    quickActionsCollapse: string;
    tokenUsage: string;
    send: string;
    stop: string;
    cancelResponse: string;

    // WebView — modals
    hermesLogs: string;
    copy: string;
    copyCode: string;
    replyAction: string;
    replyActionBlocked: string;
    replySelectionLost: string;
    replyStreamingBlocked: string;
    replyTitle: string;
    replyTruncated: string;
    imageMissing: string;
    clear: string;
    noLogs: string;
    aboutTitle: string;
    helpTitle: string;
    faqTitle: string;

    // WebView — about (rendered in JS)
    aboutVersion: string;
    aboutDescription: string;
    aboutFeatureTabs: string;
    aboutFeaturePickers: string;
    aboutFeatureInsert: string;
    aboutFeatureTools: string;
    repository: string;

    // WebView — help (HTML body)
    helpHtml: string;
    faqHtml: string;

    // WebView — messages & misc
    roleYou: string;
    roleHermes: string;
    roleThought: string;
    roleTool: string;
    roleMessage: string;
    permissionTitle: string;
    /** Card label for a gate note ("flagged ... and auto-approved by smart approval"). */
    approvalNoteLabel: string;
    permissionCancelled: string;
    permissionTimedOut: string;
    permissionAllowOnce: string;
    permissionAllowAlways: string;
    permissionAllowSession: string;
    permissionRejectOnce: string;
    permissionRejectAlways: string;
    permissionDeny: string;
    permissionCollapse: string;
    permissionShowMore: string;
    permissionCardCollapse: string;
    permissionCardExpand: string;
    permissionSelected: string;
    insert: string;
    emptyFile: string;
    noMatchingFiles: string;
    searchingFiles: string;
    noHermesProfiles: string;
    noModels: string;
    modelFromAgent: string;
    modelLocalPreference: string;
    tokenUsageLabel: string;
    copied: string;
    insertToInput: string;
    insertToEditor: string;
    insertMenu: string;
    noActiveEditor: string;
    selectMessages: string;
    /** "Forward to {0}" where {0} is the other pane's profile. */
    forwardToOtherPane: string;
    /** "{0}@{1}", the left half of the attribution header. */
    otherPaneNotLive: string;
    peerCardDeliver: string;
    peerCardDismiss: string;
    peerCardDelivered: string;
    peerCardDismissed: string;
    /** "Expired": a peer card nobody answered before the timeout. */
    peerCardExpired: string;
    /** "Forward from {0} — cancelled": what a dismissed card keeps. */
    peerForwardCancelled: string;
    /** "Forward from {0} — expired": what a card nobody answered keeps. */
    peerForwardExpired: string;
    /** "{0}@{1}": the sender line on a peer card. */
    peerCardHeader: string;
    multiSelectAll: string;
    multiSelectDeselectAll: string;
    multiSelectDelete: string;
    multiSelectCopy: string;
    multiSelectExport: string;
    multiSelectExit: string;
    multiSelectCount: string;
    fileLinkTitle: string;
    tabClose: string;
    tabContextSid: string;
    tabContextExport: string;
    tabContextCopy: string;
    tabContextRename: string;
    tabContextClose: string;
    tabContextCloseOthers: string;
    tabContextCloseLeft: string;
    tabContextCloseRight: string;
    tabContextCloseAll: string;
    createProject: string;
    tabContextMoveProject: string;
    tabContextRenameProject: string;
    tabContextDeleteProject: string;
    tabContextMoveWorkspace: string;
    tabContextNoProject: string;
    tabContextSticky: string;
    tabContextUnstick: string;
    copySid: string;
    sessionExportSessionId: string;
    sessionExportModel: string;
    sessionExportDate: string;
    sessionRendering: string;

    switchSessionPromptTitle: string;
    switchSessionPromptBody: string;
    switchSessionConfirm: string;
    switchSessionStopNow: string;
    undeliveredNotice: string;
    undeliveredRestore: string;
    undeliveredDiscard: string;
    switchSessionQueuedBody: string;
    switchSessionQueuedTitle: string;
    switchSessionStay: string;


    // History card
    historyCardHeader: string;
    historyCardCount: string;
    historyCardSpan: string;
    historyCardAnchor: string;

    // History viewer
    /** The pick button: "{0} ticked of {1}". */
    historyAttachCount: string;
    historyViewerCancel: string;
    /** The viewer while its transcript is being fetched (no chunk counter: an export is one call). */
    historyViewerLoading: string;
    /** The viewer's fetch returned nothing: an answer, not a failure. */
    historyViewerEmpty: string;
    /** The viewer's fetch failed. `{0}` is not used; the reason stays in the tooltip and the log. */
    historyViewerFetchFailed: string;
    /** The role filter on the history attach bar. */
    historyRoleUser: string;
    historyRoleAssistant: string;
    historyRoleThought: string;
    historyRoleTool: string;
    /** Re-render the viewer so the role filter applies. */
    historyRoleReload: string;

    // Session memory: the picker, the staged chip, the viewer
    historyPickerPlaceholder: string;
    historyPickerHeader: string;
    historyPickerEmpty: string;
    historyPickerHidden: string;
    historyChipSummary: string;
    historyChipPending: string;
    historyChipClear: string;

    // Permission card: approval mode
    approvalModeManual: string;
    approvalModeSmart: string;
    approvalModeOff: string;

    /** What each mode does to commands and edits. Replaces one false sentence. */
    approvalModeManualTip: string;
    approvalModeSmartTip: string;
    approvalModeNoneTip: string;
    approvalModeSensitiveTip: string;
    approvalModeFailed: string;

    // Steer
    steer: string;
    steerHint: string;

    // The agent notes mirror (the ⋯ menu's agent group)
    notesMirrorTitle: string;
    notesMirrorConfirm: string;
    notesMirrorCreateHere: string;
    notesMirrorBack: string;
    notesMirrorOpenFolder: string;
    notesMirrorOldKept: string;
    notesMirrorOldFailed: string;
    notesMirrorDocuments: string;
    notesMirrorChoose: string;
    notesMirrorDone: string;
    notesMirrorCaseClash: string;
    notesMirrorRealEntry: string;
    notesMirrorNotOurs: string;
    notesMirrorNameTaken: string;
    notesMirrorTargetRestored: string;
    notesMirrorLinkFailed: string;
    notesMirrorFolderFailed: string;
    notesOpenFailed: string;
    notesAskMirror: string;
    notesAskDoIt: string;
    notesAskLater: string;
    notesAskNever: string;
    memorySizeTitle: string;
    memorySizeDouble: string;
    memorySizeKeep: string;
    memorySizeOther: string;
    memorySizeInput: string;
    memorySizeInvalid: string;
    memorySizeConfirm: string;
    memorySizeApply: string;
    memorySizeCancel: string;
    memorySizeDone: string;
    memorySizeFailed: string;
    memorySizeUnchanged: string;
    memorySizeNoAgent: string;
}

export type LocaleKey = keyof LocaleStrings;
