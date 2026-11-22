import { Signal } from './signal';
import { AcpClient, TokenUsage } from '../acp/AcpClient';
import { tryResolveHermesQuick } from '../environment/profileDiscovery';
import { formatDetectBrokenMessage } from '../environment/detectFormat';
import { localizeStatusMessage, t } from '../i18n';
import { classifyLogLevel, LogLevel } from '../logLevel';
import type { HostToPane } from '../../shared/webview';
import type { HolderKey, Profiles } from '../environment/profiles';
import type { EnvironmentDetection } from '../environment/detection';
import type { Sessions } from '../workspace/sessions';
import type { ModelState } from '../models/modelState';
import type { PromptRunner } from './promptRunner';
import type { TabLifecycle } from '../workspace/lifecycle';

/**
 * A pane's view, as the connection needs it.
 *
 * The connection reads one thing of it: whether this window has one — a view that was disposed has
 * nothing to reconnect. No member is used, so this is the presence token itself rather than an
 * interface of invented members; the alternative was importing `vscode.WebviewView`, which is what
 * F6 keeps out of a feature file.
 */
export type PaneSurface = object;

/**
 * What the connection needs from the provider. Module instances where the moved code calls an
 * owned module; closures for what stays behind (the pane, the log, the bound-session flag).
 */
import type { Projects } from '../workspace/projectGrouped';

export interface ConnectionHost {
    profiles: Profiles;
    session: Sessions;
    projects: Projects;
    turn: PromptRunner;
    models: ModelState;
    detection: EnvironmentDetection;
    /** This window's cwd, or '' when it opened no folder. */
    resolveCwd(): string;
    lifecycle: TabLifecycle;
    post(msg: HostToPane): void;
    log(line: string): void;
    postWebviewLog(line: string, level: LogLevel): void;
    /** Hermes' own answer to a steer: a note, never reply text. */
    steerNotice(text: string): void;
    /** A switch completed: the new profile's display name. */
    profileChanged(name: string): void;
    /** The profile this extension may not use: the sibling's, or one live in another window. */
    excludedProfiles?: () => Array<{ cliProfile: string; holder: HolderKey }>;
    isViewingPromptSession(): boolean;
    setBoundSessionId(id: string): void;
    surfaceView(): PaneSurface | undefined;
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

    /**
     * Bumped whenever the attempt in flight must be abandoned (a drop, a newer connect). A drop
     * cannot cancel an await, but it can make that await's continuation do nothing: connectInner
     * compares its own generation after every await and stops when it no longer owns it.
     */
    private _generation = 0;

    constructor(private readonly _host: ConnectionHost) {}

    /** Drop the client without touching other state; the provider pairs this with its own resets. */
    drop(): void {
        this._generation += 1;
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
            const generation = this._generation;
            await this.connectPromise;
            // A drop during that connect abandoned it; this caller still wants a connection.
            if (generation === this._generation) {
                return;
            }
        }

        const promise = this.connectInner(selectionId);
        this.connectPromise = promise;
        try {
            await promise;
        } finally {
            if (this.connectPromise === promise) {
                this.connectPromise = undefined;
            }
        }
    }

    private async connectInner(selectionId?: string): Promise<void> {
        const generation = ++this._generation;
        const abandoned = (): boolean => generation !== this._generation;
        // Tier 1: connect by the name the table holds, repaired through the fallbacks when Hermes
        // renamed the profile outside this extension.
        const resolved = this._host.profiles.connectTarget(
            selectionId,
            this._host.session.tabs.map(tab => tab.hermesSessionId || '').filter(Boolean),
        );
        const target = resolved.target;
        if (resolved.missing) {
            this._host.log(`Connect stopped: no profile answers for "${target.agentName}"`);
            this._host.post({ type: 'status', status: 'error', message: t('profileMissing', target.displayName) });
            this._host.post({ type: 'openProfilePicker' });
            return;
        }
        if (target.sessionProfileId !== this._host.session.sessionProfileId) {
            this._host.session.bindProfileScope(target.sessionProfileId);
            this._host.projects.bindProfileScope(target.sessionProfileId);
        }
        this._host.profiles.selectionId = target.selectionId;
        this._host.profiles.displayName = target.displayName;

        // The rule the extensions live by: two panes never run on one profile — not the sibling in
        // this window, and not an instance in another one. Checked here, on every path that
        // connects, because a picker that hides them is a preference while this is the guarantee.
        const excluded = (this._host.excludedProfiles?.() || []).filter(entry => !!entry.cliProfile);
        const refusedBy = excluded.find(entry => entry.cliProfile === target.cliProfile);
        if (refusedBy) {
            this._host.log(`Refusing profile "${target.cliProfile}": it belongs to ${refusedBy.holder}`);
            this._host.post({
                type: 'status',
                status: 'error',
                // The holder keeps its role: "the primary agent" and "a secondant in another
                // window" send the user to different places.
                message: t('profileExcluded', target.displayName, t(refusedBy.holder)),
            });
            this._host.post({ type: 'openProfilePicker' });
            return;
        }

        this._host.log(`Connecting as ${target.displayName} (profile=${target.cliProfile})...`);
        this._host.post({ type: 'activeAgent', name: target.displayName });

        const cwd = this._host.resolveCwd();
        if (!cwd) {
            // No folder open is not a working area: there is no cwd to hand Hermes, so no session.
            this._host.log('No folder open: not starting Hermes');
            this._host.post({ type: 'status', status: 'idle', message: t('noFolderOpen') });
            return;
        }


        this._host.post({
            type: 'status',
            status: 'connecting',
            message: localizeStatusMessage('Loading profile & session...'),
        });

        const quickPath = await tryResolveHermesQuick(target.configPath);
        if (abandoned()) {
            return;
        }
        let resolvedPath: string | undefined;
        if (quickPath) {
            this._host.log(`Hermes resolved without full detection: ${quickPath}`);
            resolvedPath = quickPath;
        } else {
            const report = await this._host.detection.runWithUi(target.configPath, 'connect');
            if (abandoned()) {
                return;
            }
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
                if (abandoned()) {
                    return;
                }
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
                // The gate's note is part of the transcript: without this a reload loses the
                // only trace of how that command got past the approval gate.
                if (role === 'approval') {
                    this._host.session.saveMessage('approval', text);
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
                    // The run is over: whatever was refused while it ran acts now.
                    this.runEnded.fire();
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
            (sessionId, messages) => {
                this._host.lifecycle.handleHistoryReplay(sessionId, messages);
            }
        );
        this.acp!.onPromptAccepted = () => this._host.session.settlePendingTurn();
        this.acp!.onSessionMode = (mode: string) => {
            for (const handler of [...this._sessionModeListeners]) {
                handler(mode);
            }
        };
        this.acp!.onLog = (line: string) => {
            // The output channel is where a live check reads this: every ACP line goes there, and
            // the ones that are errors or warnings also reach the pane's log viewer.
            this._host.log(line);
            const level = classifyLogLevel(line);
            if (level) {
                this._host.postWebviewLog(line, level);
            }
        };
        this.acp!.onSteerNotice = (text: string) => {
            this._host.steerNotice(text);
        };
        // The loading state shows how many replay chunks have arrived. Display only: the gate is
        // `session/load` resolving, which `handleHistoryReplay` already follows.
        this.acp!.onReplayProgress = (received: number) => {
            this._host.post({ type: 'loadProgress', received, sessionId: this._host.session.activeId });
        };
        this.deferReadyUntilSessionSetup = true;
        try {
            await this.acp!.start(cwd, resolvedPath, target.cliProfile);
            if (abandoned()) {
                return;
            }
            await this._host.lifecycle.resumeOrAdopt(cwd);
            if (abandoned()) {
                return;
            }
            // The catalog has just been applied, counts and all: this profile is active now.
            this.profileActive.fire();
            await this._host.models.sync({ skipModelOptions: true });
            if (abandoned()) {
                return;
            }
            await this._host.models.applySessionPreference();
            if (abandoned()) {
                return;
            }
            await this._host.models.sync();
        } catch (err) {
            if (abandoned()) {
                return;
            }
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

    /** Drop the client and everything that belonged to it, before a fresh connect. */
    private _resetClient(): void {
        this.acp?.dispose();
        this.acp = undefined;
        this._host.models.reset();
        this.tokenUsage = null;
        this.postTokenUsage();
    }

    async awaitSessionReady(): Promise<void> {
        if (this.connectPromise) {
            await this.connectPromise.catch(() => {});
        }
    }

    /** One automatic reconnect after the process dies; the Retry button covers the rest. */
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
        this._resetClient();
        await this.connect(this._host.profiles.selectionId || undefined);
    }

    async reconnectForConfig(): Promise<void> {
        if (!this._host.surfaceView()) {
            return;
        }
        this._host.log('Settings changed — reconnecting Hermes...');
        this._resetClient();
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
        this._resetClient();
        this._host.turn.promptSessionId = undefined;
        this._host.setBoundSessionId('');
        this._host.session.bindProfileScope(target.sessionProfileId);
        this._host.projects.bindProfileScope(target.sessionProfileId);
        this._host.profiles.selectionId = target.selectionId;
        this._host.profiles.displayName = target.displayName;
        // View reset only: the other profile's tab is restored by session.bindProfileScope above
        // and replayed by lifecycle.restoreMessages below, so nothing of the old profile stays on screen.
        this._host.post({ type: 'newChat' });
        this._host.session.postList();
        this._host.profiles.postList();
        this._host.post({ type: 'activeAgent', name: target.displayName });
        this._host.profileChanged(target.displayName);
        await this.connect(target.selectionId);
        this._host.lifecycle.restoreMessages();
    }

    /** Said whenever a run ends: the features that were refused while it ran act on it. */
    readonly runEnded = new Signal();

    /**
     * Said whenever a profile becomes active: the agent connected and its sessions are on screen.
     *
     * Fired where the catalog has just been applied (`connectInner`, after `resumeOrAdopt`), which
     * is app start, a profile switch and a workspace switch — never a tab switch.
     */
    readonly profileActive = new Signal();

    /** Listeners for the mode Hermes reports: the permissions feature brings edits in line. */
    private readonly _sessionModeListeners = new Set<(mode: string) => void>();

    onSessionMode(handler: (mode: string) => void): () => void {
        this._sessionModeListeners.add(handler);
        return () => {
            this._sessionModeListeners.delete(handler);
        };
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
