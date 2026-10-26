import * as vscode from 'vscode';
import * as fs from 'fs';
import { AttachmentStore } from '../cache/attachments';
import type { ChatMessage, SessionInfo, StoredImageRef } from '../types/chat';
import * as path from 'path';
import { AcpClient, PermissionRequest } from '../acp/AcpClient';
import { ModelState } from '../models/modelState';
import { normalizeHermesCliProfile } from '../environment/hermesProfile';
import { EnvironmentDetection } from '../environment/detection';
import {
    activeSessionPathFor,
    migrateLegacySessionStorage,
    sessionsPathFor,
} from '../cache/profileStorage';
import { getLocale, getWebviewLocale, initI18n, t } from '../i18n';
import { resolvePermissionOptionLabel } from '../i18n/permissionOptions';
import { SupportedLocale } from '../i18n/types';
import { buildWebviewHtml } from '../webview/html';
import { ContextAttachOffer } from './contextAttach';
import { Surfaces } from '../webview/surfaces';
import { WorkspaceFiles } from '../workspace/files';
import type { ChatSurface } from '../webview/surfaces';
import type { HostToPane, PaneToHost } from '../types/webview';
import { handleWebviewMessage } from '../webview/router';
import type { RouterHost } from '../webview/router';
import { Sessions } from '../cache/sessions';
import { Profiles } from '../environment/profiles';
import { Connection } from './connection';
import { TabLifecycle } from '../tabs/lifecycle';
import { PromptRunner } from './promptRunner';
import { classifyLogLevel, LogLevel } from '../logLevel';
import {
    ContextAttachOption,
} from './contextAttach';

/**
 * `onNewSession` is a Rina-era name kept for settings compatibility. A tab no longer gets a new
 * session behind its back; the picker shows when a tab's transcript is restored, until the
 * first reply.
 */

/** The panel id lives with the panel; re-exported so extension.ts keeps one import site. */
export { CHAT_PANEL_VIEW_TYPE } from '../webview/surfaces';

/** The key an attachment is filed under: the message text, markers and spacing removed. */


export class HermesChatProvider implements vscode.WebviewViewProvider {
    // ---- Lifecycle ----
    /** Every live renderer: the sidebar view and/or the single chat panel. */
    /** Where the conversation is rendered: the side bar or an editor tab. */
    /** Context attach: the picker over this tab's own transcript, and the prompt it prepends. */
    private readonly _contextAttach: ContextAttachOffer = new ContextAttachOffer({
        post: (msg) => this._postMessage(msg),
        messages: () => this._sessionMessages,
    });
    /** The workspace as the pane and the agent may touch it: paths, picker, previews, fs. */
    private readonly _files: WorkspaceFiles = new WorkspaceFiles({
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
    });
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
    /** The tab list, the active id, the transcript, the hidden rows, the scope and the store. */
    private _session!: Sessions;
    private get _scopeKey(): string { return this._session.scopeKey; }
    private get _sessionMessages(): ChatMessage[] { return this._session.messages; }
    private set _sessionMessages(value: ChatMessage[]) { this._session.messages = value; }
    private get _sessionId(): string { return this._session.activeId; }
    private set _sessionId(value: string) { this._session.activeId = value; }
    private get _sessions(): SessionInfo[] { return this._session.tabs; }
    private set _sessions(value: SessionInfo[]) { this._session.tabs = value; }
    /** Which profile/agent we connect to, and which the picker offers. */
    private readonly _profiles: Profiles;
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
        resolveCwd: () => this._files.resolveCwd(),
        log: (line) => this._log(line),
        post: (msg) => this._postMessage(msg),
        otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
        acpStatus: () => this._acp?.status,
        isViewingPromptSession: () => this._isViewingPromptSession(),
        cancelPendingPermissions: () => this._cancelPendingPermissions(),
        awaitSessionReady: () => this._awaitSessionReady(),
        setContextAttachAwaitingReply: (value) => { this._contextAttach.setAwaitingReply(value); },
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
    /** A tab's life as Hermes knows it: resume/adopt, replay, switch, close, open, rename. */
    private readonly _lifecycle: TabLifecycle;
    /** Chat session currently bound to the single ACP agent runtime context. */
    private _acpBoundSessionId: string = '';
    /** Hermes: process, link, events, teardown. */
    private _connection!: Connection;
    /** Read-only view of the live client; there is deliberately no setter. */
    private get _acp(): AcpClient | undefined { return this._connection?.acp; }
    /** This tab's own messages offered to the picker; not an earlier session. */
    /** Finding and starting Hermes on this machine, plus the configure panel around it. */
    private readonly _detection = new EnvironmentDetection({
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
        reconnect: () => this._connect(this._profiles.selectionId || undefined),
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
        this._profiles = new Profiles({
            log: (line) => this._log(line),
            post: (msg) => this._postMessage(msg),
            globalState: context.globalState,
        });
        this._output = vscode.window.createOutputChannel('Hermes Chat', 'hermes-chat');
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        this._historyDir = storagePath;
        this._attachments = new AttachmentStore(this._historyDir);
        migrateLegacySessionStorage(this._historyDir, '__default__');

        const initialTarget = this._profiles.seed();
        this._session = new Sessions(this._historyDir, initialTarget.scopeKey, {
            post: (msg) => this._postMessage(msg),
            log: (line) => this._log(line),
            updatePanelTitle: () => this._surfaces.updatePanelTitle(),
            modelLabel: () => this._models.currentLabel,
        });
        this._session.init();
        this._lifecycle = new TabLifecycle({
            acp: () => this._acp,
            session: this._session,
            post: (msg) => this._postMessage(msg),
            postTo: (surface, msg) => this._surfaces.postTo(surface, msg),
            log: (line) => this._log(line),
            resolveCwd: () => this._files.resolveCwd(),
            attachments: this._attachments,
            offerContextAttach: (messages) => this._contextAttach.offer(messages),
            promptSessionId: () => this._turn.promptSessionId,
            detachActivePrompt: (id, options) => this._detachActivePrompt(id, options),
            otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
            syncModelStateForCurrentSession: () => this._syncModelStateForCurrentSession(),
            syncPromptUiIfReturningToOwner: () => this._syncPromptUiIfReturningToOwner(),
            snapshotModelFromProfile: () => this._models.snapshotFromProfile(),
            saveCatalog: () => this._saveCatalog(),
            saveCurrent: () => this._saveCurrentSession(),
            ensureRegistered: () => this._ensureSessionRegistered(),
            msgPath: (id) => this._msgPath(id),
            postSessionList: () => this._postSessionList(),
            loadHistory: () => this._loadHistory(),
            activate: (id, options) => this._activateSession(id, options),
            workspaceState: context.workspaceState,
        });
        this._connection = new Connection({
            profiles: this._profiles,
            session: this._session,
            turn: this._turn,
            models: this._models,
            detection: this._detection,
            files: this._files,
            contextAttach: this._contextAttach,
            lifecycle: this._lifecycle,
            post: (msg) => this._postMessage(msg),
            log: (line) => this._log(line),
            postWebviewLog: (line, level) => this._postWebviewLog(line, level),
            isViewingPromptSession: () => this._isViewingPromptSession(),
            setBoundSessionId: (id) => { this._acpBoundSessionId = id; },
            surfaceView: () => this._surfaces.view,
        });

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('hermes')) {
                    void this._onConfigurationChanged(e);
                }
            })
        );
    }

    private _msgPath(sid: string): string { return this._session.msgPath(sid); }

    /** One-line delegates: the tab lifecycle moved to tabs/lifecycle.ts, the callers stayed. */
    private _restoreMessages(target?: ChatSurface): void { this._lifecycle.restoreMessages(target); }
    private _bindHermesSessionId(hermesSessionId: string): void { this._lifecycle.bindHermesSessionId(hermesSessionId); }
    private async _handleSwitchSession(
        sessionId: string,
        options?: { skipSaveCurrent?: boolean; interrupt?: boolean }
    ): Promise<void> {
        await this._lifecycle.switchTo(sessionId, options);
    }
    private async _handleCloseSessions(sessionId: string, mode: unknown): Promise<void> {
        await this._lifecycle.closeSessions(sessionId, mode);
    }
    private async _handleOpenTab(sessionId?: string): Promise<void> { await this._lifecycle.openTab(sessionId); }
    private async _handleRenameSession(sessionId: unknown, rawTitle: unknown): Promise<void> {
        await this._lifecycle.renameTab(sessionId, rawTitle);
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
        this._profiles.postList();
        this._postHiddenSessions();
        this._postConfig();
        this._postTokenUsage();
        // A pane can be brand new (container move, view re-show): replay the state
        // a freshly connected pane would have or it renders placeholders — an empty
        // "Profile" pill, a model chip with nothing in it.
        this._postMessage({ type: 'activeAgent', name: this._profiles.displayName });
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
                this._connection.drop();
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
            handleOpenFile: (path) => this._files.openFile(path),
            handleListFiles: (query, requestId) => this._files.listFiles(query, requestId),
            handlePreviewFile: (path, requestId) => this._files.previewFile(path, requestId),
            postHiddenSessions: () => this._postHiddenSessions(),
            handleOpenTab: (sessionId) => this._handleOpenTab(sessionId),
            handleReorderSessions: (ids) => this._handleReorderSessions(ids),
            handleCloseSessions: (sessionId, mode) => this._handleCloseSessions(sessionId, mode),
            handleRenameSession: (sessionId, title) => this._handleRenameSession(sessionId, title),
            handleTogglePinSession: (sessionId) => this._handleTogglePinSession(sessionId),
            handleSessionExport: (sessionId, action, indices) => this._handleSessionExport(sessionId, action, indices),
            handleSwitchAgent: (name) => this._connection.switchProfile(name),
            handleSwitchSession: (sessionId, interrupt) => {
                if (this._surfaces.mode === 'editor' && !this._surfaces.hasPanel) {
                    this._surfaces.openPanel();
                }
                this._enqueueChatOp(() => this._handleSwitchSession(sessionId, { interrupt }));
            },
            switchModel: (configId, valueId) => this._models.switchModel(configId, valueId),
            syncModels: () => this._models.sync(),
            postProfileList: () => this._profiles.postList(),
            retry: () => this._connection.retry(),
            handlePermissionResponse: (id, optionId) => this._handlePermissionResponse(id, optionId),
            handleInsertEditor: (text) => this._files.insertEditor(text),
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
    /** Read the catalog; null when there is no connection to ask. */

    /** Refresh the tab list from Hermes, then repaint it. */

    /** Resume one tab's Hermes session; false when the tab has nothing to resume. */

    /**
     * Render the transcript Hermes replayed for a loaded session.
     *
     * `session/load` streams history as whole-message updates; AcpClient collects
     * them and hands them over once the load resolves. They are cached to the
     * tab's message file so the next switch renders from disk instead of
     * replaying, and only painted when that tab is still the open one.
     */

    /** Remember which Hermes session backs the current tab and this workspace. */

    /** True when the current tab has a usable Hermes session. */
    private async _ensureAcpReadyForCurrentSession(): Promise<boolean> {
        return this._turn.ensureSessionReady();
    }

    private _clearPromptStallTimer(): void {
        this._turn.clearStallHint();
    }

    private async _detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void> {
        return this._turn.detachActivePrompt(fromSessionId, options);
    }

    private _saveMessage(role: string, text: string, toolCallId?: string, imageRefs?: StoredImageRef[]): void {
        this._session.saveMessage(role, text, toolCallId, imageRefs);
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

    private _flushThoughtToHistory(): void {
        this._turn.flushThought();
    }

    private _persistMessages(): void { this._session.persistMessages(); }

    private _savePermissionRequest(id: string, request: PermissionRequest): void {
        this._session.savePermissionRequest(id, request);
    }

    private _resolvePermissionHistory(
        id: string,
        outcome: 'selected' | 'cancelled',
        selectedOptionId?: string,
        selectedLabel?: string
    ): void {
        this._session.resolvePermissionHistory(id, outcome, selectedOptionId, selectedLabel);
    }

    private _loadHistory(): void { this._session.loadHistory(); }

    private _saveCurrentSession(): void { this._session.saveCurrent(); }

    private _ensureSessionRegistered(): void { this._session.ensureRegistered(); }

    private _postSessionList(): void { this._session.postList(); }

    private _postHiddenSessions(): void { this._session.postHidden(); }

    private _saveCatalog(): boolean { return this._session.saveCatalog(); }

    private _markSessionAgentEngaged(): void { this._session.markEngaged(); }


    private async _connect(selectionId?: string): Promise<void> { return this._connection.connect(selectionId); }
    private async _awaitSessionReady(): Promise<void> { return this._connection.awaitSessionReady(); }
    private _postTokenUsage(): void { this._connection.postTokenUsage(); }

    private _enqueueChatOp(op: () => Promise<void>): void {
        this._chatOpChain = this._chatOpChain
            .then(op)
            .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Chat operation failed: ${msg}`);
            });
    }

    private _handlePermissionResponse(id: string, optionId: string | null): void {
        this._turn.handlePermissionResponse(id, optionId);
    }

    private _cancelPendingPermissions(): void {
        this._turn.cancelPendingPermissions();
    }

    /** One automatic reconnect after the process dies; the Retry button covers the rest. */
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
        if (this._contextAttach.isActive()) {
            this._contextAttach.setAwaitingReply(true);
        }
        const promptText = this._contextAttach.buildPromptText(text, contextAttach);
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

    private _handleDeleteMessages(indices: unknown): void { this._session.handleDeleteMessages(indices); }

    /**
     * A prompt belongs to the tab it was started in, so switching away from a running one
     * has to end it first. Returns false when the switch must not happen at all.
     */

    private _activateSession(sessionId: string, options?: { skipSaveCurrent?: boolean }): void {
        this._session.activate(sessionId, options);
    }

    private _handleReorderSessions(sessionIds: unknown): void { this._session.handleReorderSessions(sessionIds); }

    /**
     * Close tabs by hiding their sessions.
     *
     * Closing is not deletion: the transcript, the title and the cwd all stay in Hermes,
     * the row simply stops being an open tab, and `[+ Open Tab]` is where it comes back.
     */

    /** Hide the given tabs, move focus off a closed tab, then re-read the catalog. */

    /** Open a closed session as a tab; with nothing picked, open a blank tab instead of
     *  starting a session inside the tab the user is already reading. */

    /**
     * Retitle a tab through Hermes, then re-read the catalog.
     *
     * The rule lives in `session/catalog`; this supplies the wire call, the rescan and the log
     * line, so the handler goes away with the provider and the rule stays.
     */

    private _handleTogglePinSession(sessionId: string): void { this._session.handleTogglePinSession(sessionId); }

    private _handleSessionExport(sessionId: string, action: unknown, indices?: unknown): void {
        this._session.handleSessionExport(sessionId, action, indices);
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
        this._clearPromptStallTimer();
        this._saveCurrentSession();
        this._cancelPendingPermissions();
        this._detection.clear();
        this._connection.dispose();
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

        this._connection.drop();
        this._models.reset();
        this._connection.tokenUsage = null;
        this._postTokenUsage();

        this._postMessage({ type: 'newChat' });
        await this._connect(this._profiles.selectionId || undefined);
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
            this._contextAttach.applyVisibility();
        }
        if (e.affectsConfiguration('tommys.models') || e.affectsConfiguration('tommys.defaultModel')) {
            if (!this._models.isRuntimeSource()) {
                this._models.reset();
            }
            void this._models.sync();
        }
        if (e.affectsConfiguration('tommys.agents')) {
            this._profiles.forgetDiscovered();
            this._profiles.postList();
        }
        const reconnectKeys = ['tommys.path', 'tommys.cwd', 'tommys.profile'];
        if (reconnectKeys.some(k => e.affectsConfiguration(k))) {
            if (e.affectsConfiguration('tommys.profile') && this._profiles.readAgentConfigs().length === 0) {
                const config = vscode.workspace.getConfiguration('tommys');
                this._profiles.selectionId = normalizeHermesCliProfile(config.get<string>('profile'));
            }
            await this._connection.reconnectForConfig();
        }
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

    /** Check if path is within workspace folders. Allows absolute paths only if inside workspace. */
}
