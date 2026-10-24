import * as vscode from 'vscode';
import * as fs from 'fs';
import { createHash } from 'node:crypto';
import * as path from 'path';
import { AcpClient, CatalogSession, ModelListState, PermissionRequest, ReplayMessage, TokenUsage } from '../acp/AcpClient';
import { buildFallbackModelListState, buildModelListStateFromCatalog, isRuntimeModelSource } from '../acp/modelConfig';
import { resolveModelCatalog } from '../acp/acpModelCatalog';
import { resolveMcpServersForSession } from '../acp/mcpConfig';
import { normalizeHermesCliProfile, scopeKeyForCliProfile } from '../acp/hermesProfile';
import { discoverHermesProfiles, detectHermesEnvironment, tryResolveHermesQuick } from '../acp/profileDiscovery';
import type {
    HermesDetectProgressEvent,
    HermesDetectSource,
    HermesDetectStepId,
    HermesDetectStepStatus,
    HermesEnvironmentReport,
    HermesExecutableCandidate,
} from '../acp/profileDiscovery';
import { addHermesDirectoryToSystemPath, getHermesExecutableDirectory } from '../acp/hermesPathSetup';
import { accessExecutable, venvHermesCandidates } from '../acp/hermesPaths';
import {
    activeSessionPathFor,
    loadProfileState,
    migrateLegacySessionStorage,
    saveProfileState,
    sanitizeProfileScopeKey,
    sessionsPathFor,
} from './profileStorage';
import { getLocale, getWebviewLocale, initI18n, localizeStatusMessage, t } from '../i18n';
import { resolvePermissionOptionLabel } from '../i18n/permissionOptions';
import { SupportedLocale } from '../i18n/types';
import { buildWebviewHtml } from './webviewHtml';
import {
    detectStepLabel,
    formatDetectBrokenMessage,
    formatDetectProgressPercent,
    formatDetectStepDetail,
    formatDetectSummaryForReport,
} from './transcript/detectFormat';
import { buildSessionExportPayload } from './session/sessionExport';
import { SessionStore } from './session/store';
import { applyCatalogRows } from './session/catalog';
import { backfillAgentEngaged, markAgentEngaged, normalizePinnedOrder, pinSession, registerSession, reorderSessions } from './session/index';
import { buildReplayMessages } from './session/replay';
import { findUndelivered, lastUserMessageText } from './session/undelivered';
import { PromptRunner } from './session/promptRunner';
import {
    canAggregateToolTexts,
    rebuildAggregatedToolText,
} from './transcript/toolAggregate';
import { classifyLogLevel, LogLevel } from '../logLevel';
import {
    composePromptWithContext,
    ContextAttachOption,
    filterAttachableMessages,
    resolveAttachMessages,
    resolveCustomAttachMessages,
} from './contextAttach';

type ContextAttachVisibility = 'onNewSession' | 'always' | 'never';

/** Webview panel id; the serializer re-creates it after a window reload. */
export const CHAT_PANEL_VIEW_TYPE = 'tommys.chatPanel';

type SurfaceRole = 'chat' | 'rail';

/** One renderer of the chat: the side bar view or the single editor panel. */
interface ChatSurface {
    webview: vscode.Webview;
    role: SurfaceRole;
    view?: vscode.WebviewView;
    panel?: vscode.WebviewPanel;
}

interface StoredPermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

export interface ChatMessage {
    role: string;
    text: string;
    timestamp: number;
    toolCallId?: string;
    aggregatedTools?: Array<{ toolCallId: string; text: string }>;
    permissionId?: string;
    title?: string;
    detail?: string;
    options?: StoredPermissionOption[];
    resolved?: boolean;
    outcome?: 'selected' | 'cancelled';
    selectedOptionId?: string;
    selectedLabel?: string;
    /** Content-addressed attachments for this message: Hermes never stores the bytes. */
    imageRefs?: StoredImageRef[];
}

export interface StoredImageRef {
    hash: string;
    mimeType: string;
}

/** The key an attachment is filed under: the message text, markers and spacing removed. */
export function attachmentKey(text: string): string {
    return String(text || '')
        .replace(/\[(?:screenshot|image)\]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function markerCount(text: string): number {
    return (String(text || '').match(/\[(?:screenshot|image)\]/gi) || []).length;
}

export interface SessionInfo {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    modelId?: string;
    modelLabel?: string;
    /** User has sent at least one message to Hermes in this session. */
    agentEngaged?: boolean;
    /** Pinned tabs stay at the front and reorder only within pinned group. */
    pinned?: boolean;
    /**
     * Hermes-side session id backing this tab. Local ids stay for tab/UI history;
     * this is the id ACP `session/load` addresses, so a tab survives reconnects.
     */
    hermesSessionId?: string;
    /** Working directory the Hermes session was created in (used when resuming). */
    cwd?: string;
}

interface HermesAgentConfig {
    name: string;
    path?: string;
    profile?: string;
    cwd?: string;
}

interface ProfileListEntry {
    id: string;
    label: string;
}

interface ConnectionTarget {
    scopeKey: string;
    selectionId: string;
    displayName: string;
    cliProfile: string;
    configPath?: string;
    configCwd?: string;
}

interface DetectStepLogEntry {
    step: HermesDetectStepId;
    label: string;
    detail: string;
    status: HermesDetectStepStatus;
}

export class HermesChatProvider implements vscode.WebviewViewProvider {
    // ---- Lifecycle ----
    private _view?: vscode.WebviewView;
    /** Every live renderer: the sidebar view and/or the single chat panel. */
    private readonly _surfaces: ChatSurface[] = [];
    /** Where the conversation is rendered: the side bar or an editor tab. */
    private _surfaceMode: 'sidebar' | 'editor' = 'sidebar';
    private _chatPanel?: vscode.WebviewPanel;
    private _acp?: AcpClient;
    private _output: vscode.OutputChannel;

    // ---- Session State ----
    private _historyDir: string;
    private _scopeKey: string;
    private _store: SessionStore;
    private _sessionMessages: ChatMessage[] = [];
    private _sessionId: string = '';
    private _sessions: SessionInfo[] = [];
    /** Sessions Hermes has flagged hidden: closed tabs waiting to be opened again. */
    private _hiddenSessions: CatalogSession[] = [];
    private _modelState: ModelListState | null = null;
    private _modelFallbackShown: boolean = false;
    private _activeAgentName: string = '';
    /** Agent name or CLI profile id used for reconnect / switch. */
    private _activeSelectionId: string = '';
    /** One-shot guard for the automatic reconnect after a lost connection. */
    private _reconnectAttempts = 0;
    private _disposed = false;
    /** Selection id of the profile/agent used last, restored on activation. */
    private _persistedSelectionId: string = '';
    private _discoveredProfiles: string[] | null = null;
    private _profileDiscoveryPromise: Promise<void> | undefined;
    private _modelSwitchInFlight: Promise<void> | undefined;
    private _tokenUsage: TokenUsage | null = null;
    private _webviewLocale?: SupportedLocale;
    private readonly _extensionId: string;
    private _pendingPermissions = new Map<string, (optionId: string | null) => void>();
    private _permissionCounter = 0;
    /** Serializes webview send so rapid sends cannot overlap. */
    private _chatOpChain: Promise<void> = Promise.resolve();
    /** Turn-scoped state; behaviour joins it in the next steps of the extraction. */
    private readonly _turn = new PromptRunner();
    /** Resolves when `_connect` finishes session/model setup after ACP `start`. */
    private _connectPromise: Promise<void> | undefined;
    /** When true, suppress forwarding ACP `ready` until post-connect setup completes. */
    private _deferReadyUntilSessionSetup = false;
    /**
     * True only while a load the user asked for (tab switch, adopt, resume) is in
     * flight; a load fired mid-send must not repaint over the pending turn.
     */
    private _renderReplayOnLoad = false;
    /** Chat session currently bound to the single ACP agent runtime context. */
    private _acpBoundSessionId: string = '';
    /** Hermes session id this workspace last had open (workspaceState-backed). */
    private _persistedHermesSessionId: string = '';
    /** Messages available for one-time context attach after agent reset. */
    private _contextAttachMessages: ChatMessage[] = [];
    private _contextAttachActive = false;
    private _contextAttachAwaitingReply = false;
    private _detectStepLog: DetectStepLogEntry[] = [];
    private _lastDetectReport: HermesEnvironmentReport | undefined;
    private _detectInProgress = false;
    private _detectAbortController?: AbortController;
    private readonly _detectStepOrder: HermesDetectStepId[] = [
        'config',
        'path_lookup',
        'known_path',
        'pip',
        'python_import',
        'hermes_home',
        'verify',
        'acp_check',
        'acp_install',
        'summary',
    ];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        const context = this._context;
        this._extensionId = context.extension.id;
        this._persistedHermesSessionId = context.workspaceState.get<string>('hermesSessionId') || '';
        // The profile/agent last picked in the UI outlives the window: without this the
        // extension always reopened on the `tommys.profile` setting, not on the user's pick.
        this._persistedSelectionId = context.globalState.get<string>('activeSelectionId') || '';
        this._surfaceMode = this._readSurfaceMode();
        this._output = vscode.window.createOutputChannel('Hermes Chat', 'hermes-chat');
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        this._historyDir = storagePath;
        migrateLegacySessionStorage(this._historyDir, '__default__');

        // Seed the in-memory selection first: _resolveConnectionTarget() prefers it over
        // the configured profile, and still falls back when the id no longer resolves.
        this._activeSelectionId = this._persistedSelectionId;
        const initialTarget = this._resolveConnectionTarget(this._persistedSelectionId || undefined);
        this._scopeKey = initialTarget.scopeKey;
        this._activeSelectionId = initialTarget.selectionId;
        this._activeAgentName = initialTarget.displayName;
        this._store = new SessionStore(this._historyDir, this._scopeKey);
        this._loadSessions();
        this._sessionId = this._restoreActiveSession();
        this._ensureSessionRegistered();
        this._loadHistory();

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('hermes')) {
                    void this._onConfigurationChanged(e);
                }
            })
        );
    }

    private _restoreActiveSession(): string {
        const id = this._store.readActiveId();
        if (id && this._sessions.some(s => s.id === id)) {
            return id;
        }
        return Date.now().toString(36);
    }

    private _saveActiveSession(): void {
        this._store.writeActiveId(this._sessionId);
    }

    private _msgPath(sid: string): string {
        return this._store.msgPath(sid);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        const surface = this._addSurface(webviewView.webview, 'view', webviewView);
        webviewView.onDidDispose(() => {
            this._removeSurface(surface);
            if (this._view === webviewView) {
                this._view = undefined;
            }
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);
        this._webviewLocale = getLocale();

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._syncWebviewLocale();
                if (!this._acp) {
                    this._connect();
                }
            }
        });

        this._wireMessages(webviewView.webview, surface);
    }

    /** Same message contract for the side bar view and the editor panel. */
    private _wireMessages(webview: vscode.Webview, surface: ChatSurface): void {
        webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'sendMessage':
                    this._enqueueChatOp(() => this._handleUserMessage(message.text, message.contextAttach, (message as any).images));
                    break;
                case 'cancel':
                    // Cancel must not wait behind an in-flight sendMessage; AcpClient
                    // handles send/cancel races via _activePromptId.
                    void this._handleCancel();
                    break;
                case 'openFile':
                    void this._handleOpenFile(message.path);
                    break;
                case 'listFiles':
                    void this._handleListFiles(message.query || '', message.requestId);
                    break;
                case 'previewFile':
                    void this._handlePreviewFile(message.path, message.requestId);
                    break;
                case 'ready':
                    this._log('WebView ready');
                    this._postSurfaceRole(surface);
                    this._syncWebviewLocale();
                    this._postPluginInfo();
                    this._postSessionList();
                    this._postProfileList();
                    this._postHiddenSessions();
                    this._postConfig();
                    this._postTokenUsage();
                    // A pane can be brand new (container move, view re-show): replay the state
                    // a freshly connected pane would have or it renders placeholders — an empty
                    // "Profile" pill, a model chip with nothing in it.
                    this._postMessage({ type: 'activeAgent', name: this._activeAgentName });
                    this._postModelList();
                    if (surface.role === 'chat') {
                        this._restoreMessages(surface);
                    }
                    if (this._surfaceMode === 'editor' && !this._chatPanel
                        && this._surfaces.some(item => !!item.view)) {
                        this._openChatPanel();
                    }
                    // Moving the view container disposes and re-creates the webview but keeps
                    // the ACP client. The new pane knows nothing and its composer starts
                    // disabled, so replay the live status — otherwise the UI looks frozen and
                    // only a window reload recovers.
                    if (this._acp) {
                        const liveStatus = this._acp.status;
                        this._postTo(surface, { type: 'status', status: liveStatus, sessionId: this._sessionId });
                        if (liveStatus === 'idle' || liveStatus === 'error') {
                            this._acp.dispose();
                            this._acp = undefined;
                        }
                    }
                    this._connect();
                    break;
                case 'getSessions':
                    void this._refreshSessionsFromHermes();
                    break;
                case 'getHiddenSessions':
                    this._postHiddenSessions();
                    break;
                case 'openTab':
                    this._enqueueChatOp(() => this._handleOpenTab(message.sessionId));
                    break;
                case 'reorderSessions':
                    this._handleReorderSessions(message.sessionIds);
                    break;
                case 'closeSessions':
                    void this._handleCloseSessions(message.sessionId, message.mode);
                    break;
                case 'togglePinSession':
                    this._handleTogglePinSession(message.sessionId);
                    break;
                case 'sessionExport':
                    this._handleSessionExport(message.sessionId, message.action, message.indices);
                    break;
                case 'switchAgent':
                    this._handleSwitchAgent(message.agentName);
                    break;
                case 'switchSession':
                    if (this._surfaceMode === 'editor' && !this._chatPanel) {
                        this._openChatPanel();
                    }
                    this._enqueueChatOp(() => this._handleSwitchSession(message.sessionId, {
                        interrupt: message.interrupt === true,
                    }));
                    break;
                case 'switchModel':
                    this._handleSwitchModel(message.configId, message.valueId);
                    break;
                case 'getModels':
                    void this._syncModelState();
                    break;
                case 'getProfiles':
                    this._postProfileList();
                    break;
                case 'openSettings':
                    void this._openSettings();
                    break;
                case 'webviewLog':
                    // Pane-side diagnostics, so paste/render behaviour is observable
                    // from the extension output channel instead of the webview devtools.
                    this._log(`[webview] ${String(message.line ?? '')}`.slice(0, 400));
                    break;
                case 'openExternal':
                    if (message.url) {
                        void vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case 'retry':
                    void this._handleRetry();
                    break;
                case 'detectEnvironment':
                    void this.detectEnvironment();
                    break;
                case 'detectEnvironmentDismiss':
                    this._handleDetectEnvironmentDismiss();
                    break;
                case 'configureEnvironmentBrowse':
                    void this._handleConfigureEnvironmentBrowse();
                    break;
                case 'configureEnvironmentDetect':
                    void this._handleConfigureEnvironmentDetect(message.currentPath);
                    break;
                case 'configureEnvironmentSave':
                    void this._handleConfigureEnvironmentSave(message.path);
                    break;
                case 'configureEnvironmentSystem':
                    void this._handleConfigureEnvironmentSystem(message.path);
                    break;
                case 'configureEnvironmentOpenDirectory':
                    void this._handleConfigureEnvironmentOpenDirectory(message.path);
                    break;
                case 'configureEnvironmentDetectClose':
                    this._handleConfigureEnvironmentDetectClose();
                    break;
                case 'permissionResponse':
                    this._handlePermissionResponse(message.id, message.optionId ?? null);
                    break;
                case 'insertEditor':
                    void this._handleInsertEditor(message.text || '');
                    break;
                case 'deleteMessages':
                    this._handleDeleteMessages(message.indices);
                    break;
            }
        });
    }

    private _addSurface(
        webview: vscode.Webview,
        kind: 'view' | 'panel',
        host: vscode.WebviewView | vscode.WebviewPanel
    ): ChatSurface {
        const isView = kind === 'view';
        const role: SurfaceRole = isView && this._surfaceMode === 'editor' ? 'rail' : 'chat';
        const surface: ChatSurface = isView
            ? { webview, role, view: host as vscode.WebviewView }
            : { webview, role, panel: host as vscode.WebviewPanel };
        this._surfaces.push(surface);
        this._log(`Surface added (${kind}/${role}, ${this._surfaces.length} live)`);
        return surface;
    }

    private _removeSurface(surface: ChatSurface): void {
        const index = this._surfaces.indexOf(surface);
        if (index >= 0) {
            this._surfaces.splice(index, 1);
        }
        this._log(`Surface removed (${this._surfaces.length} live)`);
    }

    private _postSurfaceRole(surface: ChatSurface): void {
        // The panel is the conversation only: the rail already lists the chats.
        void surface.webview.postMessage({ type: 'surfaceRole', role: surface.role, hideTabs: !!surface.panel });
    }

    private _postTo(surface: ChatSurface, msg: unknown): void {
        void surface.webview.postMessage(msg);
    }

    /** "Move Chat to Editor" / "Move Chat to Sidebar". */
    public toggleChatSurface(): void {
        this._setSurfaceMode(this._surfaceMode === 'editor' ? 'sidebar' : 'editor');
    }

    private _setSurfaceMode(mode: 'sidebar' | 'editor'): void {
        this._surfaceMode = mode;
        this._log(`Chat surface: ${mode}`);
        void vscode.workspace.getConfiguration('tommys').update('chatSurface', mode, vscode.ConfigurationTarget.Global);
        for (const surface of this._surfaces) {
            if (surface.view) {
                surface.role = mode === 'editor' ? 'rail' : 'chat';
                this._postSurfaceRole(surface);
            }
        }
        if (mode === 'editor') {
            this._openChatPanel();
        } else {
            this._chatPanel?.dispose();
        }
    }

    /** Reveal the chat panel, creating it when there is none. */
    private _openChatPanel(): void {
        const existing = this._chatPanel ?? this._surfaces.find(surface => !!surface.panel)?.panel;
        if (existing) {
            this._chatPanel = existing;
            existing.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            CHAT_PANEL_VIEW_TYPE,
            this._activeTabTitle(),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true,
                localResourceRoots: [this._extensionUri],
            }
        );
        this._chatPanel = panel;
        this._wirePanel(panel);
    }

    private _wirePanel(panel: vscode.WebviewPanel): void {
        const livePanel = this._surfaces.find(surface => !!surface.panel);
        if (livePanel) {
            this._log('Panel already wired; ignoring the duplicate');
            this._chatPanel = livePanel.panel;
            return;
        }
        const surface = this._addSurface(panel.webview, 'panel', panel);
        panel.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
        panel.webview.html = this._getHtml(panel.webview);
        this._wireMessages(panel.webview, surface);
        panel.onDidDispose(() => {
            this._removeSurface(surface);
            if (this._chatPanel === panel) {
                this._chatPanel = undefined;
            }
        });
        this._postSurfaceRole(surface);
    }

    /** Called by the panel serializer so the tab comes back after a reload. */
    public restoreChatPanel(panel: vscode.WebviewPanel): void {
        this._log('Serializer restored the chat panel');
        this._surfaceMode = 'editor';
        this._chatPanel = panel;
        this._wirePanel(panel);
    }

    private _readSurfaceMode(): 'sidebar' | 'editor' {
        return vscode.workspace.getConfiguration('tommys').get<string>('chatSurface') === 'editor'
            ? 'editor'
            : 'sidebar';
    }

    private _activeTabTitle(): string {
        const rec = this._sessions.find(item => item.id === this._sessionId);
        return rec?.title || t('newChat');
    }

    private _updateChatPanelTitle(): void {
        if (!this._chatPanel) {
            return;
        }
        try {
            this._chatPanel.title = this._activeTabTitle();
        } catch { /* panel already disposed */ }
    }

    private _log(msg: string, level?: LogLevel): void {
        const time = new Date().toISOString().slice(11, 19);
        const line = `[${time}] ${msg}`;
        this._output.appendLine(line);
        const resolvedLevel = level ?? classifyLogLevel(msg);
        if (resolvedLevel) {
            this._postWebviewLog(line, resolvedLevel);
        }
    }

    private _postWebviewLog(line: string, level: LogLevel): void {
        this._postMessage({ type: 'log', line, level });
    }

    private _isViewingPromptSession(): boolean {
        return !this._turn.promptSessionId || this._turn.promptSessionId === this._sessionId;
    }

    private _otherSessionIsPrompting(): boolean {
        return this._acp?.status === 'prompting'
            && !!this._turn.promptSessionId
            && this._turn.promptSessionId !== this._sessionId;
    }


    private _snapshotSessionModelFromProfile(sessionId?: string): void {
        const sid = sessionId || this._sessionId;
        const session = this._sessions.find(s => s.id === sid);
        if (!session || session.modelId) {
            return;
        }
        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        if (!profileState.modelId) {
            return;
        }
        session.modelId = profileState.modelId;
        session.modelLabel = profileState.modelLabel;
        try {
            this._saveCatalog();
        } catch { /* ignore */ }
    }

    private async _syncModelStateForCurrentSession(): Promise<void> {
        await this._syncModelState();
        if (this._otherSessionIsPrompting()) {
            return;
        }
        if (this._acpBoundSessionId === this._sessionId) {
            await this._applySessionModelPreference();
        }
    }

    private _resolveSessionModelId(sessionId?: string): { modelId?: string; modelLabel?: string } {
        const sid = sessionId || this._sessionId;
        const session = this._sessions.find(s => s.id === sid);
        if (session?.modelId) {
            return { modelId: session.modelId, modelLabel: session.modelLabel };
        }
        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        return { modelId: profileState.modelId, modelLabel: profileState.modelLabel };
    }

    private _syncPromptUiIfReturningToOwner(): void {
        if (!this._turn.promptSessionId || this._turn.promptSessionId !== this._sessionId) {
            return;
        }
        if (this._acp?.status !== 'prompting') {
            return;
        }
        this._postMessage({ type: 'status', status: 'prompting', sessionId: this._sessionId });
        if (this._turn.lastThoughtText) {
            this._postMessage({
                type: 'addMessage',
                role: 'thought',
                text: this._turn.lastThoughtText,
                sessionId: this._sessionId,
            });
        }
        if (this._turn.lastAssistantText) {
            this._postMessage({
                type: 'addMessage',
                role: 'assistant',
                text: this._turn.lastAssistantText,
                sessionId: this._sessionId,
            });
        }
    }

    /**
     * Bind a fresh ACP connection to a logical session.
     *
     * Replaces the old behaviour where every connect issued `session/new`, so each
     * view reload (and each tab round-trip) left an empty session behind in
     * state.db. Priority: the tab's bound id, then the workspace pointer, then the
     * session `session/new` just created.
     */
    /**
     * Adopt Hermes sessions into the tab list.
     *
     * The extension used to treat its own JSON list as the only truth, so sessions
     * created by the dashboard or TUI were invisible in the sidebar and every
     * reconnect added a throwaway row. `session/list` is the real catalog; local
     * entries become a cache keyed by `hermesSessionId`.
     */
    /**
     * Rebuild the tab list from Hermes' catalog.
     *
     * A tab *is* an unhidden session, so the list is a projection of `sessions.hidden`
     * rather than a second store: nothing here can drift from Hermes, a close is the same
     * operation as an open with a different value, and a session created by the TUI or the
     * dashboard appears without any adoption step.
     */
    private _applyCatalog(rows: CatalogSession[]): void {
        const result = applyCatalogRows({
            previous: this._sessions,
            rows,
            activeId: this._sessionId,
            activeHasMessages: this._sessionMessages.length > 0,
        });
        if (result.activeChanged) {
            // The tab the pane showed is gone from the catalog, so it points at the newest.
            this._sessionId = result.activeId;
            this._sessionMessages = [];
        }
        this._sessions = result.sessions;
        this._hiddenSessions = result.hiddenRows;
        try {
            this._saveCatalog();
        } catch { /* non-critical */ }
        this._postSessionList();
        this._postHiddenSessions();
    }
    /** Read the catalog; null when there is no connection to ask. */
    private async _readCatalog(): Promise<CatalogSession[] | null> {
        const acp = this._acp;
        if (!acp) {
            return null;
        }
        try {
            return await acp.listSessionCatalog();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`session/catalog failed: ${msg}`);
            return null;
        }
    }

    private async _syncSessionsFromHermes(cwd: string): Promise<void> {
        void cwd;
        const rows = await this._readCatalog();
        if (rows) {
            this._applyCatalog(rows);
        }
    }

    /** Refresh the tab list from Hermes, then repaint it. */
    private async _refreshSessionsFromHermes(): Promise<void> {
        await this._syncSessionsFromHermes(this._resolveCwd());
        this._postSessionList();
    }

    private async _resumeOrAdoptSession(cwd: string): Promise<void> {
        const acp = this._acp;
        if (!acp) {
            return;
        }
        await this._syncSessionsFromHermes(cwd);
        const tabBound = this._sessions.find(rec => rec.id === this._sessionId)?.hermesSessionId;
        const target = tabBound || this._persistedHermesSessionId;
        // First run / empty tab: open the most recent Hermes session rather than
        // leaving the throwaway session `session/new` just created in front of the
        // user. This is what makes existing conversations reappear as tabs.
        if (!target && this._sessionMessages.length === 0) {
            const newest = this._sessions.find(rec => !!rec.hermesSessionId);
            if (newest?.hermesSessionId) {
                this._sessionId = newest.id;
                this._sessionMessages = [];
                this._loadHistory();
                this._postMessage({ type: 'newChat' });
                this._renderReplayOnLoad = true;
                try {
                    await acp.loadSession(newest.cwd || cwd, newest.hermesSessionId);
                } finally {
                    this._renderReplayOnLoad = false;
                }
                this._bindHermesSessionId(newest.hermesSessionId);
                this._postSessionList();
                this._log(`Adopted most recent Hermes session ${newest.hermesSessionId}`);
                return;
            }
        }
        if (target && target !== acp.activeSessionId) {
            const targetCwd = this._sessions.find(rec => rec.hermesSessionId === target)?.cwd || cwd;
            try {
                this._renderReplayOnLoad = true;
                try {
                    await acp.loadSession(targetCwd, target);
                } finally {
                    this._renderReplayOnLoad = false;
                }
                this._bindHermesSessionId(target);
                this._log(`Resumed Hermes session ${target}`);
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Resume failed for ${target}: ${msg}`);
            }
        }
        this._bindHermesSessionId(acp.activeSessionId);
    }

    /** Resume one tab's Hermes session; false when the tab has nothing to resume. */
    private async _resumeTabHermesSession(sessionId: string): Promise<boolean> {
        const acp = this._acp;
        const bound = this._sessions.find(rec => rec.id === sessionId)?.hermesSessionId;
        if (!acp || !bound || bound === acp.activeSessionId) {
            return false;
        }
        try {
            const record = this._sessions.find(rec => rec.id === sessionId);
            this._renderReplayOnLoad = true;
            try {
                await acp.loadSession(record?.cwd || this._resolveCwd(), bound);
            } finally {
                this._renderReplayOnLoad = false;
            }
            this._log(`Switched Hermes session to ${bound}`);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`Resume failed for ${bound}: ${msg}`);
            return false;
        }
    }

    /**
     * Render the transcript Hermes replayed for a loaded session.
     *
     * `session/load` streams history as whole-message updates; AcpClient collects
     * them and hands them over once the load resolves. They are cached to the
     * tab's message file so the next switch renders from disk instead of
     * replaying, and only painted when that tab is still the open one.
     */
    private _handleHistoryReplay(hermesSessionId: string, replay: ReplayMessage[]): void {
        const record = this._sessions.find(
            rec => rec.hermesSessionId === hermesSessionId || rec.id === hermesSessionId
        );
        const localId = record?.id || hermesSessionId;
        const messages = buildReplayMessages(replay);
        if (messages.length === 0) {
            return;
        }
        // A send that died between the pane and the agent leaves a user message in the local
        // mirror that Hermes never received. Read it before the replay overwrites the file.
        const undelivered = findUndelivered(lastUserMessageText(this._store.readMessages(localId)), messages);
        // The replay is text-only, so refs are restored from the attachment sidecar: the agent's
        // sequence carries thought and tool records and rewrites this file, so neither position
        // nor the file itself can be trusted to still hold them.
        try {
            const used = new Set<string>();
            for (const msg of messages) {
                if (msg.role !== 'user' || (msg.imageRefs && msg.imageRefs.length)) continue;
                const refs = this._refsFromIndex(msg.text, used, true);
                if (refs.length) {
                    msg.imageRefs = refs;
                }
            }
        } catch { /* the transcript still restores, without the pictures */ }
        this._store.writeReplayedMessages(localId, messages);
        if (record) {
            record.messageCount = messages.length;
            record.agentEngaged = true;
            try {
                this._saveCatalog();
            } catch { /* non-critical */ }
        }
        this._log(`Replayed ${messages.length} messages for session ${localId}`);
        if (!this._renderReplayOnLoad || this._sessionId !== localId) {
            // Cached only: the user is either elsewhere or mid-send in this tab.
            this._postSessionList();
            return;
        }
        this._sessionMessages = messages;
        this._postMessage({ type: 'newChat' });
        this._postMessage({
            type: 'restoreHistory',
            messages: this._hydrateImages(this._sessionMessages),
            localHistoryOnly: false,
        });
        this._offerContextAttach(this._sessionMessages);
        this._postSessionList();
        if (undelivered) {
            this._log(`Undelivered message offered back to the composer: ${localId}`);
            this._postMessage({ type: 'undeliveredMessage', text: undelivered });
        }
    }

    /** Remember which Hermes session backs the current tab and this workspace. */
    private _bindHermesSessionId(hermesSessionId: string): void {
        if (!hermesSessionId) {
            return;
        }
        this._persistedHermesSessionId = hermesSessionId;
        const rec = this._sessions.find(item => item.id === this._sessionId);
        if (rec && rec.hermesSessionId !== hermesSessionId) {
            rec.hermesSessionId = hermesSessionId;
            try {
                this._saveCatalog();
            } catch { /* non-critical */ }
        }
        void this._context.workspaceState.update('hermesSessionId', hermesSessionId);
    }

    /** True when the current tab has a usable Hermes session. */
    private async _ensureAcpReadyForCurrentSession(): Promise<boolean> {
        if (!this._acp) {
            return false;
        }
        if (this._otherSessionIsPrompting()) {
            await this._detachActivePrompt(this._turn.promptSessionId!, { savePartial: true });
        }
        // A tab switch used to force a new ACP session (context reset), which is
        // what littered state.db with empty `acp` rows. Resume the tab's session
        // instead; only a tab that never got one falls through to session/new.
        const bound = this._sessions.find(rec => rec.id === this._sessionId)?.hermesSessionId;
        if (bound && this._acp.activeSessionId !== bound) {
            const record = this._sessions.find(rec => rec.id === this._sessionId);
            try {
                await this._acp.loadSession(record?.cwd || this._resolveCwd(), bound);
                this._log(`Switched Hermes session to ${bound}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Resume failed for ${bound}: ${msg}`);
                this._postMessage({ type: 'addMessage', role: 'assistant', text: t('sessionNotFound', bound) });
                return false;
            }
        } else if (!bound) {
            if (this._sessionMessages.length > 0) {
                // This tab shows a conversation whose Hermes session is gone; creating a new
                // one here would silently replace it, so say so and leave the pane alone.
                this._log(`No Hermes session bound to tab ${this._sessionId}`);
                this._postMessage({ type: 'addMessage', role: 'assistant', text: t('sessionNotFound', this._sessionId) });
                return false;
            }
            // Blank tab: the first message is what creates its session.
            await this._acp.newSession(this._resolveCwd());
            this._bindHermesSessionId(this._acp.activeSessionId);
        }
        await this._applySessionModelPreference();
        this._acpBoundSessionId = this._sessionId;
        return true;
    }

    private _postPromptScopedMessage(msg: Record<string, unknown>): void {
        if (!this._isViewingPromptSession()) {
            return;
        }
        this._postMessage({ ...msg, sessionId: this._sessionId });
    }

    private _clearPromptStallTimer(): void {
        if (this._turn.stallTimer) {
            clearTimeout(this._turn.stallTimer);
            this._turn.stallTimer = undefined;
        }
    }

    private _schedulePromptStallHint(): void {
        this._clearPromptStallTimer();
        this._turn.stallTimer = setTimeout(() => {
            this._turn.stallTimer = undefined;
            if (this._acp?.status !== 'prompting' || !this._isViewingPromptSession()) {
                return;
            }
            if (this._turn.lastAssistantText || this._turn.lastThoughtText) {
                return;
            }
            this._log('Prompt stall hint: Hermes still initializing');
            this._postMessage({
                type: 'status',
                status: 'prompting',
                message: localizeStatusMessage('Hermes is initializing...'),
                sessionId: this._sessionId,
            });
        }, 25000);
    }

    private async _detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void> {
        if (!this._turn.promptSessionId || this._turn.promptSessionId !== fromSessionId) {
            return;
        }
        if (this._acp?.status !== 'prompting') {
            this._turn.promptSessionId = undefined;
            this._turn.lastAssistantText = '';
            this._turn.lastThoughtText = '';
            return;
        }

        this._log(`Detaching in-flight prompt from session ${fromSessionId}`);
        if (options?.savePartial !== false) {
            this._flushThoughtToHistory();
            if (this._turn.lastAssistantText.trim()) {
                this._saveMessage('assistant', this._turn.lastAssistantText);
            }
        }
        this._turn.lastAssistantText = '';
        this._turn.lastThoughtText = '';
        this._turn.sendEpoch++;
        this._cancelPendingPermissions();
        await this._acp?.cancel();
        this._turn.promptSessionId = undefined;
    }

    private _restoreMessages(target?: ChatSurface): void {
        if (this._sessionMessages.length === 0) return;
        this._log(`Restoring ${this._sessionMessages.length} messages`);
        const msg = {
            type: 'restoreHistory',
            messages: this._hydrateImages(this._sessionMessages),
            localHistoryOnly: true,
        };
        if (target) {
            this._postTo(target, msg);
        } else {
            this._postMessage(msg);
        }
        this._offerContextAttach(this._sessionMessages);
    }

    private _offerContextAttach(messages: ChatMessage[]): void {
        if (this._getContextAttachVisibility() === 'never') {
            this._clearContextAttachOffer();
            return;
        }
        const hasHistory = messages.some(m => (m.text || '').trim());
        if (!hasHistory) {
            this._clearContextAttachOffer();
            return;
        }
        this._contextAttachMessages = filterAttachableMessages(messages);
        this._contextAttachActive = true;
        this._postMessage({ type: 'showContextAttach', count: this._contextAttachMessages.length });
    }

    private _getContextAttachVisibility(): ContextAttachVisibility {
        const value = vscode.workspace.getConfiguration('tommys').get<string>('contextAttachVisibility', 'onNewSession');
        if (value === 'always' || value === 'never') {
            return value;
        }
        return 'onNewSession';
    }

    private _applyContextAttachVisibility(): void {
        const mode = this._getContextAttachVisibility();
        if (mode === 'never') {
            this._clearContextAttachOffer();
            return;
        }
        if (mode === 'always') {
            this._offerContextAttach(this._sessionMessages);
            return;
        }
        if (this._contextAttachActive && !this._contextAttachAwaitingReply) {
            this._clearContextAttachOffer();
        }
    }

    private _clearContextAttachOffer(): void {
        if (!this._contextAttachActive && !this._contextAttachAwaitingReply) {
            return;
        }
        this._contextAttachActive = false;
        this._contextAttachAwaitingReply = false;
        this._contextAttachMessages = [];
        this._postMessage({ type: 'hideContextAttach' });
    }

    private _buildPromptText(userText: string, option: ContextAttachOption | undefined): string {
        if (!this._contextAttachActive) {
            return userText;
        }
        const attachOption: ContextAttachOption = option?.mode
            ? option
            : { mode: 'none' };
        const picked = attachOption.mode === 'custom'
            ? resolveCustomAttachMessages(this._sessionMessages, attachOption.indices)
            : resolveAttachMessages(this._contextAttachMessages, attachOption);
        if (picked.length === 0) {
            return userText;
        }
        return composePromptWithContext(userText, picked, getWebviewLocale());
    }

    private _completeContextAttachAfterSuccessfulReply(): void {
        if (!this._contextAttachAwaitingReply) {
            return;
        }
        this._contextAttachAwaitingReply = false;
        if (this._getContextAttachVisibility() === 'always') {
            return;
        }
        this._clearContextAttachOffer();
    }

    private _saveMessage(role: string, text: string, toolCallId?: string, imageRefs?: StoredImageRef[]): void {
        const record: ChatMessage = { role, text, timestamp: Date.now(), toolCallId };
        if (imageRefs && imageRefs.length) {
            record.imageRefs = imageRefs;
        }
        this._sessionMessages.push(record);
        this._persistMessages();
    }

    /**
     * Attachments are bytes Hermes never stores, so the pane keeps them: content-addressed
     * files beside the transcript, hashes recorded on the message. The same screenshot twice
     * costs one file.
     */
    private _storeImages(images: Array<{ mimeType?: string; data?: string }>): StoredImageRef[] {
        const dir = path.join(this._historyDir, 'attachments');
        const refs: StoredImageRef[] = [];
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            return refs;
        }
        for (const img of images) {
            if (!img || !img.data) continue;
            const hash = createHash('sha256').update(img.data).digest('hex').slice(0, 32);
            const mimeType = img.mimeType || 'image/png';
            const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
            try {
                const file = path.join(dir, `${hash}.${ext}`);
                if (!fs.existsSync(file)) {
                    fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
                }
                refs.push({ hash, mimeType });
            } catch { /* the message still sends without the local copy */ }
        }
        return refs;
    }

    /** Attachment hashes back to what the webview renders, for the transcript being posted. */
    private _hydrateImages(messages: ChatMessage[]): ChatMessage[] {
        const dir = path.join(this._historyDir, 'attachments');
        const used = new Set<string>();
        return messages.map(msg => {
            let refs = msg.imageRefs;
            if ((!refs || !refs.length) && msg.role === 'user') {
                refs = this._refsFromIndex(msg.text, used);
            }
            if (!refs || !refs.length) return msg;
            const images = refs.map(ref => {
                const ext = ref.mimeType === 'image/jpeg' ? 'jpg' : ref.mimeType === 'image/webp' ? 'webp' : 'png';
                try {
                    const buf = fs.readFileSync(path.join(dir, `${ref.hash}.${ext}`));
                    return { mimeType: ref.mimeType, data: buf.toString('base64') };
                } catch {
                    return null;
                }
            }).filter(Boolean) as Array<{ mimeType: string; data: string }>;
            return { ...msg, images } as ChatMessage;
        });
    }

    /**
     * The replay is text-only and rewrites the transcript file, so refs stored on a record can
     * be lost. This sidecar is written on send and never rewritten by a replay.
     */
    private _attachmentIndexPath(): string {
        return path.join(this._historyDir, 'attachments', 'index.json');
    }

    private _loadAttachmentIndex(): Array<{ hash: string; mimeType: string; key: string; markers: number; added: number }> {
        try {
            const parsed = JSON.parse(fs.readFileSync(this._attachmentIndexPath(), 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private _indexAttachments(refs: StoredImageRef[], text: string): void {
        if (!refs.length) return;
        try {
            fs.mkdirSync(path.dirname(this._attachmentIndexPath()), { recursive: true });
            const entries = this._loadAttachmentIndex();
            const key = attachmentKey(text);
            const markers = markerCount(text) || refs.length;
            for (const ref of refs) {
                if (entries.some(e => e.hash === ref.hash && e.key === key)) continue;
                entries.push({ hash: ref.hash, mimeType: ref.mimeType, key, markers, added: Date.now() });
            }
            fs.writeFileSync(this._attachmentIndexPath(), JSON.stringify(entries.slice(-400), null, 2));
        } catch { /* the message still sends */ }
    }

    /** Attachments for a message that carries no refs: exact key first, then by order. */
    private _refsFromIndex(text: string, used: Set<string>, allowLoose = false): StoredImageRef[] {
        const entries = this._loadAttachmentIndex();
        if (!entries.length) return [];
        const key = attachmentKey(text);
        const wanted = Math.max(1, markerCount(text));
        const taken: StoredImageRef[] = [];
        for (const entry of entries) {
            if (taken.length >= wanted) break;
            if (used.has(entry.hash) || entry.key !== key) continue;
            used.add(entry.hash);
            taken.push({ hash: entry.hash, mimeType: entry.mimeType });
        }
        if (taken.length) return taken;
        // Text drifted between send and replay: fall back to the oldest unused attachment. Only a
        // replay may do that — a restore shows history and must not guess.
        if (!allowLoose || !markerCount(text)) return [];
        const loose = entries.find(entry => !used.has(entry.hash));
        if (loose) {
            used.add(loose.hash);
            return [{ hash: loose.hash, mimeType: loose.mimeType }];
        }
        return [];
    }

    private _upsertToolMessage(toolCallId: string, text: string): void {
        const stored = this._findToolMessage(toolCallId);
        if (stored) {
            if (stored.aggregatedTools?.length) {
                const entry = stored.aggregatedTools.find(t => t.toolCallId === toolCallId);
                if (entry) {
                    entry.text = text;
                }
                stored.text = rebuildAggregatedToolText(stored.aggregatedTools);
            } else {
                stored.text = text;
            }
            stored.timestamp = Date.now();
            this._persistMessages();
            return;
        }

        const last = this._sessionMessages[this._sessionMessages.length - 1];
        if (last?.role === 'tool' && canAggregateToolTexts(last.text, text)) {
            if (!last.aggregatedTools?.length) {
                last.aggregatedTools = [{
                    toolCallId: last.toolCallId || `tool_${last.timestamp}`,
                    text: last.text,
                }];
                delete last.toolCallId;
            }
            last.aggregatedTools.push({ toolCallId, text });
            last.text = rebuildAggregatedToolText(last.aggregatedTools);
            last.timestamp = Date.now();
            this._persistMessages();
            return;
        }

        this._saveMessage('tool', text, toolCallId);
    }

    private _findToolMessage(toolCallId: string): ChatMessage | undefined {
        return this._sessionMessages.find(m => {
            if (m.role !== 'tool') {
                return false;
            }
            if (m.toolCallId === toolCallId) {
                return true;
            }
            return m.aggregatedTools?.some(t => t.toolCallId === toolCallId) ?? false;
        });
    }

    private _flushThoughtToHistory(): void {
        const text = this._turn.lastThoughtText.trim();
        if (!text) {
            return;
        }
        this._saveMessage('thought', text);
        this._turn.lastThoughtText = '';
    }

    private _persistMessages(): void {
        if (this._store.writeMessages(this._sessionId, this._sessionMessages)) {
            this._saveCurrentSession();
        }
    }

    private _permissionBodyText(title?: string, detail?: string): string {
        const parts: string[] = [];
        if (title?.trim()) {
            parts.push(title.trim());
        }
        if (detail?.trim()) {
            parts.push(detail.trim());
        }
        return parts.join('\n\n');
    }

    private _savePermissionRequest(id: string, request: PermissionRequest): void {
        this._sessionMessages.push({
            role: 'permission',
            text: this._permissionBodyText(request.title, request.detail),
            timestamp: Date.now(),
            permissionId: id,
            title: request.title,
            detail: request.detail,
            options: request.options.map(o => ({
                optionId: o.optionId,
                name: o.name,
                kind: o.kind,
            })),
            resolved: false,
        });
        this._persistMessages();
    }

    private _resolvePermissionHistory(
        id: string,
        outcome: 'selected' | 'cancelled',
        selectedOptionId?: string,
        selectedLabel?: string
    ): void {
        const stored = this._sessionMessages.find(m => m.permissionId === id && m.role === 'permission');
        if (!stored) {
            return;
        }
        stored.resolved = true;
        stored.outcome = outcome;
        stored.selectedOptionId = selectedOptionId;
        stored.selectedLabel = selectedLabel;
        if (outcome === 'selected' && selectedLabel) {
            stored.text = `${stored.text}\n\n${t('permissionSelected', selectedLabel)}`;
        } else if (outcome === 'cancelled') {
            stored.text = `${stored.text}\n\n${t('permissionCancelled')}`;
        }
        this._persistMessages();
    }

    private _loadHistory(): void {
        const messages = this._store.readMessages(this._sessionId);
        if (messages.length) {
            this._sessionMessages = messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            this._log(`Loaded ${this._sessionMessages.length} messages from history`);
            return;
        }
        this._sessionMessages = [];
    }

    private _saveCurrentSession(): void {
        const firstUser = this._sessionMessages.find(m => m.role === 'user')?.text.slice(0, 40);
        const existing = this._sessions.find(s => s.id === this._sessionId);
        if (existing) {
            existing.updatedAt = Date.now();
            existing.messageCount = this._sessionMessages.length;
            // Hermes owns the title of any session it knows about: the catalog supplies it,
            // and this cache must not overwrite it with the first user message (which here is
            // usually the injected memory preamble). Only a purely local chat, which Hermes
            // has never seen, derives a title from its own text.
            if (firstUser && !existing.hermesSessionId) {
                existing.title = firstUser;
            }
        } else {
            this._sessions.unshift({
                id: this._sessionId,
                title: firstUser || t('newChat'),
                createdAt: parseInt(this._sessionId, 36) || Date.now(),
                updatedAt: Date.now(),
                messageCount: this._sessionMessages.length,
            });
        }
        try {
            if (this._saveCatalog()) {
                this._saveActiveSession();
            }
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _ensureSessionRegistered(): void {
        const firstUser = this._sessionMessages.find(m => m.role === 'user')?.text.slice(0, 40);
        const next = registerSession(this._sessions, {
            id: this._sessionId,
            title: firstUser || t('newChat'),
            messageCount: this._sessionMessages.length,
        });
        if (next === this._sessions) {
            return;
        }
        this._sessions = next;
        try {
            this._saveCatalog();
        } catch { /* non-critical */ }
    }

    private _postSessionList(): void {
        this._updateChatPanelTitle();
        this._postMessage({
            type: 'sessionList',
            sessions: this._sessions,
            activeSessionId: this._sessionId,
        });
    }

    private _postHiddenSessions(): void {
        this._postMessage({
            type: 'hiddenSessions',
            sessions: this._hiddenSessions,
        });
    }

    /**
     * One write point for the session catalog: the same 50-record snapshot was assembled in
     * eleven places, and the store that owns this file needs a single seam to cut along.
     * Returns whether the write happened, for the one caller that does more on success.
     */
    private _saveCatalog(): boolean {
        return this._store.writeCatalog(this._sessions);
    }

    private _loadSessions(): void {
        this._sessions = this._store.readCatalog();
        for (const session of this._sessions) {
            this._backfillAgentEngaged(session);
        }
        this._normalizePinnedOrder();
    }

    private _normalizePinnedOrder(): void {
        this._sessions = normalizePinnedOrder(this._sessions);
    }

    private _backfillAgentEngaged(session: SessionInfo): void {
        if (session.agentEngaged !== undefined) {
            return;
        }
        try {
            // The transcript is the only evidence of whether the agent ever answered here.
            backfillAgentEngaged(session, this._store.readMessages(session.id));
        } catch {
            session.agentEngaged = false;
        }
    }

    private _markSessionAgentEngaged(): void {
        if (!markAgentEngaged(this._sessions, this._sessionId)) {
            return;
        }
        try {
            this._saveCatalog();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _resolveConnectionTarget(selectionId?: string): ConnectionTarget {
        const config = vscode.workspace.getConfiguration('tommys');
        const configPath = config.get<string>('path') || undefined;
        const configCwd = config.get<string>('cwd') || undefined;
        const configProfile = config.get<string>('profile') || undefined;
        const agents = this._readAgentConfigs();

        if (agents.length > 0) {
            const resolvedId = selectionId || this._activeSelectionId || agents[0].name;
            const agent = agents.find(a => a.name === resolvedId) || agents[0];
            return {
                scopeKey: sanitizeProfileScopeKey(agent.name),
                selectionId: agent.name,
                displayName: agent.name,
                cliProfile: normalizeHermesCliProfile(agent.profile ?? configProfile),
                configPath: agent.path || configPath,
                configCwd: agent.cwd || configCwd,
            };
        }

        const resolvedId = selectionId || this._activeSelectionId || normalizeHermesCliProfile(configProfile);
        const cliProfile = normalizeHermesCliProfile(resolvedId);
        return {
            scopeKey: scopeKeyForCliProfile(cliProfile),
            selectionId: cliProfile,
            displayName: this._profileLabelFor(cliProfile),
            cliProfile,
            configPath,
            configCwd,
        };
    }

    private _profileLabelFor(cliProfile: string): string {
        return normalizeHermesCliProfile(cliProfile) === 'default'
            ? t('defaultAgent')
            : cliProfile;
    }

    private _bindProfileScope(scopeKey: string): void {
        if (scopeKey === this._scopeKey) {
            return;
        }
        this._saveCurrentSession();
        this._scopeKey = scopeKey;
        this._store.setScope(scopeKey);
        this._sessions = [];
        this._loadSessions();
        this._sessionId = this._restoreActiveSession();
        this._sessionMessages = [];
        this._loadHistory();
        this._ensureSessionRegistered();
        this._postSessionList();
    }

    private async _ensureDiscoveredProfiles(): Promise<void> {
        if (this._readAgentConfigs().length > 0) {
            this._discoveredProfiles = null;
            return;
        }
        if (this._discoveredProfiles) {
            return;
        }
        if (this._profileDiscoveryPromise) {
            await this._profileDiscoveryPromise;
            return;
        }
        this._profileDiscoveryPromise = (async () => {
            const config = vscode.workspace.getConfiguration('tommys');
            const hermesPath = config.get<string>('path') || undefined;
            try {
                this._discoveredProfiles = await discoverHermesProfiles(hermesPath);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Profile discovery failed: ${msg}`);
                this._discoveredProfiles = ['default'];
            }
        })();
        try {
            await this._profileDiscoveryPromise;
        } finally {
            this._profileDiscoveryPromise = undefined;
        }
    }

    private _getProfileEntries(): ProfileListEntry[] {
        const agents = this._readAgentConfigs();
        if (agents.length > 0) {
            return agents.map(a => ({ id: a.name, label: a.name }));
        }
        const profiles = this._discoveredProfiles ?? ['default'];
        return profiles.map(p => ({
            id: p,
            label: this._profileLabelFor(p),
        }));
    }

    private async _syncModelState(options?: { skipModelOptions?: boolean }): Promise<void> {
        if (!this._acp) {
            this._modelState = this._buildFallbackModelList();
            this._postModelList();
            return;
        }

        const agentState = this._acp.getModelListState();
        const hermesModelsRaw = this._acp.getHermesModelsRaw();
        let modelOptions = options?.skipModelOptions
            ? null
            : await this._acp.fetchModelOptions();
        if (!modelOptions?.providers?.length) {
            modelOptions = this._acp.getCachedModelOptions();
        }
        const catalog = resolveModelCatalog(modelOptions, hermesModelsRaw);
        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        const session = this._sessions.find(s => s.id === this._sessionId);
        const config = vscode.workspace.getConfiguration('tommys');
        const settingsModels = config.get<Array<{ id: string; name: string }>>('models') || [];

        if (catalog?.groups.length) {
            this._modelState = buildModelListStateFromCatalog(catalog, agentState, {
                modelId: session?.modelId || profileState.modelId,
                modelLabel: session?.modelLabel || profileState.modelLabel,
                settingsModels,
            });
        } else if (agentState) {
            this._modelState = agentState;
        } else {
            this._modelState = this._buildFallbackModelList();
        }
        this._postModelList();
    }

    private async _connect(selectionId?: string): Promise<void> {
        if (this._acp) {
            const status = this._acp.status;
            if (status !== 'idle' && status !== 'error') {
                return;
            }
            // The process is gone but the object lingered: reconnect instead of staying dead.
            this._acp.dispose();
            this._acp = undefined;
        }
        if (this._connectPromise) {
            await this._connectPromise;
            return;
        }

        this._connectPromise = this._connectInner(selectionId);
        try {
            await this._connectPromise;
        } finally {
            this._connectPromise = undefined;
        }
    }

    private async _connectInner(selectionId?: string): Promise<void> {
        const target = this._resolveConnectionTarget(selectionId);
        if (target.scopeKey !== this._scopeKey) {
            this._bindProfileScope(target.scopeKey);
        }
        this._activeSelectionId = target.selectionId;
        this._activeAgentName = target.displayName;

        this._log(`Connecting as ${target.displayName} (profile=${target.cliProfile})...`);
        this._postMessage({ type: 'activeAgent', name: target.displayName });

        const cwd = this._resolveCwd(target.configCwd);

        this._postMessage({
            type: 'status',
            status: 'connecting',
            message: localizeStatusMessage('Loading profile & session...'),
        });

        const quickPath = await tryResolveHermesQuick(target.configPath);
        let resolvedPath: string | undefined;
        if (quickPath) {
            this._log(`Hermes resolved without full detection: ${quickPath}`);
            resolvedPath = quickPath;
        } else {
            const report = await this._runEnvironmentDetectionWithUi(target.configPath, 'connect');
            if (report.status === 'cancelled') {
                this._log('Connect cancelled during environment detection');
                this._postMessage({
                    type: 'status',
                    status: 'disconnected',
                    message: t('detectEnvironmentCancelled'),
                });
                return;
            }
            resolvedPath = this._pickBestExecutable(report);
            if (this._shouldOfferHermesConfiguration(report)) {
                const configuredPath = await this._autoConfigureHermesPlugin(report);
                if (configuredPath) {
                    resolvedPath = configuredPath;
                }
            }
            if (!resolvedPath) {
                const msg = report.status === 'broken'
                    ? formatDetectBrokenMessage(report)
                    : t('detectEnvironmentNotFound');
                this._log(`Connect failed: ${msg}`);
                this._postMessage({ type: 'status', status: 'error', message: msg });
                return;
            }
        }

        this._acp = new AcpClient(
            (role, text, toolCallId) => {
                if (role === 'assistant' || role === 'thought' || role === 'tool') {
                    this._clearPromptStallTimer();
                }
                this._postPromptScopedMessage({ type: 'addMessage', role, text, toolCallId });
                // Late events, after a cancel or a detach, arrive with no prompt session:
                // drop them rather than writing them anywhere.
                if (!this._turn.promptSessionId) {
                    return;
                }
                if (role === 'user') {
                    this._saveMessage('user', text);
                }
                if (role === 'assistant') {
                    this._turn.lastAssistantText = text;
                }
                if (role === 'thought') {
                    this._turn.lastThoughtText = text;
                }
                if (role === 'tool' && toolCallId) {
                    this._upsertToolMessage(toolCallId, text);
                } else if (role === 'tool') {
                    this._saveMessage('tool', text);
                }
            },
            (status, msg) => {
                this._log(`Status: ${status}${msg ? ' — ' + msg : ''}`);
                if (status === 'ready' && this._deferReadyUntilSessionSetup) {
                    return;
                }
                if (this._isViewingPromptSession()) {
                    this._postMessage({
                        type: 'status',
                        status,
                        message: msg ? localizeStatusMessage(msg) : undefined,
                        sessionId: this._sessionId,
                    });
                }
                if (status === 'ready') {
                    this._reconnectAttempts = 0;
                    this._clearPromptStallTimer();
                    if (this._turn.promptSessionId) {
                        this._flushThoughtToHistory();
                        if (this._turn.lastAssistantText) {
                            this._saveMessage('assistant', this._turn.lastAssistantText);
                        }
                    }
                    this._turn.lastAssistantText = '';
                    this._turn.lastThoughtText = '';
                    this._turn.promptSessionId = undefined;
                    if (this._isViewingPromptSession()) {
                        this._completeContextAttachAfterSuccessfulReply();
                    }
                }
                if (status === 'prompting') {
                    this._turn.lastAssistantText = '';
                    this._turn.lastThoughtText = '';
                    this._schedulePromptStallHint();
                }
            },
            async (request) => this._requestPermissionInChat(request),
            () => {
                this._log('Connection lost');
                this._cancelPendingPermissions();
                this._tokenUsage = null;
                this._postTokenUsage();
                this._acp = undefined;
                this._postMessage({
                    type: 'status',
                    status: 'error',
                    message: t('connectionLostRetrying'),
                });
                void this._reconnectAfterLoss();
            },
            {
                readTextFile: async (p: string) => {
                    this._log(`fs.readTextFile: ${p}`);
                    if (!this._isPathAllowed(p)) {
                        throw new Error(`Access denied: '${p}' is outside workspace folders`);
                    }
                    const uri = vscode.Uri.file(p);
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    return new TextDecoder().decode(bytes);
                },
                writeTextFile: async (p: string, content: string) => {
                    this._log(`fs.writeTextFile: ${p} (${content.length} chars)`);
                    if (!this._isPathAllowed(p)) {
                        throw new Error(`Access denied: '${p}' is outside workspace folders`);
                    }
                    const uri = vscode.Uri.file(p);
                    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
                },
            },
            (cmd: string, args: string[], cwd: string) => {
                this._log(`Terminal: ${cmd.slice(0, 80)}`);
                const fullCmd = args.length > 0 ? cmd + ' ' + args.join(' ') : cmd;
                const terminal = vscode.window.createTerminal({
                    name: `Hermes: ${cmd.slice(0, 30)}`,
                    cwd,
                });
                terminal.sendText(fullCmd);
                terminal.show(false);
            },
            (usage) => {
                if (!this._isViewingPromptSession()) {
                    return;
                }
                this._tokenUsage = usage;
                this._postTokenUsage();
            },
            () => {
                void this._syncModelState({ skipModelOptions: true });
            },
            () => {
                if (!this._isViewingPromptSession()) {
                    return;
                }
                this._flushThoughtToHistory();
                this._postMessage({ type: 'finishAssistantBubble', sessionId: this._sessionId });
            },
            (cwd) => {
                const servers = resolveMcpServersForSession(cwd);
                if (servers.length > 0) {
                    this._log(`Forwarding ${servers.length} MCP server(s) to Hermes: ${servers.map(s => s.name).join(', ')}`);
                }
                return servers;
            },
            (sessionId, messages) => {
                this._handleHistoryReplay(sessionId, messages);
            }
        );
        this._acp.onLog = (line: string) => {
            const level = classifyLogLevel(line);
            if (level) {
                this._postWebviewLog(line, level);
            }
        };
        this._deferReadyUntilSessionSetup = true;
        try {
            await this._acp.start(cwd, resolvedPath, target.cliProfile);
            await this._resumeOrAdoptSession(cwd);
            await this._syncModelState({ skipModelOptions: true });
            await this._applySessionModelPreference();
            await this._syncModelState();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`Connect failed: ${msg}`);
            this._acp?.dispose();
            this._acp = undefined;
        } finally {
            this._deferReadyUntilSessionSetup = false;
            if (this._acp) {
                this._acpBoundSessionId = this._sessionId;
            }
            if (this._acp?.status === 'ready') {
                this._postMessage({ type: 'status', status: 'ready' });
            }
        }
    }

    private _enqueueChatOp(op: () => Promise<void>): void {
        this._chatOpChain = this._chatOpChain
            .then(op)
            .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Chat operation failed: ${msg}`);
            });
    }

    private async _awaitSessionReady(): Promise<void> {
        if (this._connectPromise) {
            await this._connectPromise.catch(() => {});
        }
    }

    private _requestPermissionInChat(request: PermissionRequest): Promise<string | null> {
        this._log(`Permission requested: ${request.title.slice(0, 80)}`);
        return new Promise((resolve) => {
            const id = `perm_${++this._permissionCounter}`;
            this._pendingPermissions.set(id, resolve);
            this._savePermissionRequest(id, request);
            this._postMessage({
                type: 'permissionRequest',
                id,
                title: request.title,
                detail: request.detail,
                options: request.options,
            });
        });
    }

    private _handlePermissionResponse(id: string, optionId: string | null): void {
        const pending = this._pendingPermissions.get(id);
        if (!pending) {
            return;
        }
        this._pendingPermissions.delete(id);
        if (optionId) {
            const stored = this._sessionMessages.find(m => m.permissionId === id && m.role === 'permission');
            const opt = stored?.options?.find(o => o.optionId === optionId);
            const label = opt
                ? resolvePermissionOptionLabel(getWebviewLocale(), opt)
                : optionId;
            this._log(`Permission approved: ${optionId}`);
            this._resolvePermissionHistory(id, 'selected', optionId, label);
            pending(optionId);
            return;
        }
        this._log('Permission cancelled');
        this._resolvePermissionHistory(id, 'cancelled');
        pending(null);
    }

    private _cancelPendingPermissions(): void {
        if (this._pendingPermissions.size === 0) {
            return;
        }
        for (const [id, resolve] of this._pendingPermissions) {
            this._resolvePermissionHistory(id, 'cancelled');
            resolve(null);
            this._postMessage({ type: 'permissionDismiss', id });
        }
        this._pendingPermissions.clear();
    }

    /** One automatic reconnect after the process dies; the Retry button covers the rest. */
    private async _reconnectAfterLoss(): Promise<void> {
        if (this._disposed || this._reconnectAttempts >= 1) {
            return;
        }
        this._reconnectAttempts++;
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (this._disposed || this._acp) {
            return;
        }
        this._log('Reconnecting after connection loss');
        await this._connect(this._activeSelectionId || undefined);
        this._restoreMessages();
    }

    private async _handleRetry(): Promise<void> {
        this._log('Retry connection requested');
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();
        await this._connect(this._activeSelectionId || undefined);
    }

    private _resetViewTitleToDefault(): void {
        if (!this._view) {
            return;
        }
        this._view.title = undefined;
        this._view.description = undefined;
    }

    private _setDetectContext(inProgress: boolean, reportAvailable: boolean): void {
        this._detectInProgress = inProgress;
        void vscode.commands.executeCommand('setContext', 'tommysDetectInProgress', inProgress);
        void vscode.commands.executeCommand('setContext', 'tommysDetectReportAvailable', reportAvailable);
    }

    private _handleDetectEnvironmentDismiss(): void {
        if (this._detectInProgress && this._detectAbortController) {
            this._detectAbortController.abort();
            this._log('Environment detection cancelled by user');
        }
    }

    private _postDetectProgress(event: HermesDetectProgressEvent): void {
        const brief = formatDetectProgressPercent(event, this._detectStepOrder);
        this._postMessage({
            type: 'detectEnvironmentProgress',
            step: event.step,
            status: event.status,
            brief,
            detail: event.detail,
            paths: event.paths,
            count: event.count,
            verifiedCount: event.verifiedCount,
            totalCount: event.totalCount,
            reportStatus: event.reportStatus,
        });
    }

    private _clearViewDetectProgress(): void {
        this._resetViewTitleToDefault();
        this._detectStepLog = [];
        this._lastDetectReport = undefined;
        this._setDetectContext(false, false);
    }

    private _recordDetectStep(event: HermesDetectProgressEvent): void {
        const entry: DetectStepLogEntry = {
            step: event.step,
            label: detectStepLabel(event.step),
            detail: formatDetectStepDetail(event),
            status: event.status,
        };
        const index = this._detectStepLog.findIndex((item) => item.step === event.step);
        if (index >= 0) {
            this._detectStepLog[index] = entry;
        } else {
            this._detectStepLog.push(entry);
        }
    }

    private async _runEnvironmentDetectionWithUi(
        configuredPath?: string,
        mode: 'connect' | 'manual' | 'configure' = 'manual',
    ): Promise<HermesEnvironmentReport> {
        this._detectStepLog = [];
        this._detectAbortController?.abort();
        this._detectAbortController = new AbortController();
        const signal = this._detectAbortController.signal;
        const useConfigurePanel = mode === 'configure';
        if (!useConfigurePanel) {
            this._setDetectContext(true, !!this._lastDetectReport);
            this._postMessage({ type: 'detectEnvironmentStart', mode });
        } else {
            this._setDetectContext(true, !!this._lastDetectReport);
            this._postMessage({ type: 'configureEnvironmentDetectStart' });
        }

        const report = await detectHermesEnvironment(configuredPath, {
            signal,
            onProgress: (event) => {
                if (useConfigurePanel) {
                    this._postConfigureDetectProgress(event);
                } else {
                    this._postDetectProgress(event);
                }
                this._recordDetectStep(event);
            },
        });
        this._detectAbortController = undefined;

        if (report.status === 'cancelled') {
            this._setDetectContext(false, false);
            if (useConfigurePanel) {
                this._postMessage({ type: 'configureEnvironmentDetectEnd', status: 'cancelled' });
            }
            return report;
        }

        this._logEnvironmentReport(report);
        this._lastDetectReport = report;
        const summaryStatus: HermesDetectStepStatus = report.status === 'ready' ? 'ok' : 'fail';
        const summaryText = formatDetectSummaryForReport(report);
        const summaryEvent: HermesDetectProgressEvent = {
            step: 'summary',
            status: summaryStatus,
            reportStatus: report.status,
            detail: summaryText,
        };
        this._recordDetectStep(summaryEvent);
        if (useConfigurePanel) {
            this._postConfigureDetectProgress(summaryEvent);
            this._postMessage({
                type: 'configureEnvironmentDetectEnd',
                status: report.status,
                summary: summaryText,
                executables: this._serializeConfigureExecutables(report.executables),
            });
        } else {
            this._postDetectProgress(summaryEvent);
            this._postMessage({
                type: 'detectEnvironmentEnd',
                status: report.status,
                mode,
                brief: '100%',
                summaryStatus,
            });
        }
        this._setDetectContext(false, true);
        return report;
    }

    public async detectEnvironment(): Promise<void> {
        if (this._detectInProgress) {
            return;
        }
        this._log('Environment detection requested');
        const config = vscode.workspace.getConfiguration('tommys');
        const configuredPath = config.get<string>('path') || undefined;
        const report = await this._runEnvironmentDetectionWithUi(configuredPath, 'manual');

        if (report.status === 'cancelled') {
            return;
        }
        if (report.status === 'not_found') {
            await vscode.window.showErrorMessage(t('detectEnvironmentNotFound'));
            return;
        }
        if (report.status === 'broken') {
            await vscode.window.showErrorMessage(formatDetectBrokenMessage(report));
            return;
        }
    }

    public configureEnvironment(): void {
        if (this._detectInProgress) {
            return;
        }
        const config = vscode.workspace.getConfiguration('tommys');
        const systemEnv = this._getSystemPathEnvInfo();
        this._postMessage({
            type: 'configureEnvironmentOpen',
            currentPath: config.get<string>('path') || '',
            systemEnvVar: systemEnv.varName,
            systemEnvTarget: systemEnv.varTarget,
        });
    }

    private _getSystemPathEnvInfo(): { varName: string; varTarget: string } {
        if (process.platform === 'win32') {
            return {
                varName: 'Path',
                varTarget: t('detectEnvironmentSystemVarTargetWindows'),
            };
        }
        return {
            varName: 'PATH',
            varTarget: t('detectEnvironmentSystemVarTargetUnix'),
        };
    }

    private _postConfigureDetectProgress(event: HermesDetectProgressEvent): void {
        const brief = formatDetectProgressPercent(event, this._detectStepOrder);
        this._postMessage({
            type: 'configureEnvironmentDetectProgress',
            step: event.step,
            status: event.status,
            brief,
            detail: event.detail,
            paths: event.paths,
            count: event.count,
            verifiedCount: event.verifiedCount,
            totalCount: event.totalCount,
            reportStatus: event.reportStatus,
        });
    }

    private _serializeConfigureExecutables(
        executables: HermesExecutableCandidate[],
    ): Array<{ path: string; source: string; verified: boolean; version?: string }> {
        return executables.map((item) => ({
            path: item.path,
            source: this._detectSourceLabel(item.source),
            verified: item.verified,
            version: item.version,
        }));
    }

    private async _handleConfigureEnvironmentBrowse(): Promise<void> {
        const picked = await this._browseHermesExecutable();
        this._postMessage({
            type: 'configureEnvironmentBrowseResult',
            path: picked,
            error: picked ? undefined : t('configureEnvironmentInvalidPath'),
        });
    }

    private async _browseHermesExecutable(): Promise<string | undefined> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            title: t('configureEnvironmentBrowseTitle'),
            filters: process.platform === 'win32'
                ? { Executable: ['exe', 'cmd', 'bat'] }
                : undefined,
        });
        if (!picked?.[0]) {
            return undefined;
        }
        return this._resolveHermesFromBrowseSelection(picked[0].fsPath);
    }

    private async _resolveHermesFromBrowseSelection(fsPath: string): Promise<string | undefined> {
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(fsPath);
        } catch {
            return undefined;
        }
        if (stat.isFile()) {
            return (await accessExecutable(fsPath)) ? fsPath : undefined;
        }
        if (!stat.isDirectory()) {
            return undefined;
        }
        const exeName = process.platform === 'win32' ? 'hermes.exe' : 'hermes';
        const direct = path.join(fsPath, exeName);
        if (await accessExecutable(direct)) {
            return direct;
        }
        for (const candidate of venvHermesCandidates(fsPath)) {
            if (await accessExecutable(candidate)) {
                return candidate;
            }
        }
        if (path.basename(fsPath) === 'hermes-agent') {
            const venvCandidates = process.platform === 'win32'
                ? [
                    path.join(fsPath, 'venv', 'Scripts', 'hermes.exe'),
                    path.join(fsPath, 'venv', 'Scripts', 'hermes.cmd'),
                ]
                : [path.join(fsPath, 'venv', 'bin', 'hermes')];
            for (const candidate of venvCandidates) {
                if (await accessExecutable(candidate)) {
                    return candidate;
                }
            }
        }
        return undefined;
    }

    private async _handleConfigureEnvironmentDetect(currentPath?: string): Promise<void> {
        if (this._detectInProgress) {
            return;
        }
        const configuredPath = currentPath?.trim() || undefined;
        await this._runEnvironmentDetectionWithUi(configuredPath, 'configure');
    }

    private async _handleConfigureEnvironmentSave(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim() ?? '';
        if (trimmed && !(await accessExecutable(trimmed))) {
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentInvalidPath'),
            });
            return;
        }
        try {
            await this._configureHermesPluginPath(trimmed, { notify: false });
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: true,
                path: trimmed,
            });
            await this._connect(this._activeSelectionId || undefined);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentSaveFailed', msg),
            });
        }
    }

    private _handleConfigureEnvironmentDetectClose(): void {
        if (this._detectInProgress && this._detectAbortController) {
            this._detectAbortController.abort();
            this._log('Configure panel environment detection cancelled by user');
        }
        this._postMessage({ type: 'configureEnvironmentDetectClosed' });
    }

    private async _handleConfigureEnvironmentSystem(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim();
        if (!trimmed || !(await accessExecutable(trimmed))) {
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentInvalidPath'),
            });
            return;
        }
        await this._confirmAndConfigureHermesSystemPath(trimmed);
    }

    private async _handleConfigureEnvironmentOpenDirectory(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim();
        if (!trimmed) {
            return;
        }
        const directory = path.dirname(trimmed);
        await vscode.env.openExternal(vscode.Uri.file(directory));
    }

    private _pickBestExecutable(report: HermesEnvironmentReport): string | undefined {
        const verified = report.executables.filter((item) => item.verified);
        const pool = verified.length > 0 ? verified : report.executables;
        return pool[0]?.path;
    }

    private _shouldOfferHermesConfiguration(report: HermesEnvironmentReport): boolean {
        if (!this._pickBestExecutable(report)) {
            return false;
        }
        const workspaceConfig = vscode.workspace.getConfiguration('tommys');
        const configuredPath = workspaceConfig.get<string>('path')?.trim();
        const pluginConfigValid = !!configuredPath && report.executables.some(
            (item) => item.source === 'config' && item.verified,
        );
        const onSystemPath = report.executables.some(
            (item) => item.source === 'path_lookup' && item.verified,
        );
        return !(pluginConfigValid || onSystemPath);
    }

    private async _autoConfigureHermesPlugin(report: HermesEnvironmentReport): Promise<string | undefined> {
        const executable = await this._pickDetectedHermesExecutable(report.executables);
        if (!executable) {
            return undefined;
        }
        await this._configureHermesPluginPath(executable, { notify: false });
        return executable;
    }

    private async _confirmAndConfigureHermesSystemPath(executable: string): Promise<void> {
        const pathEntry = getHermesExecutableDirectory(executable);
        const { varName, varTarget } = this._getSystemPathEnvInfo();
        const choice = await vscode.window.showWarningMessage(
            t('detectEnvironmentConfigureSystemConfirm', pathEntry, varName, varTarget),
            { modal: true },
            t('detectEnvironmentConfigureSystemConfirmYes'),
            t('detectEnvironmentConfigureSystemConfirmNo'),
        );
        if (choice !== t('detectEnvironmentConfigureSystemConfirmYes')) {
            return;
        }
        await this._configureHermesSystemPath(executable);
    }

    private _logEnvironmentReport(report: HermesEnvironmentReport): void {
        const lines = [
            `Detect status=${report.status} install=${report.installMethod ?? 'unknown'}`,
            `pip=${report.diagnostics.pipInstalled} pythonImport=${report.diagnostics.pythonImportOk}`,
            `candidates=${report.executables.length}`,
        ];
        for (const item of report.executables) {
            lines.push(`  [${item.source}] ${item.path} verified=${item.verified}${item.version ? ` (${item.version})` : ''}`);
        }
        this._log(lines.join('\n'));
    }

    private _detectSourceLabel(source: HermesDetectSource): string {
        const keyMap: Record<HermesDetectSource, keyof import('../i18n/types').LocaleStrings> = {
            config: 'detectEnvironmentSourceConfig',
            path_lookup: 'detectEnvironmentSourcePathLookup',
            known_path: 'detectEnvironmentSourceKnownPath',
            pip: 'detectEnvironmentSourcePip',
            python_import: 'detectEnvironmentSourcePythonImport',
            hermes_home: 'detectEnvironmentSourceHermesHome',
        };
        return t(keyMap[source]);
    }

    private async _pickDetectedHermesExecutable(
        executables: HermesExecutableCandidate[],
    ): Promise<string | undefined> {
        const verified = executables.filter((item) => item.verified);
        const pool = verified.length > 0 ? verified : executables;
        if (pool.length === 1) {
            return pool[0].path;
        }
        const picked = await vscode.window.showQuickPick(
            pool.map((item) => {
                const statusLabel = item.verified
                    ? t('detectEnvironmentCandidateVerified')
                    : t('detectEnvironmentCandidateUnverified');
                const versionSuffix = item.version ? ` · ${item.version}` : '';
                return {
                    label: path.basename(item.path),
                    description: `${item.path} · ${this._detectSourceLabel(item.source)} · ${statusLabel}${versionSuffix}`,
                    executable: item.path,
                };
            }),
            {
                title: t('detectEnvironmentPickExecutable'),
                placeHolder: t('detectEnvironmentPickExecutable'),
            },
        );
        return picked?.executable;
    }

    private async _configureHermesPluginPath(
        executable: string,
        options?: { notify?: boolean },
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('tommys');
        await config.update('path', executable, vscode.ConfigurationTarget.Global);
        this._log(`Configured tommys.path: ${executable}`);
        if (options?.notify !== false) {
            void vscode.window.showInformationMessage(t('detectEnvironmentPluginConfigured', executable));
        }
    }

    private async _configureHermesSystemPath(executable: string): Promise<void> {
        try {
            const { varName, varTarget } = this._getSystemPathEnvInfo();
            const result = addHermesDirectoryToSystemPath(executable);
            if (result.alreadyPresent) {
                void vscode.window.showInformationMessage(
                    t('detectEnvironmentSystemAlreadyConfigured', varName, result.pathEntry),
                );
                return;
            }
            const target = result.profileFile || varTarget;
            const message = t('detectEnvironmentSystemConfigured', result.pathEntry, varName, target);
            const restart = t('detectEnvironmentSystemNeedsRestart');
            const choice = await vscode.window.showInformationMessage(message, restart);
            if (choice === restart) {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`System PATH configuration failed: ${msg}`);
            await vscode.window.showErrorMessage(msg);
        }
    }

    private _buildFallbackModelList(): ModelListState | null {
        const config = vscode.workspace.getConfiguration('tommys');
        const models = config.get<Array<{ id: string; name: string }>>('models') || [];
        const defaultModel = config.get<string>('defaultModel') || '';
        const session = this._sessions.find(s => s.id === this._sessionId);
        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        const currentId = session?.modelId || profileState.modelId || defaultModel;
        return buildFallbackModelListState(models, currentId);
    }

    private _postProfileList(): void {
        void this._ensureDiscoveredProfiles().then(() => {
            this._postMessage({ type: 'profileList', profiles: this._getProfileEntries() });
        });
    }

    private _postModelList(): void {
        const state = this._modelState ?? this._buildFallbackModelList();
        if (state) {
            this._postMessage({
                type: 'modelList',
                configId: state.configId,
                currentValueId: state.currentValueId,
                currentLabel: state.currentLabel,
                models: state.models,
                groups: state.groups,
                fromAgent: state.fromAgent,
            });
        } else {
            const session = this._sessions.find(s => s.id === this._sessionId);
            const profileState = loadProfileState(this._historyDir, this._scopeKey);
            this._postMessage({
                type: 'modelList',
                configId: '',
                currentValueId: session?.modelId || profileState.modelId || '',
                currentLabel: session?.modelLabel || profileState.modelLabel || '—',
                models: [],
                groups: [],
                fromAgent: false,
            });
        }
    }

    private _persistModelChoice(valueId: string, label: string): void {
        const session = this._sessions.find(s => s.id === this._sessionId);
        if (session) {
            session.modelId = valueId;
            session.modelLabel = label;
            try {
                this._saveCatalog();
            } catch { /* ignore */ }
        }
        saveProfileState(this._historyDir, this._scopeKey, { modelId: valueId, modelLabel: label });
    }

    /** Point the *live* session at another model. No session/new: Hermes' set_session_model
     *  swaps the agent in place, and a fresh session here would silently drop the tab's
     *  conversation (and leave an empty row in the catalog). */
    private async _resetAgentWithModel(valueId: string, configId?: string): Promise<void> {
        if (!this._acp || !valueId) {
            return;
        }
        if (!this._acp.activeSessionId) {
            // Blank tab: nothing to switch yet. The choice is persisted already and
            // _applySessionModelPreference() applies it when the first message creates one.
            this._log('Model choice saved; no live session to switch yet');
            return;
        }
        const state = this._modelState ?? this._acp.getModelListState();
        const effectiveConfigId = configId || state?.configId || '';
        if (!state || !isRuntimeModelSource(effectiveConfigId)) {
            await this._syncModelState();
            return;
        }
        await this._acp.setModel(effectiveConfigId, valueId);
        const runtimeId = this._acp.getRuntimeModelId();
        if (runtimeId !== valueId) {
            this._log(`Model apply incomplete: runtime=${runtimeId || '(none)'} expected=${valueId}`);
            this._postMessage({
                type: 'addMessage',
                role: 'assistant',
                text: t('modelSwitchIncomplete', valueId),
            });
        }
        await this._syncModelState();
    }

    private async _applySessionModelPreference(options?: { forceReset?: boolean }): Promise<void> {
        const forceReset = options?.forceReset ?? false;
        const { modelId: preferredId, modelLabel: preferredLabel } = this._resolveSessionModelId();
        if (!preferredId || !this._acp) {
            return;
        }
        const state = this._modelState ?? this._acp.getModelListState();
        if (!state || !isRuntimeModelSource(state.configId)) {
            return;
        }
        const runtimeId = this._acp.getRuntimeModelId();
        if (!forceReset && preferredId === runtimeId) {
            return;
        }
        const known = state.models.some(m => m.valueId === preferredId);
        if (!known) {
            const label = preferredLabel || preferredId;
            this._log(`Saved model not available: ${label}`);
            vscode.window.showWarningMessage(t('savedModelUnavailable', label));
            return;
        }
        try {
            this._log(`Apply session model: ${preferredLabel || preferredId}${forceReset ? ' (reset agent)' : ''}`);
            await this._resetAgentWithModel(preferredId, state.configId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`Restore model failed: ${msg}`);
        }
    }

    private async _handleSwitchModel(configId: string, valueId: string): Promise<void> {
        const op = this._switchModel(configId, valueId);
        this._modelSwitchInFlight = op;
        try {
            await op;
        } finally {
            if (this._modelSwitchInFlight === op) {
                this._modelSwitchInFlight = undefined;
            }
        }
    }

    private async _switchModel(configId: string, valueId: string): Promise<void> {
        const state = this._modelState ?? this._buildFallbackModelList();
        const effectiveConfigId = configId || state?.configId || '';
        const picked = state?.models.find(m => m.valueId === valueId);
        const label = picked?.name ?? valueId;
        this._log(`Switch model: ${label} (config=${effectiveConfigId})`);

        if (this._acp && valueId) {
            if (this._acp.status === 'prompting') {
                vscode.window.showWarningMessage(t('waitForResponse'));
                return;
            }
            this._persistModelChoice(valueId, label);
            try {
                if (this._otherSessionIsPrompting()) {
                    await this._detachActivePrompt(this._turn.promptSessionId!, { savePartial: true });
                }
                await this._resetAgentWithModel(valueId, effectiveConfigId);
                this._acpBoundSessionId = this._sessionId;
                this._log(`Model active: ${label}`);
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`setModel failed: ${msg}`);
                vscode.window.showErrorMessage(t('failedSwitchModel', msg));
                return;
            }
        }

        if (!state || !isRuntimeModelSource(effectiveConfigId)) {
            this._persistModelChoice(valueId, label);
            if (state) {
                this._modelState = { ...state, currentValueId: valueId, currentLabel: label };
            }
            this._postModelList();
            if (!this._modelFallbackShown) {
                this._modelFallbackShown = true;
                vscode.window.showInformationMessage(t('modelPreferenceSaved'));
            }
            return;
        }

        vscode.window.showWarningMessage(t('hermesNotConnected'));
    }

    private async _handleUserMessage(text: string, contextAttach?: ContextAttachOption, images?: Array<{ mimeType: string; data: string }>): Promise<void> {
        const epoch = this._turn.sendEpoch;
        await this._awaitSessionReady();
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        if (this._modelSwitchInFlight) {
            await this._modelSwitchInFlight;
        }
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        if (this._sessions.length === 0) {
            this._postMessage({ type: 'noActiveTab' });
            return;
        }
        const ready = await this._ensureAcpReadyForCurrentSession();
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        if (!ready) {
            // The pane keeps its history; the reader gets the reason instead of silence.
            this._postMessage({ type: 'addMessage', role: 'assistant', text: t('sessionNotWritable') });
            return;
        }
        const imageCount = images?.length ?? 0;
        this._log(`User message: ${text.slice(0, 80)}${imageCount ? ` [+${imageCount} image(s)]` : ''}`);
        this._snapshotSessionModelFromProfile();
        this._turn.promptSessionId = this._sessionId;
        const imageRefs = images && images.length ? this._storeImages(images) : undefined;
        if (imageRefs && imageRefs.length) {
            this._indexAttachments(imageRefs, text);
        }
        this._saveMessage('user', text, undefined, imageRefs);
        this._markSessionAgentEngaged();
        if (this._contextAttachActive) {
            this._contextAttachAwaitingReply = true;
        }
        const promptText = this._buildPromptText(text, contextAttach);
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        if (imageCount > 0) {
            // Compose an ACP prompt with a text block followed by one image block per staged image.
            // Hermes' ACP adapter advertises promptCapabilities.image=true and decodes these directly.
            const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }> = [];
            if (promptText.length > 0) {
                blocks.push({ type: 'text', text: promptText });
            }
            for (const img of images!) {
                blocks.push({ type: 'image', mimeType: img.mimeType || 'image/png', data: img.data });
            }
            await this._acp?.sendMessage(blocks as any);
        } else {
            await this._acp?.sendMessage(promptText);
        }
    }

    private async _handleCancel(): Promise<void> {
        this._turn.sendEpoch++;
        this._clearPromptStallTimer();
        this._contextAttachAwaitingReply = false;
        await this._awaitSessionReady();
        this._flushThoughtToHistory();
        this._turn.lastAssistantText = '';
        this._turn.lastThoughtText = '';
        this._turn.promptSessionId = undefined;
        this._cancelPendingPermissions();
        const wasPrompting = this._acp?.status === 'prompting';
        await this._acp?.cancel();
        this._postMessage({ type: 'finishAssistantBubble', sessionId: this._sessionId });
        if (!wasPrompting && this._acp?.status === 'ready') {
            this._postMessage({ type: 'status', status: 'ready', sessionId: this._sessionId });
        }
    }

    private _resolveFileUri(filePath: string): vscode.Uri | undefined {
        const normalized = filePath.replace(/^@/, '').trim();
        if (!normalized) {
            return undefined;
        }
        if (path.isAbsolute(normalized)) {
            return vscode.Uri.file(normalized);
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            for (const folder of folders) {
                const candidate = vscode.Uri.joinPath(folder.uri, normalized);
                if (this._isPathAllowed(candidate.fsPath)) {
                    return candidate;
                }
            }
            return vscode.Uri.joinPath(folders[0].uri, normalized);
        }
        return vscode.Uri.file(normalized);
    }

    private _toDisplayPath(uri: vscode.Uri): string {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) {
            return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        }
        return uri.fsPath.replace(/\\/g, '/');
    }

    private async _handleListFiles(query: string, requestId: string): Promise<void> {
        const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.hermes/**}';
        const q = query.trim().toLowerCase();
        try {
            const uris = await vscode.workspace.findFiles('**/*', exclude, 500);
            const files = uris
                .map(uri => this._toDisplayPath(uri))
                .filter(p => !q || p.toLowerCase().includes(q))
                .slice(0, 30);
            this._postMessage({ type: 'fileList', requestId, files });
        } catch {
            this._postMessage({ type: 'fileList', requestId, files: [] });
        }
    }

    private async _handlePreviewFile(filePath: string, requestId: string): Promise<void> {
        const normalized = filePath.replace(/^@/, '').trim();
        try {
            const uri = this._resolveFileUri(normalized);
            if (!uri || !this._isPathAllowed(uri.fsPath)) {
                this._postMessage({
                    type: 'filePreview',
                    requestId,
                    path: normalized,
                    error: t('fileAccessDenied'),
                });
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            const maxLines = 24;
            let content: string;
            if (doc.lineCount <= maxLines) {
                content = doc.getText();
            } else {
                const endLine = doc.lineAt(maxLines - 1);
                content = doc.getText(new vscode.Range(0, 0, maxLines - 1, endLine.text.length)) + '\n…';
            }
            this._postMessage({
                type: 'filePreview',
                requestId,
                path: this._toDisplayPath(uri),
                content,
                language: doc.languageId,
            });
        } catch {
            this._postMessage({
                type: 'filePreview',
                requestId,
                path: normalized,
                error: t('fileReadError'),
            });
        }
    }

    private async _handleOpenFile(filePath: string): Promise<void> {
        this._log(`Open file: ${filePath}`);
        try {
            const uri = this._resolveFileUri(filePath);
            if (!uri) {
                vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
        }
    }

    private async _handleInsertEditor(text: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage(t('noActiveEditor'));
            return;
        }
        await editor.edit((editBuilder) => {
            editBuilder.insert(editor.selection.active, text);
        });
    }

    private _handleDeleteMessages(indices: unknown): void {
        if (!Array.isArray(indices) || indices.length === 0) {
            return;
        }
        const sorted = [...new Set(indices.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))]
            .sort((a, b) => b - a);
        for (const index of sorted) {
            if (index < this._sessionMessages.length) {
                this._sessionMessages.splice(index, 1);
            }
        }
        this._persistMessages();
        this._saveCurrentSession();
    }

    private async _createBlankTab(): Promise<void> {
        this._saveCurrentSession();
        this._sessionMessages = [];
        this._sessionId = Date.now().toString(36);
        try { fs.unlinkSync(this._msgPath(this._sessionId)); } catch { /* ignore */ }
        this._ensureSessionRegistered();
        this._snapshotSessionModelFromProfile();
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
    }

    /**
     * A prompt belongs to the tab it was started in, so switching away from a running one
     * has to end it first. Returns false when the switch must not happen at all.
     */
    private async _endPromptBeforeSwitch(options?: { interrupt?: boolean }): Promise<boolean> {
        if (this._currentSessionIsPrompting()) {
            if (!options?.interrupt) {
                return false;
            }
            await this._detachActivePrompt(this._sessionId, { savePartial: true });
        } else if (this._otherSessionIsPrompting()) {
            await this._detachActivePrompt(this._turn.promptSessionId!, { savePartial: true });
        }
        return true;
    }

    /** Point the pane at another tab: save the old one, load the new one's transcript. */
    private _activateSession(sessionId: string, options?: { skipSaveCurrent?: boolean }): void {
        this._log(`Switch to session: ${sessionId}`);
        if (!options?.skipSaveCurrent) {
            this._saveCurrentSession();
        }
        this._sessionId = sessionId;
        this._sessionMessages = [];
        this._loadHistory();
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
    }

    private async _handleSwitchSession(
        sessionId: string,
        options?: { skipSaveCurrent?: boolean; interrupt?: boolean }
    ): Promise<void> {
        if (sessionId === this._sessionId) {
            return;
        }
        if (!(await this._endPromptBeforeSwitch(options))) {
            return;
        }
        this._activateSession(sessionId, options);
        // Resumed history arrives as session/update; only fall back to the local
        // render cache when this tab has no Hermes session to replay.
        const resumed = await this._resumeTabHermesSession(sessionId);
        if (!resumed) {
            this._restoreMessages();
        }
        await this._syncModelStateForCurrentSession();
        this._syncPromptUiIfReturningToOwner();
    }

    private _currentSessionIsPrompting(): boolean {
        return this._acp?.status === 'prompting'
            && !!this._turn.promptSessionId
            && this._turn.promptSessionId === this._sessionId;
    }

    private _handleReorderSessions(sessionIds: unknown): void {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return;
        }
        const next = reorderSessions(this._sessions, sessionIds);
        if (!next) {
            return;
        }
        this._sessions = next;
        this._log(`Reorder sessions: ${this._sessions.map(s => s.id).join(', ')}`);
        try {
            this._saveCatalog();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    /**
     * Close tabs by hiding their sessions.
     *
     * Closing is not deletion: the transcript, the title and the cwd all stay in Hermes,
     * the row simply stops being an open tab, and `[+ Open Tab]` is where it comes back.
     */
    private async _handleCloseSessions(sessionId: string, mode: unknown): Promise<void> {
        if (typeof mode !== 'string' || !this._sessions.length) {
            return;
        }
        const ids = this._sessions.map(s => s.id);
        const idx = ids.indexOf(sessionId);
        let toHide: string[] = [];
        switch (mode) {
            case 'self':
                toHide = idx === -1 ? [] : [sessionId];
                break;
            case 'others':
                toHide = idx === -1 ? [] : ids.filter(id => id !== sessionId);
                break;
            case 'left':
                toHide = idx > 0 ? ids.slice(0, idx) : [];
                break;
            case 'right':
                toHide = idx !== -1 && idx < ids.length - 1 ? ids.slice(idx + 1) : [];
                break;
            case 'all':
                toHide = [...ids];
                break;
            default:
                return;
        }
        if (!toHide.length) {
            return;
        }
        await this._hideSessions(toHide, mode === 'all' ? undefined : sessionId);
    }

    /** Hide the given tabs, move focus off a closed tab, then re-read the catalog. */
    private async _hideSessions(toHide: string[], focusSessionId?: string): Promise<void> {
        const acp = this._acp;
        for (const id of toHide) {
            if (acp) {
                try {
                    await acp.setSessionHidden(id, true);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this._log(`Hide failed for ${id}: ${msg}`);
                }
            }
        }
        this._log(`Closed ${toHide.length} tab(s)`);
        const hidingActive = toHide.includes(this._sessionId);
        const remaining = this._sessions.filter(rec => !toHide.includes(rec.id));
        if (hidingActive) {
            const nextId = focusSessionId && remaining.some(rec => rec.id === focusSessionId)
                ? focusSessionId
                : remaining[0]?.id;
            if (nextId) {
                await this._handleSwitchSession(nextId, { skipSaveCurrent: true });
            } else {
                this._sessionMessages = [];
                this._postMessage({ type: 'noActiveTab' });
            }
        }
        await this._refreshSessionsFromHermes();
    }

    /** Open a closed session as a tab; with nothing picked, open a blank tab instead of
     *  starting a session inside the tab the user is already reading. */
    private async _handleOpenTab(sessionId?: string): Promise<void> {
        if (!sessionId) {
            await this._createBlankTab();
            return;
        }
        if (!this._sessions.some(rec => rec.id === sessionId)) {
            const acp = this._acp;
            if (acp) {
                try {
                    await acp.setSessionHidden(sessionId, false);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this._log(`Unhide failed for ${sessionId}: ${msg}`);
                    return;
                }
            }
            this._log(`Opened closed session ${sessionId}`);
            await this._refreshSessionsFromHermes();
        }
        await this._handleSwitchSession(sessionId);
    }

    private _handleTogglePinSession(sessionId: string): void {
        const next = pinSession(this._sessions, sessionId);
        if (next === this._sessions) {
            return;
        }
        this._sessions = next;
        const pinnedNow = !!next.find(record => record.id === sessionId)?.pinned;
        this._log(`${pinnedNow ? 'Pin' : 'Unpin'} session ${sessionId}`);
        try {
            this._saveCatalog();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _handleSessionExport(sessionId: string, action: unknown, indices?: unknown): void {
        if (action !== 'copy' && action !== 'export') {
            return;
        }
        const session = this._sessions.find(s => s.id === sessionId);
        if (!session) {
            return;
        }
        let messages = sessionId === this._sessionId
            ? this._sessionMessages
            : this._loadSessionMessagesFromDisk(sessionId);
        if (Array.isArray(indices) && indices.length > 0) {
            const pick = new Set(
                indices.filter((index): index is number => typeof index === 'number' && index >= 0)
            );
            messages = messages.filter((_, index) => pick.has(index));
        }
        const payload = buildSessionExportPayload(session, messages, this._modelState?.currentLabel);
        this._postMessage({
            type: 'sessionExport',
            action,
            ...payload,
        });
    }

    private _loadSessionMessagesFromDisk(sessionId: string): ChatMessage[] {
        try {
            const p = this._msgPath(sessionId);
            if (!fs.existsSync(p)) {
                return [];
            }
            const messages: ChatMessage[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
            return messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } catch {
            return [];
        }
    }

    private async _handleSwitchAgent(selectionId: string): Promise<void> {
        const target = this._resolveConnectionTarget(selectionId);
        if (target.selectionId === this._activeSelectionId && this._acp) {
            return;
        }
        this._log(`Switch profile/agent: ${target.displayName}`);
        if (this._turn.promptSessionId) {
            await this._detachActivePrompt(this._turn.promptSessionId, { savePartial: true });
        }
        this._saveCurrentSession();
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._turn.promptSessionId = undefined;
        this._acpBoundSessionId = '';
        this._postTokenUsage();
        this._bindProfileScope(target.scopeKey);
        this._activeSelectionId = target.selectionId;
        this._activeAgentName = target.displayName;
        void this._context.globalState.update('activeSelectionId', target.selectionId);
        // View reset only: the other profile's tab is restored by _bindProfileScope above and
        // replayed by _restoreMessages below, so nothing of the old profile stays on screen.
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
        this._postProfileList();
        this._postMessage({ type: 'activeAgent', name: target.displayName });
        await this._connect(target.selectionId);
        this._restoreMessages();
    }

    private _readAgentConfigs(): HermesAgentConfig[] {
        const config = vscode.workspace.getConfiguration('tommys');
        const raw = config.get<unknown>('agents');
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.flatMap(entry => {
            if (!entry || typeof entry !== 'object') {
                return [];
            }
            const name = (entry as { name?: unknown }).name;
            if (typeof name !== 'string' || !name.trim()) {
                return [];
            }
            const agent = entry as HermesAgentConfig;
            return [{ ...agent, name: name.trim() }];
        });
    }

    public insertIntoInput(text: string): void {
        this._postMessage({ type: 'insertInput', text });
    }

    public openSettings(): void {
        void this._openSettings();
    }

    public openLogs(): void {
        this._postMessage({ type: 'openLogs' });
    }

    public openAbout(): void {
        this._postMessage({ type: 'openAbout' });
    }

    public openHelp(): void {
        this._postMessage({ type: 'openHelp' });
    }

    public openFaq(): void {
        this._postMessage({ type: 'openFaq' });
    }

    public reloadSession(): void {
        void this._handleReloadSession();
    }

    public reloadExtension(): void {
        void this._handleReloadExtension();
    }

    public checkForUpdate(): void {
        void this._checkForUpdate();
    }

    /** Push updated locale strings when VS Code display language changes. */
    public updateLocale(): void {
        this._webviewLocale = undefined;
        this._syncWebviewLocale();
    }

    private _syncWebviewLocale(): void {
        const current = initI18n();
        if (current === this._webviewLocale) {
            return;
        }
        this._webviewLocale = current;
        this._postMessage({ type: 'setLocale', locale: getWebviewLocale() });
        this._postSessionList();
    }

    public async sendText(text: string): Promise<void> {
        await this._awaitSessionReady();
        if (this._modelSwitchInFlight) {
            await this._modelSwitchInFlight;
        }
        if (!this._acp) {
            vscode.window.showWarningMessage(t('hermesNotConnectedConnecting'));
            await this._connect();
        }
        if (!this._acp) {
            vscode.window.showWarningMessage(t('hermesNotConnected'));
            return;
        }
        this._turn.promptSessionId = this._sessionId;
        this._snapshotSessionModelFromProfile();
        this._postMessage({ type: 'addMessage', role: 'user', text, sessionId: this._sessionId });
        this._saveMessage('user', text);
        this._markSessionAgentEngaged();
        await this._ensureAcpReadyForCurrentSession();
        await this._acp.sendMessage(text);
    }

    public dispose(): void {
        this._disposed = true;
        this._clearPromptStallTimer();
        this._saveCurrentSession();
        this._cancelPendingPermissions();
        this._clearViewDetectProgress();
        this._acp?.dispose();
        this._acp = undefined;
        this._view = undefined;
        this._output.dispose();
    }

    private _postMessage(msg: any): void {
        // Fan out to every renderer: the side bar view and/or the chat panel.
        if (this._surfaces.length === 0) {
            this._view?.webview.postMessage(msg);
            return;
        }
        for (const surface of this._surfaces) {
            void surface.webview.postMessage(msg);
        }
    }

    private _postConfig(): void {
        const config = vscode.workspace.getConfiguration('tommys');
        this._postMessage({
            type: 'config',
            showThoughts: config.get<boolean>('showThoughts', true),
            showToolCalls: config.get<boolean>('showToolCalls', true),
        });
    }

    private _postTokenUsage(): void {
        if (!this._tokenUsage) {
            this._postMessage({ type: 'tokenUsage', used: 0, size: 0 });
            return;
        }
        this._postMessage({
            type: 'tokenUsage',
            used: this._tokenUsage.used,
            size: this._tokenUsage.size,
        });
    }

    private _postPluginInfo(): void {
        const ext = vscode.extensions.getExtension(this._extensionId);
        const pkg = ext?.packageJSON;
        let iconUri = '';
        const iconWebview = this._surfaces[0]?.webview ?? this._view?.webview;
        if (iconWebview) {
            iconUri = iconWebview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.png')
            ).toString();
        }
        this._postMessage({
            type: 'pluginInfo',
            displayName: pkg?.displayName || 'Tommys Hermes ACP',
            version: pkg?.version || '',
            publisher: pkg?.publisher || '',
            description: pkg?.description || '',
            repository: pkg?.repository?.url || pkg?.repository || '',
            iconUri,
        });
    }

    private async _handleReloadSession(): Promise<void> {
        this._log('Reload session requested');
        this._turn.sendEpoch++;
        this._flushThoughtToHistory();
        if (this._turn.lastAssistantText.trim()) {
            this._saveMessage('assistant', this._turn.lastAssistantText);
            this._turn.lastAssistantText = '';
        }
        this._cancelPendingPermissions();
        this._saveCurrentSession();
        this._persistMessages();

        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();

        this._postMessage({ type: 'newChat' });
        await this._connect(this._activeSelectionId || undefined);
        this._restoreMessages();
    }

    private async _handleReloadExtension(): Promise<void> {
        this._log('Reload extension requested');
        this._turn.sendEpoch++;
        this._flushThoughtToHistory();
        if (this._turn.lastAssistantText.trim()) {
            this._saveMessage('assistant', this._turn.lastAssistantText);
            this._turn.lastAssistantText = '';
        }
        this._cancelPendingPermissions();
        this._saveCurrentSession();
        this._persistMessages();
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }

    private async _checkForUpdate(): Promise<void> {
        this._log('Checking for extension updates');
        await vscode.commands.executeCommand('workbench.extensions.action.checkForUpdates');
        await vscode.commands.executeCommand(
            'workbench.extensions.action.showExtensionsWithIds',
            [this._extensionId]
        );
    }

    private async _openSettings(): Promise<void> {
        const preferJsonEditor = vscode.workspace
            .getConfiguration('workbench.settings')
            .get<string>('editor') === 'json';
        const isCursor = /cursor/i.test(vscode.env.appName);

        // Cursor: always open Settings UI (JSON editor command often does nothing visible).
        if (preferJsonEditor && !isCursor) {
            await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
                revealSetting: { key: 'tommys.path', edit: false },
            });
            return;
        }

        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `@ext:${this._extensionId}`,
        );
    }

    private async _onConfigurationChanged(e: vscode.ConfigurationChangeEvent): Promise<void> {
        if (e.affectsConfiguration('tommys.showThoughts') || e.affectsConfiguration('tommys.showToolCalls')) {
            this._postConfig();
        }
        if (e.affectsConfiguration('tommys.contextAttachVisibility')) {
            this._applyContextAttachVisibility();
        }
        if (e.affectsConfiguration('tommys.models') || e.affectsConfiguration('tommys.defaultModel')) {
            if (!this._modelState || !isRuntimeModelSource(this._modelState.configId)) {
                this._modelState = null;
            }
            void this._syncModelState();
        }
        if (e.affectsConfiguration('tommys.agents')) {
            this._discoveredProfiles = null;
            this._postProfileList();
        }
        const reconnectKeys = ['tommys.path', 'tommys.cwd', 'tommys.profile'];
        if (reconnectKeys.some(k => e.affectsConfiguration(k))) {
            if (e.affectsConfiguration('tommys.profile') && this._readAgentConfigs().length === 0) {
                const config = vscode.workspace.getConfiguration('tommys');
                this._activeSelectionId = normalizeHermesCliProfile(config.get<string>('profile'));
            }
            await this._reconnectForConfig();
        }
    }

    private async _reconnectForConfig(): Promise<void> {
        if (!this._view) {
            return;
        }
        this._log('Settings changed — reconnecting Hermes...');
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        await this._connect(this._activeSelectionId || undefined);
    }

    private _getHtml(target?: vscode.Webview): string {
        const webview = target ?? this._view?.webview;
        return buildWebviewHtml({
            htmlPath: path.join(this._extensionUri.fsPath, 'media', 'chat.html'),
            resourceUri: webview
                ? (relative: string) => webview
                    .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', relative))
                    .toString()
                : undefined,
            themeKind: vscode.window.activeColorTheme.kind,
            locale: getWebviewLocale(),
        });
    }

    private _resolveCwd(configCwd?: string): string {
        if (configCwd) return configCwd;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (folder) return folder.uri.fsPath;
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) return folders[0].uri.fsPath;
        return process.cwd();
    }

    /** Check if path is within workspace folders. Allows absolute paths only if inside workspace. */
    private _isPathAllowed(p: string): boolean {
        if (!path.isAbsolute(p)) return true; // relative paths are fine
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders.some(f => p.startsWith(f.uri.fsPath));
        }
        // No workspace: restrict to cwd
        const config = vscode.workspace.getConfiguration('tommys');
        const configCwd = config.get<string>('cwd');
        const cwd = configCwd || process.cwd();
        return p.startsWith(cwd);
    }
}
