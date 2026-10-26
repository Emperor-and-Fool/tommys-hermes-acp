import * as vscode from 'vscode';
import * as fs from 'fs';
import { AttachmentStore } from './cache/attachments';
import * as path from 'path';
import { ModelState } from './models/modelState';
import { normalizeHermesCliProfile } from './environment/hermesProfile';
import { EnvironmentDetection } from './environment/detection';
import { migrateLegacySessionStorage } from './cache/profileStorage';
import { getLocale, getWebviewLocale, initI18n, t } from './i18n';
import { resolvePermissionOptionLabel } from './i18n/permissionOptions';
import { SupportedLocale } from '../shared/i18n';
import { buildWebviewHtml } from './webview/html';
import { Surfaces } from './webview/surfaces';
import { HistoryViewer } from './webview/historyViewer';
import { WorkspaceFiles } from './workspace/files';
import type { ChatSurface } from './webview/surfaces';
import type { HostToPane, PaneToHost } from '../shared/webview';
import { handleWebviewMessage } from './webview/router';
import type { RouterHost } from './webview/router';
import { Sessions } from './cache/sessions';
import { Profiles } from './environment/profiles';
import { Connection } from './chat/connection';
import { TabLifecycle } from './tabs/lifecycle';
import { PromptRunner } from './chat/promptRunner';
import { HistoryAttach, blockMessageLines } from './chat/historyAttach';
import { exportSessionMessages, matchMessageIds } from './chat/historyLookup';
import { tryResolveHermesQuick } from './environment/hermesEnvironmentDetect';
import { findHermesExecutable } from './environment/profileDiscovery';
import type { HistoryPick } from './webview/historyViewer';
import { classifyLogLevel, LogLevel } from './logLevel';
/**
 * `onNewSession` is a Rina-era name kept for settings compatibility. A tab no longer gets a new
 * session behind its back; the picker shows when a tab's transcript is restored, until the
 * first reply.
 */

/** The panel id lives with the panel; re-exported so extension.ts keeps one import site. */

/** The key an attachment is filed under: the message text, markers and spacing removed. */


export class App implements vscode.WebviewViewProvider {

    // ---- Session State ----
    private _historyDir: string;

    /** Bytes Hermes never stores: content-addressed images and the index that finds them. */
    private _attachments: AttachmentStore;

    /** The tab list, the active id, the transcript, the hidden rows, the scope and the store. */
    private _session!: Sessions;








    // ---- Lifecycle ----
    /** Every live renderer: the sidebar view and/or the single chat panel. */
    /** Where the conversation is rendered: the side bar or an editor tab. */
    /**
     * Turn-scoped state and session acquisition. The host literals are the whole coupling
     * between a turn and the provider: every member here stays private, and this is the one
     * place where the runner reaches the pane, the transcript and the tab list.
     */
    private readonly _turn: PromptRunner = new PromptRunner({
        acp: () => this._connection.acp,
        sessionId: () => this._session.activeId,
        messages: () => this._session.messages,
        tabs: () => this._session.tabs,
        resolveCwd: () => this._files.resolveCwd(),
        log: (line) => this._log(line),
        post: (msg) => this._postMessage(msg),
        otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
        acpStatus: () => this._connection.acp?.status,
        isViewingPromptSession: () => this._isViewingPromptSession(),
        cancelPendingPermissions: () => this._turn.cancelPendingPermissions(),
        awaitSessionReady: () => this._connection.awaitSessionReady(),
        detachActivePrompt: (id, options) => this._turn.detachActivePrompt(id, options),
        bindHermesSessionId: (id) => this._lifecycle.bindHermesSessionId(id),
        applySessionModelPreference: () => this._models.applySessionPreference(),
        setBoundSessionId: (id) => { this._acpBoundSessionId = id; },
        saveMessage: (role, text) => this._session.saveMessage(role, text),
        savePermissionRequest: (id, request) => this._session.savePermissionRequest(id, request),
        resolvePermissionHistory: (id, outcome, optionId, label) => this._resolvePermissionHistory(id, outcome, optionId, label),
        permissionOptionLabel: (id, optionId) => {
            const stored = this._session.messages.find(m => m.permissionId === id && m.role === 'permission');
            const opt = stored?.options?.find(o => o.optionId === optionId);
            return opt ? resolvePermissionOptionLabel(getWebviewLocale(), opt) : undefined;
        },
    });

    /** Hermes: process, link, events, teardown. */
    private readonly _connection: Connection;


    /** Which profile/agent we connect to, and which the picker offers. */
    private readonly _profiles: Profiles;

    /** This tab's own messages offered to the picker; not an earlier session. */
    /** Finding and starting Hermes on this machine, plus the configure panel around it. */
    private readonly _detection = new EnvironmentDetection({
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
        reconnect: () => this._connection.connect(this._profiles.selectionId || undefined),
        resetViewTitle: () => this._resetViewTitleToDefault(),
    });

    private _webviewLocale?: SupportedLocale;

    /** Which model, from where: the chip, the switch, and the persisted choice. */
    private readonly _models: ModelState = new ModelState({
        acp: () => this._connection.acp,
        tabs: () => this._session.tabs,
        sessionId: () => this._session.activeId,
        saveCatalog: () => this._session.saveCatalog(),
        profileScope: () => ({ historyDir: this._historyDir, scopeKey: this._session.scopeKey }),
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
        otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
        detachOtherPrompt: () => this._turn.detachActivePrompt(this._turn.promptSessionId!, { savePartial: true }),
        setBoundSessionId: (id) => { this._acpBoundSessionId = id; },
    });

    /** A tab's life as Hermes knows it: resume/adopt, replay, switch, close, open, rename. */
    private readonly _lifecycle: TabLifecycle;

    /** Chat session currently bound to the single ACP agent runtime context. */
    private _acpBoundSessionId: string = '';

    /** The renderers of the chat: side bar view, editor panel, or both at once. */
    private readonly _surfaces: Surfaces = new Surfaces({
        html: (webview) => this._getHtml(webview),
        wire: (webview, surface) => this._wireMessages(webview, surface),
        activeTabTitle: () => this._activeTabTitle(),
        onViewResolved: () => { this._webviewLocale = getLocale(); },
        onViewVisible: () => {
            this._syncWebviewLocale();
            if (!this._connection.acp) {
                this._connection.connect();
            }
        },
        localResourceRoots: () => [this._extensionUri],
        log: (line) => this._log(line),
    });

    /**
     * The read-only history viewer: one temporary editor tab, deliberately outside `_surfaces`,
     * so no chat traffic is ever fanned out to it.
     */
    private readonly _historyViewer: HistoryViewer = new HistoryViewer({
        html: (webview) => this._getHtml(webview),
        localResourceRoots: () => [this._extensionUri],
        tabs: () => this._session.tabs,
        readMessages: (localId) => this._session.store.readMessages(localId),
        profile: () => this._profiles.resolveTarget().cliProfile,
        onPicked: (pick) => { this._stageHistory(pick); },
        focusComposer: () => this._postMessage({ type: 'focusComposer' }),
        log: (line) => this._log(line),
    });

    /** The staged slice of another conversation: the chip, the block, and the lookup behind it. */
    private readonly _historyAttach: HistoryAttach = new HistoryAttach();

    /** The id lookup in flight: a send waits for it so the block carries ids, not just an anchor. */
    private _historyLookup: Promise<void> = Promise.resolve();

    private readonly _extensionId: string;

    /** The workspace as the pane and the agent may touch it: paths, picker, previews, fs. */
    private readonly _files: WorkspaceFiles = new WorkspaceFiles({
        post: (msg) => this._postMessage(msg),
        log: (line) => this._log(line),
    });

    private _output: vscode.OutputChannel;

    /** Serializes webview send so rapid sends cannot overlap. */
    private _chatOpChain: Promise<void> = Promise.resolve();

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
            acp: () => this._connection.acp,
            session: this._session,
            post: (msg) => this._postMessage(msg),
            postTo: (surface, msg) => this._surfaces.postTo(surface, msg),
            log: (line) => this._log(line),
            resolveCwd: () => this._files.resolveCwd(),
            attachments: this._attachments,
            promptSessionId: () => this._turn.promptSessionId,
            detachActivePrompt: (id, options) => this._turn.detachActivePrompt(id, options),
            otherSessionIsPrompting: () => this._otherSessionIsPrompting(),
            syncModelStateForCurrentSession: () => this._syncModelStateForCurrentSession(),
            syncPromptUiIfReturningToOwner: () => this._syncPromptUiIfReturningToOwner(),
            snapshotModelFromProfile: () => this._models.snapshotFromProfile(),
            saveCatalog: () => this._session.saveCatalog(),
            saveCurrent: () => this._session.saveCurrent(),
            ensureRegistered: () => this._session.ensureRegistered(),
            msgPath: (id) => this._session.msgPath(id),
            postSessionList: () => this._session.postList(),
            loadHistory: () => this._session.loadHistory(),
            activate: (id, options) => this._session.activate(id, options),
            workspaceState: context.workspaceState,
        });
        this._connection = new Connection({
            profiles: this._profiles,
            session: this._session,
            turn: this._turn,
            models: this._models,
            detection: this._detection,
            files: this._files,
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
                if (e.affectsConfiguration('tommys')) {
                    void this._onConfigurationChanged(e);
                }
            })
        );
    }





    private _resolvePermissionHistory(
        id: string,
        outcome: 'selected' | 'cancelled',
        selectedOptionId?: string,
        selectedLabel?: string
    ): void {
        this._session.resolvePermissionHistory(id, outcome, selectedOptionId, selectedLabel);
    }

















    private _isViewingPromptSession(): boolean {
        return !this._turn.promptSessionId || this._turn.promptSessionId === this._session.activeId;
    }

    private _otherSessionIsPrompting(): boolean {
        return this._connection.acp?.status === 'prompting'
            && !!this._turn.promptSessionId
            && this._turn.promptSessionId !== this._session.activeId;
    }

    private _syncPromptUiIfReturningToOwner(): void {
        if (!this._turn.promptSessionId || this._turn.promptSessionId !== this._session.activeId) {
            return;
        }
        if (this._connection.acp?.status !== 'prompting') {
            return;
        }
        this._postMessage({ type: 'status', status: 'prompting', sessionId: this._session.activeId });
        if (this._turn.lastThoughtText) {
            this._postMessage({
                type: 'addMessage',
                role: 'thought',
                text: this._turn.lastThoughtText,
                sessionId: this._session.activeId,
            });
        }
        if (this._turn.lastAssistantText) {
            this._postMessage({
                type: 'addMessage',
                role: 'assistant',
                text: this._turn.lastAssistantText,
                sessionId: this._session.activeId,
            });
        }
    }



















    /** Point the *live* session at another model. No session/new: Hermes' set_session_model
     *  swaps the agent in place, and a fresh session here would silently drop the tab's
     *  conversation (and leave an empty row in the catalog). */

    private async _handleUserMessage(text: string, images?: Array<{ mimeType: string; data: string }>): Promise<void> {
        const epoch = this._turn.sendEpoch;
        await this._connection.awaitSessionReady();
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        await this._models.awaitSwitch();
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        if (this._session.tabs.length === 0) {
            this._postMessage({ type: 'noActiveTab' });
            return;
        }
        const ready = await this._turn.ensureSessionReady();
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
        // A staged pick whose lookup is still running: wait rather than send only the anchor.
        // runHermesCommand caps the export at 15 s, so this cannot hang the turn.
        if (this._historyAttach.current) {
            await this._historyLookup;
            if (epoch !== this._turn.sendEpoch) {
                return;
            }
        }
        const staged = this._historyAttach.current;
        this._models.snapshotFromProfile();
        this._turn.promptSessionId = this._session.activeId;
        const imageRefs = images && images.length ? this._attachments.storeImages(images) : undefined;
        if (imageRefs && imageRefs.length) {
            this._attachments.indexAttachments(imageRefs, text);
        }
        if (staged) {
            // The card is part of the transcript before the question it belongs to, both live
            // and in the stored file, so a reload reads the same way.
            const lines = blockMessageLines(staged.ref, staged.messages).join('\n');
            this._session.saveMessage('history', lines, undefined, undefined, staged.ref);
            this._postMessage({
                type: 'addMessage',
                role: 'history',
                text: lines,
                history: staged.ref,
                sessionId: this._session.activeId,
            });
        }
        this._session.saveMessage('user', text, undefined, imageRefs);
        this._session.markEngaged();
        if (epoch !== this._turn.sendEpoch) {
            return;
        }
        const historyBlock = staged ? this._historyAttach.block() : '';
        if (imageCount > 0 || historyBlock) {
            // Compose an ACP prompt: the attached conversation first, then the user's own text,
            // then one image block per staged image. Hermes' ACP adapter advertises
            // promptCapabilities.image=true and decodes these directly.
            const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }> = [];
            if (historyBlock) {
                blocks.push({ type: 'text', text: historyBlock });
            }
            if (text.length > 0) {
                blocks.push({ type: 'text', text });
            }
            for (const img of images || []) {
                blocks.push({ type: 'image', mimeType: img.mimeType || 'image/png', data: img.data });
            }
            await this._connection.acp?.sendMessage(blocks as any);
        } else {
            await this._connection.acp?.sendMessage(text);
        }
        if (staged) {
            this._historyAttach.clear();
            this._postMessage({ type: 'historyCleared' });
        }
    }



    public async sendText(text: string): Promise<void> {
        await this._connection.awaitSessionReady();
        await this._models.awaitSwitch();
        if (!this._connection.acp) {
            vscode.window.showWarningMessage(t('hermesNotConnectedConnecting'));
            await this._connection.connect();
        }
        if (!this._connection.acp) {
            vscode.window.showWarningMessage(t('hermesNotConnected'));
            return;
        }
        this._turn.promptSessionId = this._session.activeId;
        this._models.snapshotFromProfile();
        this._postMessage({ type: 'addMessage', role: 'user', text, sessionId: this._session.activeId });
        this._session.saveMessage('user', text);
        this._session.markEngaged();
        await this._turn.ensureSessionReady();
        await this._connection.acp.sendMessage(text);
    }

    /** Commands from extension.ts. The work lives in environment/detection.ts. */
    public detectEnvironment(): Promise<void> {
        return this._detection.detectEnvironment();
    }

    public configureEnvironment(): void {
        this._detection.configureEnvironment();
    }

    private async _onConfigurationChanged(e: vscode.ConfigurationChangeEvent): Promise<void> {
        if (e.affectsConfiguration('tommys.showThoughts') || e.affectsConfiguration('tommys.showToolCalls')) {
            this._postConfig();
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
        this._session.postList();
    }

    private async _syncModelStateForCurrentSession(): Promise<void> {
        await this._models.sync();
        if (this._otherSessionIsPrompting()) {
            return;
        }
        if (this._acpBoundSessionId === this._session.activeId) {
            await this._models.applySessionPreference();
        }
    }







    /** Phase 3: another session's transcript, read-only, in one temporary editor tab. */
    public openHistoryViewer(hermesSessionId: string, title: string): void {
        this._historyViewer.open(hermesSessionId, title);
    }

    /** The viewer came back with ticks: the chip first, the real ids when the lookup answers. */
    private _stageHistory(pick: HistoryPick): void {
        const staged = this._historyAttach.stage(pick.ref, pick.messages);
        this._postMessage({ type: 'historyStaged', ref: staged.ref, pending: true });
        this._historyLookup = this._lookupHistoryIds(pick);
    }

    /**
     * The real Hermes ids for the picked lines, read from the export at Attach time.
     * A failed or slow export is not an error: the block falls back to the anchor.
     */
    private async _lookupHistoryIds(pick: HistoryPick): Promise<void> {
        let match: { ids: Array<number | null>; from?: number; to?: number } | null = null;
        try {
            const executable = await this._resolveHermesExecutable();
            if (executable) {
                const exported = await exportSessionMessages(executable, pick.ref.profile, pick.ref.sessionId);
                if (exported.length) {
                    match = matchMessageIds(pick.messages, exported);
                } else {
                    this._log('History lookup: the export returned no messages; attaching by anchor');
                }
            } else {
                this._log('History lookup: no Hermes executable found; attaching by anchor');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._log(`History lookup failed: ${message}`);
        }
        this._finishHistoryStaging(pick, match);
    }

    /** Stage what the lookup gave (the anchor when it gave nothing) and restate the chip. */
    private _finishHistoryStaging(
        pick: HistoryPick,
        match: { ids: Array<number | null>; from?: number; to?: number } | null
    ): void {
        const current = this._historyAttach.current;
        // A different pick staged while this lookup ran: only the live one may be restated.
        if (!current || current.ref.sessionId !== pick.ref.sessionId || current.ref.title !== pick.ref.title) {
            return;
        }
        const ref = match ? { ...pick.ref, from: match.from, to: match.to } : pick.ref;
        const staged = this._historyAttach.stage(ref, pick.messages, match ? match.ids : undefined);
        const matched = (staged.ref.messageIds || []).some(id => id !== null);
        this._postMessage({ type: 'historyStaged', ref: staged.ref, pending: false });
        this._log(`History staged: ${staged.messages.length} message(s), ${matched ? 'ids found' : 'anchor only'}`);
    }

    /** The executable the connection would start: the configured path first, then the search. */
    private async _resolveHermesExecutable(): Promise<string | undefined> {
        const configured = vscode.workspace.getConfiguration('tommys').get<string>('path');
        const quick = await tryResolveHermesQuick(configured);
        if (quick) {
            return quick;
        }
        return (await findHermesExecutable(configured)) || undefined;
    }

    /** The chip's X: drop the pick and say so. */
    public clearHistoryStaged(): void {
        this._historyAttach.clear();
        this._historyLookup = Promise.resolve();
        this._postMessage({ type: 'historyCleared' });
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
        this._session.postList();
        this._profiles.postList();
        this._session.postHidden();
        this._postConfig();
        this._connection.postTokenUsage();
        // A pane can be brand new (container move, view re-show): replay the state
        // a freshly connected pane would have or it renders placeholders — an empty
        // "Profile" pill, a model chip with nothing in it.
        this._postMessage({ type: 'activeAgent', name: this._profiles.displayName });
        this._models.postList();
        if (surface.role === 'chat') {
            this._lifecycle.restoreMessages(surface);
        }
        if (this._surfaces.mode === 'editor' && !this._surfaces.hasPanel
            && this._surfaces.hasViewSurface) {
            this._surfaces.openPanel();
        }
        // Moving the view container disposes and re-creates the webview but keeps
        // the ACP client. The new pane knows nothing and its composer starts
        // disabled, so replay the live status — otherwise the UI looks frozen and
        // only a window reload recovers.
        if (this._connection.acp) {
            const liveStatus = this._connection.acp.status;
            this._surfaces.postTo(surface, { type: 'status', status: liveStatus, sessionId: this._session.activeId });
            if (liveStatus === 'idle' || liveStatus === 'error') {
                this._connection.drop();
            }
        }
        this._connection.connect();
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
            handleUserMessage: (text, images) => this._handleUserMessage(
                text,
                images as Array<{ mimeType: string; data: string }> | undefined,
            ),
            handleCancel: () => this._turn.cancel(),
            handleOpenFile: (path) => this._files.openFile(path),
            handleListFiles: (query, requestId) => this._files.listFiles(query, requestId),
            handlePreviewFile: (path, requestId) => this._files.previewFile(path, requestId),
            postHiddenSessions: () => this._session.postHidden(),
            handleOpenTab: (sessionId) => this._lifecycle.openTab(sessionId),
            handleReorderSessions: (ids) => this._session.handleReorderSessions(ids),
            handleCloseSessions: (sessionId, mode) => this._lifecycle.closeSessions(sessionId, mode),
            handleRenameSession: (sessionId, title) => this._lifecycle.renameTab(sessionId, title),
            handleTogglePinSession: (sessionId) => this._session.handleTogglePinSession(sessionId),
            handleSessionExport: (sessionId, action, indices) => this._session.handleSessionExport(sessionId, action, indices),
            handleSwitchAgent: (name) => this._connection.switchProfile(name),
            handleSwitchSession: (sessionId, interrupt) => {
                if (this._surfaces.mode === 'editor' && !this._surfaces.hasPanel) {
                    this._surfaces.openPanel();
                }
                this._enqueueChatOp(() => this._lifecycle.switchTo(sessionId, { interrupt }));
            },
            switchModel: (configId, valueId) => this._models.switchModel(configId, valueId),
            syncModels: () => this._models.sync(),
            postProfileList: () => this._profiles.postList(),
            retry: () => this._connection.retry(),
            handlePermissionResponse: (id, optionId) => this._turn.handlePermissionResponse(id, optionId),
            handleInsertEditor: (text) => this._files.insertEditor(text),
            handleDeleteMessages: (indices) => this._session.handleDeleteMessages(indices),
            openHistoryViewer: (sessionId, title) => this.openHistoryViewer(sessionId, title),
            clearHistoryStaged: () => this.clearHistoryStaged(),
            detection: () => this._detection,
        };
    }

    private _activeTabTitle(): string {
        const rec = this._session.tabs.find(item => item.id === this._session.activeId);
        return rec?.title || t('newChat');
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

    private _enqueueChatOp(op: () => Promise<void>): void {
        this._chatOpChain = this._chatOpChain
            .then(op)
            .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Chat operation failed: ${msg}`);
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

    private async _handleReloadSession(): Promise<void> {
        this._log('Reload session requested');
        this._turn.sendEpoch++;
        this._turn.flushThought();
        this._turn.saveAssistantText();
        this._turn.cancelPendingPermissions();
        this._session.saveCurrent();
        this._session.persistMessages();

        this._connection.drop();
        this._models.reset();
        this._connection.tokenUsage = null;
        this._connection.postTokenUsage();

        this._postMessage({ type: 'newChat' });
        await this._connection.connect(this._profiles.selectionId || undefined);
        this._lifecycle.restoreMessages();
    }

    private async _handleReloadExtension(): Promise<void> {
        this._log('Reload extension requested');
        this._turn.sendEpoch++;
        this._turn.flushThought();
        this._turn.saveAssistantText();
        this._turn.cancelPendingPermissions();
        this._session.saveCurrent();
        this._session.persistMessages();
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

    public dispose(): void {
        this._turn.clearStallHint();
        this._session.saveCurrent();
        this._turn.cancelPendingPermissions();
        this._detection.clear();
        this._connection.dispose();
        this._surfaces.detachView();
        this._historyViewer.dispose();
        this._output.dispose();
    }

}