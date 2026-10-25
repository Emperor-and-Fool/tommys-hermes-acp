import * as vscode from 'vscode';
import * as fs from 'fs';
import { AttachmentStore } from '../cache/attachments';
import type { ChatMessage, SessionInfo, StoredImageRef } from '../types/chat';
import * as path from 'path';
import { AcpClient, CatalogSession, PermissionRequest, ReplayMessage, TokenUsage } from '../acp/AcpClient';
import { ModelState } from '../models/modelState';
import { resolveMcpServersForSession } from '../acp/mcpConfig';
import { normalizeHermesCliProfile, scopeKeyForCliProfile } from '../environment/hermesProfile';
import { discoverHermesProfiles, tryResolveHermesQuick } from '../environment/profileDiscovery';
import { EnvironmentDetection } from '../environment/detection';
import {
    activeSessionPathFor,
    migrateLegacySessionStorage,
    sanitizeProfileScopeKey,
    sessionsPathFor,
} from '../cache/profileStorage';
import { getLocale, getWebviewLocale, initI18n, localizeStatusMessage, t } from '../i18n';
import { resolvePermissionOptionLabel } from '../i18n/permissionOptions';
import { SupportedLocale } from '../i18n/types';
import { buildWebviewHtml } from '../webview/html';
import { Surfaces } from '../webview/surfaces';
import type { ChatSurface } from '../webview/surfaces';
import type { HostToPane, PaneToHost } from '../types/webview';
import { handleWebviewMessage } from '../webview/router';
import type { RouterHost } from '../webview/router';
import { formatDetectBrokenMessage } from '../environment/detectFormat';
import { buildSessionExportPayload } from './sessionExport';
import { SessionStore } from '../cache/sessionStore';
import { applyCatalogRows, renameSession } from '../cache/catalog';
import { backfillAgentEngaged, hermesSessionIdFor, markAgentEngaged, normalizePinnedOrder, pinSession, registerSession, reorderSessions } from '../tabs/tabs';
import { buildReplayMessages } from '../cache/replay';
import { findUndelivered, lastUserMessageText } from '../cache/undelivered';
import { PromptRunner } from './promptRunner';
import {
    canAggregateToolTexts,
    rebuildAggregatedToolText,
} from './toolAggregate';
import { classifyLogLevel, LogLevel } from '../logLevel';
import {
    composePromptWithContext,
    ContextAttachOption,
    filterAttachableMessages,
    resolveAttachMessages,
    resolveCustomAttachMessages,
} from './contextAttach';

/**
 * `onNewSession` is a Rina-era name kept for settings compatibility. A tab no longer gets a new
 * session behind its back; the picker shows when a tab's transcript is restored, until the
 * first reply.
 */
type ContextAttachVisibility = 'onNewSession' | 'always' | 'never';

/** The panel id lives with the panel; re-exported so extension.ts keeps one import site. */
export { CHAT_PANEL_VIEW_TYPE } from '../webview/surfaces';


/** The key an attachment is filed under: the message text, markers and spacing removed. */


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


export class HermesChatProvider implements vscode.WebviewViewProvider {
    // ---- Lifecycle ----
    /** Every live renderer: the sidebar view and/or the single chat panel. */
    /** Where the conversation is rendered: the side bar or an editor tab. */
    private _acp?: AcpClient;
    /** The renderers of the chat: side bar view, editor panel, or both at once. */
    private readonly _surfaces: Surfaces = new Surfaces({
        html: (webview) => this._getHtml(webview),
        wire: (webview, surface) => this._wireMessages(webview, surface),
        activeTabTitle: () => this._activeTabTitle(),
        onViewResolved: () => { this._webviewLocale = getLocale(); },
        onViewVisible: () => {
            this._syncWebviewLocale();
            if (!this._acp) {
                this._connect();
            }
        },
        localResourceRoots: () => [this._extensionUri],
        log: (line) => this._log(line),
    });
    private _output: vscode.OutputChannel;

    // ---- Session State ----
    private _historyDir: string;
    /** Bytes Hermes never stores: content-addressed images and the index that finds them. */
    private _attachments: AttachmentStore;
    private _scopeKey: string;
    private _store: SessionStore;
    private _sessionMessages: ChatMessage[] = [];
    private _sessionId: string = '';
    private _sessions: SessionInfo[] = [];
    /** Sessions Hermes has flagged hidden: closed tabs waiting to be opened again. */
    private _hiddenSessions: CatalogSession[] = [];
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
    private _tokenUsage: TokenUsage | null = null;
    private _webviewLocale?: SupportedLocale;
    private readonly _extensionId: string;
    /** Serializes webview send so rapid sends cannot overlap. */
    private _chatOpChain: Promise<void> = Promise.resolve();
    /**
     * Turn-scoped state and session acquisition. The host literals are the whole coupling
     * between a turn and the provider: every member here stays private, and this is the one
     * place where the runner reaches the pane, the transcript and the tab list.
     */
    private readonly _turn: PromptRunner = new PromptRunner({
        acp: () => this._acp,
        sessionId: () => this._sessionId,
        messages: () => this._sessionMessages,
        tabs: () => this._sessions,
        resolveCwd: () => this._resolveCwd(),
        log: (line) => this._log(line),
        post: (msg) => this._postMessage(msg),
        otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
        acpStatus: () => this._acp?.status,
        isViewingPromptSession: () => this._isViewingPromptSession(),
        cancelPendingPermissions: () => this._cancelPendingPermissions(),
        awaitSessionReady: () => this._awaitSessionReady(),
        setContextAttachAwaitingReply: (value) => { this._contextAttachAwaitingReply = value; },
        detachActivePrompt: (id, options) => this._detachActivePrompt(id, options),
        bindHermesSessionId: (id) => this._bindHermesSessionId(id),
        applySessionModelPreference: () => this._models.applySessionPreference(),
        setBoundSessionId: (id) => { this._acpBoundSessionId = id; },
        saveMessage: (role, text) => this._saveMessage(role, text),
        savePermissionRequest: (id, request) => this._savePermissionRequest(id, request),
        resolvePermissionHistory: (id, outcome, optionId, label) => this._resolvePermissionHistory(id, outcome, optionId, label),
        permissionOptionLabel: (id, optionId) => {
            const stored = this._sessionMessages.find(m => m.permissionId === id && m.role === 'permission');
            const opt = stored?.options?.find(o => o.optionId === optionId);
            return opt ? resolvePermissionOptionLabel(getWebviewLocale(), opt) : undefined;
        },
    });
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
    /** This tab's own messages offered to the picker; not an earlier session. */
    private _contextAttachMessages: ChatMessage[] = [];
    private _contextAttachActive = false;
    private _contextAttachAwaitingReply = false;
    /** Finding and starting Hermes on this machine, plus the configure panel around it. */
    private readonly _detection = new EnvironmentDetection({
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
        reconnect: () => this._connect(this._activeSelectionId || undefined),
        resetViewTitle: () => this._resetViewTitleToDefault(),
    });
    /** Which model, from where: the chip, the switch, and the persisted choice. */
    private readonly _models: ModelState = new ModelState({
        acp: () => this._acp,
        tabs: () => this._sessions,
        sessionId: () => this._sessionId,
        saveCatalog: () => this._saveCatalog(),
        profileScope: () => ({ historyDir: this._historyDir, scopeKey: this._scopeKey }),
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
        otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
        detachOtherPrompt: () => this._detachActivePrompt(this._turn.promptSessionId!, { savePartial: true }),
        setBoundSessionId: (id) => { this._acpBoundSessionId = id; },
    });
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
        this._output = vscode.window.createOutputChannel('Hermes Chat', 'hermes-chat');
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        this._historyDir = storagePath;
        this._attachments = new AttachmentStore(this._historyDir);
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
    ): void {
        this._surfaces.resolveView(webviewView);
    }

    public toggleChatSurface(): void {
        this._surfaces.toggle();
    }

    /** Called by the panel serializer so the tab comes back after a reload. */
    public restoreChatPanel(panel: vscode.WebviewPanel): void {
        this._surfaces.restorePanel(panel);
    }

    /** Same message contract for the side bar view and the editor panel. */
    private _wireMessages(webview: vscode.Webview, surface: ChatSurface): void {
        const host = this._routerHost(surface);
        webview.onDidReceiveMessage((message) => handleWebviewMessage(message as PaneToHost, host));
    }

    /** A new pane knows nothing: replay the live state instead of leaving placeholders. */
    private _onWebviewReady(surface: ChatSurface): void {
        this._log('WebView ready');
        this._surfaces.postRole(surface);
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
        this._models.postList();
        if (surface.role === 'chat') {
            this._restoreMessages(surface);
        }
        if (this._surfaces.mode === 'editor' && !this._surfaces.hasPanel
            && this._surfaces.hasViewSurface) {
            this._surfaces.openPanel();
        }
        // Moving the view container disposes and re-creates the webview but keeps
        // the ACP client. The new pane knows nothing and its composer starts
        // disabled, so replay the live status — otherwise the UI looks frozen and
        // only a window reload recovers.
        if (this._acp) {
            const liveStatus = this._acp.status;
            this._surfaces.postTo(surface, { type: 'status', status: liveStatus, sessionId: this._sessionId });
            if (liveStatus === 'idle' || liveStatus === 'error') {
                this._acp.dispose();
                this._acp = undefined;
            }
        }
        this._connect();
    }

    /** Everything the router may call, bound to this pane and this surface. */
    private _routerHost(surface: ChatSurface): RouterHost {
        return {
            log: (line) => this._log(line),
            openExternal: (url) => {
                if (url) {
                    void vscode.env.openExternal(vscode.Uri.parse(url));
                }
            },
            ready: () => this._onWebviewReady(surface),
            enqueueChatOp: (op) => this._enqueueChatOp(op),
            handleUserMessage: (text, contextAttach, images) => this._handleUserMessage(
                text,
                contextAttach as ContextAttachOption | undefined,
                images as Array<{ mimeType: string; data: string }> | undefined,
            ),
            handleCancel: () => this._handleCancel(),
            handleOpenFile: (path) => this._handleOpenFile(path),
            handleListFiles: (query, requestId) => this._handleListFiles(query, requestId),
            handlePreviewFile: (path, requestId) => this._handlePreviewFile(path, requestId),
            postHiddenSessions: () => this._postHiddenSessions(),
            handleOpenTab: (sessionId) => this._handleOpenTab(sessionId),
            handleReorderSessions: (ids) => this._handleReorderSessions(ids),
            handleCloseSessions: (sessionId, mode) => this._handleCloseSessions(sessionId, mode),
            handleRenameSession: (sessionId, title) => this._handleRenameSession(sessionId, title),
            handleTogglePinSession: (sessionId) => this._handleTogglePinSession(sessionId),
            handleSessionExport: (sessionId, action, indices) => this._handleSessionExport(sessionId, action, indices),
            handleSwitchAgent: (name) => this._handleSwitchAgent(name),
            handleSwitchSession: (sessionId, interrupt) => {
                if (this._surfaces.mode === 'editor' && !this._surfaces.hasPanel) {
                    this._surfaces.openPanel();
                }
                this._enqueueChatOp(() => this._handleSwitchSession(sessionId, { interrupt }));
            },
            switchModel: (configId, valueId) => this._models.switchModel(configId, valueId),
            syncModels: () => this._models.sync(),
            postProfileList: () => this._postProfileList(),
            retry: () => this._handleRetry(),
            handlePermissionResponse: (id, optionId) => this._handlePermissionResponse(id, optionId),
            handleInsertEditor: (text) => this._handleInsertEditor(text),
            handleDeleteMessages: (indices) => this._handleDeleteMessages(indices),
            detection: () => this._detection,
        };
    }

    private _activeTabTitle(): string {
        const rec = this._sessions.find(item => item.id === this._sessionId);
        return rec?.title || t('newChat');
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



    private async _syncModelStateForCurrentSession(): Promise<void> {
        await this._models.sync();
        if (this._otherSessionIsPrompting()) {
            return;
        }
        if (this._acpBoundSessionId === this._sessionId) {
            await this._models.applySessionPreference();
        }
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
                const refs = this._attachments.refsFromIndex(msg.text, used, true);
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
            messages: this._attachments.hydrateImages(this._sessionMessages),
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
        return this._turn.ensureSessionReady();
    }

    private _postPromptScopedMessage(msg: HostToPane): void {
        this._turn.postScoped(msg);
    }

    private _clearPromptStallTimer(): void {
        this._turn.clearStallHint();
    }

    private _schedulePromptStallHint(): void {
        this._turn.scheduleStallHint();
    }

    private async _detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void> {
        return this._turn.detachActivePrompt(fromSessionId, options);
    }

    private _restoreMessages(target?: ChatSurface): void {
        if (this._sessionMessages.length === 0) return;
        this._log(`Restoring ${this._sessionMessages.length} messages`);
        const msg: HostToPane = {
            type: 'restoreHistory',
            messages: this._attachments.hydrateImages(this._sessionMessages),
            localHistoryOnly: true,
        };
        if (target) {
            this._surfaces.postTo(target, msg);
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

    /** Attachment hashes back to what the webview renders, for the transcript being posted. */

    /**
     * The replay is text-only and rewrites the transcript file, so refs stored on a record can
     * be lost. This sidecar is written on send and never rewritten by a replay.
     */



    /** Attachments for a message that carries no refs: exact key first, then by order. */

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
        this._turn.flushThought();
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
        this._surfaces.updatePanelTitle();
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
            const report = await this._detection.runWithUi(target.configPath, 'connect');
            if (report.status === 'cancelled') {
                this._log('Connect cancelled during environment detection');
                this._postMessage({
                    type: 'status',
                    status: 'disconnected',
                    message: t('detectEnvironmentCancelled'),
                });
                return;
            }
            resolvedPath = this._detection.pickBestExecutable(report);
            if (this._detection.shouldOfferConfiguration(report)) {
                const configuredPath = await this._detection.autoConfigure(report);
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
                    this._turn.recordAssistantText(text);
                }
                if (role === 'thought') {
                    this._turn.recordThoughtText(text);
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
                        this._turn.saveAssistantText();
                    }
                    this._turn.clearText();
                    this._turn.promptSessionId = undefined;
                    if (this._isViewingPromptSession()) {
                        this._completeContextAttachAfterSuccessfulReply();
                    }
                }
                if (status === 'prompting') {
                    this._turn.clearText();
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
                void this._models.sync({ skipModelOptions: true });
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
            await this._models.sync({ skipModelOptions: true });
            await this._models.applySessionPreference();
            await this._models.sync();
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
        return this._turn.requestPermission(request);
    }

    private _handlePermissionResponse(id: string, optionId: string | null): void {
        this._turn.handlePermissionResponse(id, optionId);
    }

    private _cancelPendingPermissions(): void {
        this._turn.cancelPendingPermissions();
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
        this._models.reset();
        this._tokenUsage = null;
        this._postTokenUsage();
        await this._connect(this._activeSelectionId || undefined);
    }

    private _resetViewTitleToDefault(): void {
        const view = this._surfaces.view;
        if (!view) {
            return;
        }
        view.title = undefined;
        view.description = undefined;
    }

    /** Commands from extension.ts. The work lives in environment/detection.ts. */
    public detectEnvironment(): Promise<void> {
        return this._detection.detectEnvironment();
    }

    public configureEnvironment(): void {
        this._detection.configureEnvironment();
    }


    private _postProfileList(): void {
        void this._ensureDiscoveredProfiles().then(() => {
            this._postMessage({ type: 'profileList', profiles: this._getProfileEntries() });
        });
    }



    /** Point the *live* session at another model. No session/new: Hermes' set_session_model
     *  swaps the agent in place, and a fresh session here would silently drop the tab's
     *  conversation (and leave an empty row in the catalog). */




    private async _handleUserMessage(text: string, contextAttach?: ContextAttachOption, images?: Array<{ mimeType: string; data: string }>): Promise<void> {
        const epoch = this._turn.sendEpoch;
        await this._awaitSessionReady();
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        await this._models.awaitSwitch();
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
        this._models.snapshotFromProfile();
        this._turn.promptSessionId = this._sessionId;
        const imageRefs = images && images.length ? this._attachments.storeImages(images) : undefined;
        if (imageRefs && imageRefs.length) {
            this._attachments.indexAttachments(imageRefs, text);
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
        return this._turn.cancel();
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
        this._models.snapshotFromProfile();
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

    /**
     * Retitle a tab through Hermes, then re-read the catalog.
     *
     * The rule lives in `session/catalog`; this supplies the wire call, the rescan and the log
     * line, so the handler goes away with the provider and the rule stays.
     */
    private async _handleRenameSession(sessionId: unknown, rawTitle: unknown): Promise<void> {
        if (typeof sessionId !== 'string' || !sessionId) {
            return;
        }
        const acp = this._acp;
        if (!acp) {
            this._log(`Rename needs a live connection (${sessionId})`);
            return;
        }
        // The strip's id is only the tab's: an adopted tab carries a local id, and Hermes would
        // answer "unknown session" for it.
        const hermesSessionId = hermesSessionIdFor(this._sessions, sessionId);
        const outcome = await renameSession({
            setTitle: (id, title) => acp.setSessionTitle(id, title),
            refreshCatalog: () => this._refreshSessionsFromHermes(),
            log: line => this._log(line),
        }, hermesSessionId, rawTitle);
        if (outcome.ok) {
            this._log(`Renamed ${hermesSessionId} to "${outcome.title}"`);
            return;
        }
        const detail = outcome.message ? ` — ${outcome.message}` : '';
        this._log(`Rename refused for ${hermesSessionId}: ${outcome.reason}${detail}`);
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
        const payload = buildSessionExportPayload(session, messages, this._models.currentLabel);
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
        this._models.reset();
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
        await this._models.awaitSwitch();
        if (!this._acp) {
            vscode.window.showWarningMessage(t('hermesNotConnectedConnecting'));
            await this._connect();
        }
        if (!this._acp) {
            vscode.window.showWarningMessage(t('hermesNotConnected'));
            return;
        }
        this._turn.promptSessionId = this._sessionId;
        this._models.snapshotFromProfile();
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
        this._detection.clear();
        this._acp?.dispose();
        this._acp = undefined;
        this._surfaces.detachView();
        this._output.dispose();
    }

    /** One way to reach the pane: every call site stays as it was. */
    private _postMessage(msg: HostToPane): void {
        this._surfaces.post(msg);
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
        const iconWebview = this._surfaces.iconWebview;
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
        this._turn.saveAssistantText();
        this._cancelPendingPermissions();
        this._saveCurrentSession();
        this._persistMessages();

        this._acp?.dispose();
        this._acp = undefined;
        this._models.reset();
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
        this._turn.saveAssistantText();
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
            if (!this._models.isRuntimeSource()) {
                this._models.reset();
            }
            void this._models.sync();
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
        if (!this._surfaces.view) {
            return;
        }
        this._log('Settings changed — reconnecting Hermes...');
        this._acp?.dispose();
        this._acp = undefined;
        this._models.reset();
        await this._connect(this._activeSelectionId || undefined);
    }

    private _getHtml(target?: vscode.Webview): string {
        const webview = target ?? this._surfaces.view?.webview;
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
