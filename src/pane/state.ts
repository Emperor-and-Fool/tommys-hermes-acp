/* Pane state shared by more than one module. Reads and writes go through `state.x`. */
import type { SessionInfo } from '../shared/chat';
import type { CatalogSession } from '../shared/acp';
import type { ModelListItem, ModelProviderGroup } from '../shared/models';

/** A browser timer handle: number in the webview, opaque elsewhere. */
type Timer = ReturnType<typeof setTimeout>;

/** The modelList payload, kept so the picker can re-render without asking the host again. */
export interface ModelPayload {
    configId: string;
    currentValueId: string;
    currentLabel: string;
    models: ModelListItem[];
    groups?: ModelProviderGroup[];
    fromAgent: boolean;
}

export interface QuoteSegment {
    role: string;
    text: string;
}

/** One aggregated tool entry, as the tool cards keep it. */
export interface AggregatedTool {
    toolCallId: string;
    text: string;
}

/** What a selection yields: quotable text, or the reason it cannot be quoted yet. */
/** The blocked variant carries no text fields, so `blocked === undefined` narrows to the text. */
export type SelectionCapture =
    | { blocked: string; segments?: undefined; chars?: undefined; truncated?: undefined }
    | { blocked?: undefined; segments: QuoteSegment[]; chars: number; truncated: boolean };

/** A reply draft taken from a selection: what the composer quotes and how much of it. */
export interface QuotedText {
    segments: QuoteSegment[];
    chars: number;
    truncated: boolean;
}

export interface LogLine {
    line: string;
    level: string;
}

/** A tab render that had to wait for the strip to be free. */
export interface DeferredTabsRender {
    sessions: SessionInfo[];
    activeId: string;
}

/** The about panel's payload; the host decides what it carries beyond these. */
export interface PluginInfo {
    name?: string;
    displayName?: string;
    version?: string;
    publisher?: string;
    repository?: string;
    iconUri?: string;
    [key: string]: unknown;
}

/** What a message group carries beyond the DOM: its raw text and its aux body element. */
export interface AuxState {
    rawText: string;
    contentEl: Element;
    aggregatedTools?: AggregatedTool[];
    detailExpanded: boolean;
    isLive?: boolean;
    lessBtn: HTMLElement;
    moreBtn: HTMLElement;
    role: string;
    scrollEl: HTMLElement;
}

export interface PaneState {
    __imgPasteBound: boolean;
    activeSessionId: string;
    aggregatedTools: AggregatedTool[] | null;
    awaitingFirstChunk: boolean;
    canSend: boolean;
    closedSessions: CatalogSession[];
    composerHintTimer: Timer | null;
    configureEnvDetectDetailsOpen: boolean;
    configureEnvDetectFinished: boolean;
    configureEnvDetectPanelVisible: boolean;
    configureEnvSelectedPath: string;
    configureEnvSystemTarget: string;
    configureEnvSystemVar: string;
    connectionAttempted: boolean;
    copyLogResetTimer: Timer | null;
    currentStatus: 'idle' | 'connecting' | 'ready' | 'prompting' | 'error';
    currentStatusMessage: string;
    detectEnvDetailsOpen: boolean;
    detectEnvFinished: boolean;
    detectEnvPanelReady: boolean;
    fileListDebounce: Timer | null;
    fileListRequestId: number;
    filePickerIndex: number;
    filePickerItems: string[];
    filePickerVisible: boolean;
    isPrompting: boolean;
    lastActiveSessionId: string;
    lastModelPayload: ModelPayload | null;
    /** The session the read-only viewer is showing: its per-message Forward needs it. */
    viewerSessionId: string;
    lastSelectionQuote: SelectionCapture | null;
    lastSessions: SessionInfo[];
    logScrollIdleTimer: Timer | null;
    logScrollPinnedByUser: boolean;
    logs: LogLine[];
    mentionStart: number;
    modelConfigId: string;
    multiSelectMode: boolean;
    multiSelectPurpose: string;
    paneHintText: string;
    pendingOpenCount: number;
    pendingOpenSessionId: string | null;
    pendingOpenTitle: string;
    pendingSendText: string;
    pendingSwitchSessionId: string | null;
    pendingTabsRender: DeferredTabsRender | null;
    /** Served by media/chat.html with this id; the pane is dead without it, so it is asserted once here. */
    placeholder: HTMLElement;
    pluginInfo: PluginInfo;
    previewHideTimer: Timer | null;
    previewRequestId: number;
    previewTooltip: HTMLElement | null;
    quoteActionEl: HTMLElement | null;
    replyQuote: QuotedText | null;
    scrollIdleTimer: Timer | null;
    scrollPinnedByUser: boolean;
    /** Until this moment, a scroll event is ours (a card collapsing, an auto-scroll), not the
     *  user leaving the bottom, and must not pin the view. */
    suppressScrollPinUntil: number;
    selectionQuoteTimer: Timer | null;
    sessionMarkdownPending: boolean;
    sessionMsgCounter: number;
    sessionRenderJobId: number;
    streamingMessageId: string | null;
    switchQueuedFor: string | null;
    tabContextSessionId: string | null;
    thoughtMsgId: string | null;
    toolAggregateGroupId: string | null;
    toolCallMap: Record<string, string>;
    undeliveredFilledComposer: boolean;
    undeliveredText: string;
}

/** What a permission card remembers between renders. */
export interface PermissionCardState {
    options: import('../shared/acp').PermissionOption[];
    text: string;
    scrollEl: HTMLElement;
    textEl: HTMLElement;
    wrapEl: HTMLElement;
    moreBtn: HTMLElement;
    lessBtn: HTMLElement;
    cardToggle: HTMLElement;
    cardCollapsed: boolean;
    detailExpanded: boolean;
    readOnly: boolean;
}

declare global {
    /** Booked onto message elements by the markdown, tool-card and permission renderers. */
    interface Element {
        _auxState?: AuxState;
        _rawText?: string;
        _permissionState?: PermissionCardState;
    }
}

export const state: PaneState = {
    __imgPasteBound: false,
    activeSessionId: '',
    aggregatedTools: null,
    awaitingFirstChunk: false,
    canSend: false,
    closedSessions: [],
    composerHintTimer: null,
    configureEnvDetectDetailsOpen: false,
    configureEnvDetectFinished: false,
    configureEnvDetectPanelVisible: false,
    configureEnvSelectedPath: '',
    configureEnvSystemTarget: '',
    configureEnvSystemVar: 'PATH',
    connectionAttempted: false,
    copyLogResetTimer: null,
    currentStatus: 'ready',
    currentStatusMessage: '',
    detectEnvDetailsOpen: false,
    detectEnvFinished: false,
    detectEnvPanelReady: false,
    fileListDebounce: null,
    fileListRequestId: 0,
    filePickerIndex: 0,
    filePickerItems: [],
    filePickerVisible: false,
    isPrompting: false,
    lastActiveSessionId: '',
    lastModelPayload: null,
    viewerSessionId: '',
    lastSelectionQuote: null,
    lastSessions: [],
    logScrollIdleTimer: null,
    logScrollPinnedByUser: false,
    logs: [],
    mentionStart: -1,
    modelConfigId: '',
    multiSelectMode: false,
    multiSelectPurpose: 'normal',
    paneHintText: '',
    pendingOpenCount: 0,
    pendingOpenSessionId: null,
    pendingOpenTitle: '',
    pendingSendText: '',
    pendingSwitchSessionId: null,
    pendingTabsRender: null,
    placeholder: document.getElementById('placeholder') as HTMLElement,
    pluginInfo: {},
    previewHideTimer: null,
    previewRequestId: 0,
    previewTooltip: null,
    quoteActionEl: null,
    replyQuote: null,
    scrollIdleTimer: null,
    scrollPinnedByUser: false,
    suppressScrollPinUntil: 0,
    selectionQuoteTimer: null,
    sessionMarkdownPending: false,
    sessionMsgCounter: 0,
    sessionRenderJobId: 0,
    streamingMessageId: null,
    switchQueuedFor: null,
    tabContextSessionId: null,
    thoughtMsgId: null,
    toolAggregateGroupId: null,
    toolCallMap: {},
    undeliveredFilledComposer: false,
    undeliveredText: '',
};
