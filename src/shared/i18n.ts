export type SupportedLocale = 'en' | 'zh-cn';

export interface LocaleStrings {
    // Extension host
    selectCodeFirst: string;
    allowHermesRun: string;
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
    sessionNotWritable: string;
    modelSwitchIncomplete: string;
    openTab: string;
    chooseChat: string;
    closedSessionsHeader: string;
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
    detectEnvironmentStepCompleteShort: string;
    detectEnvironmentCancelled: string;
    detectEnvironmentNotFound: string;
    detectEnvironmentPickExecutable: string;
    detectEnvironmentConfigureTitle: string;
    detectEnvironmentConfigurePlugin: string;
    detectEnvironmentConfigurePluginDesc: string;
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
    viewChatTitle: string;
    detectEnvironmentAlreadyConfigured: string;
    detectEnvironmentRunFirst: string;
    detectEnvironmentClose: string;

    configureEnvironmentTitle: string;
    configureEnvironmentPathLabel: string;
    configureEnvironmentPathPlaceholder: string;
    configureEnvironmentBrowse: string;
    configureEnvironmentDetect: string;
    configureEnvironmentDetecting: string;
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
    newChatBtn: string;
    moreOptions: string;
    menuAbout: string;
    menuSettings: string;
    menuHelp: string;
    menuFaq: string;
    menuLogs: string;

    // WebView — placeholder & connection
    connectingTitle: string;
    connectingHint: string;
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
    clearChat: string;
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
    permissionCancelled: string;
    permissionAllowOnce: string;
    permissionAllowAlways: string;
    permissionAllowSession: string;
    permissionRejectOnce: string;
    permissionRejectAlways: string;
    permissionDeny: string;
    permissionExpand: string;
    permissionCollapse: string;
    permissionShowMore: string;
    permissionCardCollapse: string;
    permissionCardExpand: string;
    permissionSelected: string;
    insert: string;
    emptyFile: string;
    noMatchingFiles: string;
    searchingFiles: string;
    configureAgents: string;
    noModels: string;
    modelFromAgent: string;
    modelLocalPreference: string;
    tokenUsageLabel: string;
    copied: string;
    clickToInsert: string;
    insertToInput: string;
    insertToEditor: string;
    insertMenu: string;
    noActiveEditor: string;
    selectMessages: string;
    /** "Forward to {0}" where {0} is the other pane's profile. */
    forwardToOtherPane: string;
    /** "{0}@{1}", the left half of the attribution header. */
    forwardedFromHeader: string;
    otherPaneNotLive: string;
    peerCardDeliver: string;
    peerCardDismiss: string;
    peerCardDelivered: string;
    peerCardDismissed: string;
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
    tabContextPin: string;
    tabContextUnpin: string;
    copySid: string;
    sessionExportSessionId: string;
    sessionExportModel: string;
    sessionExportDate: string;
    sessionRendering: string;
    localHistoryDivider: string;
    localHistoryDividerTitle: string;
    localHistoryBadge: string;

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
    historyViewerUnavailable: string;
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
    approvalModeTooltip: string;
    approvalModeFailed: string;

    // Steer
    steer: string;
    steerHint: string;
}

export type LocaleKey = keyof LocaleStrings;
