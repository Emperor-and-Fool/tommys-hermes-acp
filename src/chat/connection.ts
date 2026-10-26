import * as vscode from 'vscode';
import { AcpClient, TokenUsage } from '../acp/AcpClient';
import { resolveMcpServersForSession } from '../acp/mcpConfig';
import { tryResolveHermesQuick } from '../environment/profileDiscovery';
import { formatDetectBrokenMessage } from '../environment/detectFormat';
import { localizeStatusMessage, t } from '../i18n';
import { classifyLogLevel, LogLevel } from '../logLevel';
import type { HostToPane } from '../types/webview';
import type { Profiles } from '../environment/profiles';
import type { EnvironmentDetection } from '../environment/detection';
import type { WorkspaceFiles } from '../workspace/files';
import type { Sessions } from '../cache/sessions';
import type { ModelState } from '../models/modelState';
import type { ContextAttachOffer } from './contextAttach';
import type { PromptRunner } from './promptRunner';
import type { TabLifecycle } from '../tabs/lifecycle';

/**
 * What the connection needs from the provider. Module instances where the moved code calls an
 * owned module; closures for what stays behind (the pane, the log, the bound-session flag).
 */
export interface ConnectionHost {
    profiles: Profiles;
    session: Sessions;
    turn: PromptRunner;
    models: ModelState;
    detection: EnvironmentDetection;
    files: WorkspaceFiles;
    contextAttach: ContextAttachOffer;
    lifecycle: TabLifecycle;
    post(msg: HostToPane): void;
    log(line: string): void;
    postWebviewLog(line: string, level: LogLevel): void;
    isViewingPromptSession(): boolean;
    setBoundSessionId(id: string): void;
    surfaceView(): vscode.WebviewView | undefined;
}

/**
 * The Hermes connection: starts the process, keeps the link alive, routes what Hermes sends,
 * and tears it down.
 *
 * One connection per provider. Reconnects go through `connect()`, the only place that creates
 * an AcpClient — a second live client would mean two agents on one profile.
 */
export class Connection {

    acp?: AcpClient;

    tokenUsage: TokenUsage | null = null;

    /** Resolves when `connect` finishes session/model setup after ACP `start`. */
    private connectPromise: Promise<void> | undefined;

    /** When true, suppress forwarding ACP `ready` until post-connect setup completes. */
    private deferReadyUntilSessionSetup = false;

    /** One-shot guard for the automatic reconnect after a lost connection. */
    private reconnectAttempts = 0;

    private disposed = false;

    constructor(private readonly _host: ConnectionHost) {}

    /** Drop the client without touching other state; the provider pairs this with its own resets. */
    drop(): void {
        this.acp?.dispose();
        this.acp = undefined;
    }

    dispose(): void {
        this.disposed = true;
        this.drop();
    }

    async connect(selectionId?: string): Promise<void> {
        if (this.acp) {
            const status = this.acp.status;
            if (status !== 'idle' && status !== 'error') {
                return;
            }
            // The process is gone but the object lingered: reconnect instead of staying dead.
            this.acp.dispose();
            this.acp = undefined;
        }
        if (this.connectPromise) {
            await this.connectPromise;
            return;
        }

        this.connectPromise = this.connectInner(selectionId);
        try {
            await this.connectPromise;
        } finally {
            this.connectPromise = undefined;
        }
    }

    private async connectInner(selectionId?: string): Promise<void> {
        const target = this._host.profiles.resolveTarget(selectionId);
        if (target.scopeKey !== this._host.session.scopeKey) {
            this._host.session.bindProfileScope(target.scopeKey);
        }
        this._host.profiles.selectionId = target.selectionId;
        this._host.profiles.displayName = target.displayName;

        this._host.log(`Connecting as ${target.displayName} (profile=${target.cliProfile})...`);
        this._host.post({ type: 'activeAgent', name: target.displayName });

        const cwd = this._host.files.resolveCwd(target.configCwd);

        this._host.post({
            type: 'status',
            status: 'connecting',
            message: localizeStatusMessage('Loading profile & session...'),
        });

        const quickPath = await tryResolveHermesQuick(target.configPath);
        let resolvedPath: string | undefined;
        if (quickPath) {
            this._host.log(`Hermes resolved without full detection: ${quickPath}`);
            resolvedPath = quickPath;
        } else {
            const report = await this._host.detection.runWithUi(target.configPath, 'connect');
            if (report.status === 'cancelled') {
                this._host.log('Connect cancelled during environment detection');
                this._host.post({
                    type: 'status',
                    status: 'disconnected',
                    message: t('detectEnvironmentCancelled'),
                });
                return;
            }
            resolvedPath = this._host.detection.pickBestExecutable(report);
            if (this._host.detection.shouldOfferConfiguration(report)) {
                const configuredPath = await this._host.detection.autoConfigure(report);
                if (configuredPath) {
                    resolvedPath = configuredPath;
                }
            }
            if (!resolvedPath) {
                const msg = report.status === 'broken'
                    ? formatDetectBrokenMessage(report)
                    : t('detectEnvironmentNotFound');
                this._host.log(`Connect failed: ${msg}`);
                this._host.post({ type: 'status', status: 'error', message: msg });
                return;
            }
        }

        this.acp = new AcpClient(
            (role, text, toolCallId) => {
                if (role === 'assistant' || role === 'thought' || role === 'tool') {
                    this._host.turn.clearStallHint();
                }
                this._host.turn.postScoped({ type: 'addMessage', role, text, toolCallId });
                // Late events, after a cancel or a detach, arrive with no prompt session:
                // drop them rather than writing them anywhere.
                if (!this._host.turn.promptSessionId) {
                    return;
                }
                if (role === 'user') {
                    this._host.session.saveMessage('user', text);
                }
                if (role === 'assistant') {
                    this._host.turn.recordAssistantText(text);
                }
                if (role === 'thought') {
                    this._host.turn.recordThoughtText(text);
                }
                if (role === 'tool' && toolCallId) {
                    this._host.session.upsertToolMessage(toolCallId, text);
                } else if (role === 'tool') {
                    this._host.session.saveMessage('tool', text);
                }
            },
            (status, msg) => {
                this._host.log(`Status: ${status}${msg ? ' — ' + msg : ''}`);
                if (status === 'ready' && this.deferReadyUntilSessionSetup) {
                    return;
                }
                if (this._host.isViewingPromptSession()) {
                    this._host.post({
                        type: 'status',
                        status,
                        message: msg ? localizeStatusMessage(msg) : undefined,
                        sessionId: this._host.session.activeId,
                    });
                }
                if (status === 'ready') {
                    this.reconnectAttempts = 0;
                    this._host.turn.clearStallHint();
                    if (this._host.turn.promptSessionId) {
                        this._host.turn.flushThought();
                        this._host.turn.saveAssistantText();
                    }
                    this._host.turn.clearText();
                    this._host.turn.promptSessionId = undefined;
                    if (this._host.isViewingPromptSession()) {
                        this._host.contextAttach.completeAfterReply();
                    }
                }
                if (status === 'prompting') {
                    this._host.turn.clearText();
                    this._host.turn.scheduleStallHint();
                }
            },
            async (request) => this._host.turn.requestPermission(request),
            () => {
                this._host.log('Connection lost');
                this._host.turn.cancelPendingPermissions();
                this.tokenUsage = null;
                this.postTokenUsage();
                this.acp = undefined;
                this._host.post({
                    type: 'status',
                    status: 'error',
                    message: t('connectionLostRetrying'),
                });
                void this.reconnectAfterLoss();
            },
            {
                readTextFile: (p: string) => this._host.files.readTextFile(p),
                writeTextFile: (p: string, content: string) => this._host.files.writeTextFile(p, content),
            },
            (cmd: string, args: string[], cwd: string) => {
                this._host.log(`Terminal: ${cmd.slice(0, 80)}`);
                const fullCmd = args.length > 0 ? cmd + ' ' + args.join(' ') : cmd;
                const terminal = vscode.window.createTerminal({
                    name: `Hermes: ${cmd.slice(0, 30)}`,
                    cwd,
                });
                terminal.sendText(fullCmd);
                terminal.show(false);
            },
            (usage) => {
                if (!this._host.isViewingPromptSession()) {
                    return;
                }
                this.tokenUsage = usage;
                this.postTokenUsage();
            },
            () => {
                void this._host.models.sync({ skipModelOptions: true });
            },
            () => {
                if (!this._host.isViewingPromptSession()) {
                    return;
                }
                this._host.turn.flushThought();
                this._host.post({ type: 'finishAssistantBubble', sessionId: this._host.session.activeId });
            },
            (cwd) => {
                const servers = resolveMcpServersForSession(cwd);
                if (servers.length > 0) {
                    this._host.log(`Forwarding ${servers.length} MCP server(s) to Hermes: ${servers.map(s => s.name).join(', ')}`);
                }
                return servers;
            },
            (sessionId, messages) => {
                this._host.lifecycle.handleHistoryReplay(sessionId, messages);
            }
        );
        this.acp!.onLog = (line: string) => {
            const level = classifyLogLevel(line);
            if (level) {
                this._host.postWebviewLog(line, level);
            }
        };
        this.deferReadyUntilSessionSetup = true;
        try {
            await this.acp!.start(cwd, resolvedPath, target.cliProfile);
            await this._host.lifecycle.resumeOrAdopt(cwd);
            await this._host.models.sync({ skipModelOptions: true });
            await this._host.models.applySessionPreference();
            await this._host.models.sync();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.log(`Connect failed: ${msg}`);
            this.acp?.dispose();
            this.acp = undefined;
        } finally {
            this.deferReadyUntilSessionSetup = false;
            if (this.acp) {
                this._host.setBoundSessionId(this._host.session.activeId);
            }
            if (this.acp?.status === 'ready') {
                this._host.post({ type: 'status', status: 'ready' });
            }
        }
    }

    async awaitSessionReady(): Promise<void> {
        if (this.connectPromise) {
            await this.connectPromise.catch(() => {});
        }
    }

    private async reconnectAfterLoss(): Promise<void> {
        if (this.disposed || this.reconnectAttempts >= 1) {
            return;
        }
        this.reconnectAttempts++;
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (this.disposed || this.acp) {
            return;
        }
        this._host.log('Reconnecting after connection loss');
        await this.connect(this._host.profiles.selectionId || undefined);
        this._host.lifecycle.restoreMessages();
    }

    async retry(): Promise<void> {
        this._host.log('Retry connection requested');
        this.acp?.dispose();
        this.acp = undefined;
        this._host.models.reset();
        this.tokenUsage = null;
        this.postTokenUsage();
        await this.connect(this._host.profiles.selectionId || undefined);
    }

    async reconnectForConfig(): Promise<void> {
        if (!this._host.surfaceView()) {
            return;
        }
        this._host.log('Settings changed — reconnecting Hermes...');
        this.acp?.dispose();
        this.acp = undefined;
        this._host.models.reset();
        await this.connect(this._host.profiles.selectionId || undefined);
    }

    async switchProfile(selectionId: string): Promise<void> {
        const target = this._host.profiles.resolveTarget(selectionId);
        if (target.selectionId === this._host.profiles.selectionId && this.acp) {
            return;
        }
        this._host.log(`Switch profile/agent: ${target.displayName}`);
        if (this._host.turn.promptSessionId) {
            await this._host.turn.detachActivePrompt(this._host.turn.promptSessionId, { savePartial: true });
        }
        this._host.session.saveCurrent();
        this.acp?.dispose();
        this.acp = undefined;
        this._host.models.reset();
        this.tokenUsage = null;
        this._host.turn.promptSessionId = undefined;
        this._host.setBoundSessionId('');
        this.postTokenUsage();
        this._host.session.bindProfileScope(target.scopeKey);
        this._host.profiles.selectionId = target.selectionId;
        this._host.profiles.displayName = target.displayName;
        this._host.profiles.persistSelection(target.selectionId);
        // View reset only: the other profile's tab is restored by session.bindProfileScope above
        // and replayed by lifecycle.restoreMessages below, so nothing of the old profile stays on screen.
        this._host.post({ type: 'newChat' });
        this._host.session.postList();
        this._host.profiles.postList();
        this._host.post({ type: 'activeAgent', name: target.displayName });
        await this.connect(target.selectionId);
        this._host.lifecycle.restoreMessages();
    }

    postTokenUsage(): void {
        if (!this.tokenUsage) {
            this._host.post({ type: 'tokenUsage', used: 0, size: 0 });
            return;
        }
        this._host.post({
            type: 'tokenUsage',
            used: this.tokenUsage.used,
            size: this.tokenUsage.size,
        });
    }

}
