import { spawn, ChildProcess } from 'child_process';
import {
    client,
    ndJsonStream,
    ActiveSession,
    methods
} from '@agentclientprotocol/sdk';
import type {
    ClientConnection
} from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import {
    buildModelListState,
    buildModelListStateFromHermesModels,
    buildModelListStateFromSessionResponse,
    HERMES_MODEL_CONFIG_ID,
    shouldUseHermesSetModel,
    type ModelListState
} from '../models/modelConfig';
import type { SessionMcpServer } from './mcpConfig';
import { normalizeHermesCliProfile } from '../environment/hermesProfile';
import { findHermesExecutableOrThrow } from '../environment/profileDiscovery';
import type { AcpModelOptionsResponse } from '../models/acpModelCatalog';
import { extractTextFromContentBlock } from './contentText';
import {
    ToolCallTracker,
    formatToolCallDisplay,
    parseToolCallSessionUpdate,
} from './toolCallUpdate';
import type { CatalogSession, PermissionOption } from '../../shared/acp';
import { isSteerNotice } from './steerNotice';
export type { CatalogSession, PermissionOption } from '../../shared/acp';

export type AcpStatus = 'idle' | 'connecting' | 'ready' | 'prompting' | 'error';
export type { ModelListState } from '../models/modelConfig';
export type ModelsChangedHandler = (models: ModelListState | null) => void;

export type MessageHandler = (role: 'user' | 'assistant' | 'tool' | 'thought', text: string, toolCallId?: string) => void;
export type StatusHandler = (status: AcpStatus, message?: string) => void;
export interface PermissionRequest {
    title: string;
    detail?: string;
    options: PermissionOption[];
    toolCallId?: string;
}

/** Resolves with the selected optionId, or null when cancelled. */
export type PermissionHandler = (request: PermissionRequest) => Promise<string | null>;
export type ConnectionLostHandler = () => void;
export type FileSystemHandler = {
    readTextFile: (path: string) => Promise<string>;
    writeTextFile: (path: string, content: string) => Promise<void>;
};
export type TerminalHandler = (command: string, args: string[], cwd: string) => void;
export type LogHandler = (text: string) => void;
export type TokenUsage = { used: number; size: number };
export type UsageHandler = (usage: TokenUsage) => void;
/** Resolves MCP servers for ACP session/new (from editor mcp.json). */
export type McpServersResolver = (cwd: string) => SessionMcpServer[];
/** Called when an assistant/thought segment ends (tool call, permission, etc.). */
export type SegmentEndHandler = () => void;

interface TerminalInstance {
    process: ChildProcess;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    exitSignal: string | null;
    exited: Promise<void>;
    resolveExit: () => void;
}

function readTextFromContentBlock(block: unknown): string {
    if (!block || typeof block !== 'object') {
        return '';
    }
    const record = block as Record<string, unknown>;
    if (typeof record.text === 'string') {
        return record.text;
    }
    const nested = record.content;
    if (nested && typeof nested === 'object' && typeof (nested as { text?: unknown }).text === 'string') {
        return (nested as { text: string }).text;
    }
    return '';
}

function extractPermissionDetail(toolCall: unknown): string | undefined {
    if (!toolCall || typeof toolCall !== 'object') {
        return undefined;
    }
    const tc = toolCall as Record<string, unknown>;
    const parts: string[] = [];
    const rawInput = tc.rawInput ?? tc.raw_input;
    if (typeof rawInput === 'string' && rawInput.trim()) {
        parts.push(rawInput.trim());
    }
    const content = tc.content;
    if (typeof content === 'string' && content.trim()) {
        parts.push(content.trim());
    } else if (Array.isArray(content)) {
        const text = content.map(readTextFromContentBlock).filter(Boolean).join('\n').trim();
        if (text) {
            parts.push(text);
        }
    }
    if (parts.length === 0) {
        return undefined;
    }
    return parts.join('\n\n');
}

/** Minimal session metadata used to validate a stored session id. */
export interface HermesSessionSummary {
    sessionId: string;
    title?: string;
    cwd?: string;
    updatedAt?: string;
}

/**
 * One transcript entry reconstructed from a ``session/load`` history replay.
 *
 * ACP replays history as ``session/update`` notifications *before* the load
 * request answers, and each notification carries one whole message — not a
 * delta — so entries are appended as they arrive rather than accumulated.
 */
export interface ReplayMessage {
    role: 'user' | 'assistant' | 'thought' | 'tool';
    text: string;
    toolCallId?: string;
}

export type HistoryReplayHandler = (sessionId: string, messages: ReplayMessage[]) => void;

/** A steer's own reply line, lifted out of the running turn's stream. */
export type SteerNoticeHandler = (text: string) => void;

export class AcpClient {
    private _process: ChildProcess | null = null;
    private _app: ReturnType<typeof client> | null = null;
    private _session: ActiveSession | null = null;
    /** ACP session the view is bound to (either freshly created or resumed). */
    private _activeSessionId: string = '';
    /** Set when the active session came from session/load: no builder to prompt through. */
    private _loadedSessionId: string = '';
    /** Non-null while ``session/load`` streams its replay: chunks are collected, not rendered. */
    private _replaySink: ReplayMessage[] | null = null;
    private _conn: ClientConnection | null = null;
    private _status: AcpStatus = 'idle';
    private _onMessage: MessageHandler;
    private _onStatus: StatusHandler;
    private _onPermission: PermissionHandler;
    private _onConnectionLost: ConnectionLostHandler;
    private _onFileSystem: FileSystemHandler;
    private _onTerminal: TerminalHandler;
    private _onLog: LogHandler;
    private _onSteerNotice: SteerNoticeHandler = () => {};
    private _terminals: Map<string, TerminalInstance> = new Map();
    private _nextTerminalId: number = 1;
    private _responseBuffer: string = '';
    /** Steers awaiting Hermes' answer; only then can a chunk be a steer notice. */
    private _steersInFlight: number = 0;
    private _thoughtBuffer: string = '';
    private _configOptions: unknown[] = [];
    private _modelListState: ModelListState | null = null;
    /** Model id last applied to the live ACP session (not UI preference alone). */
    private _runtimeModelId: string = '';
    /** Raw Hermes ``models`` payload; preserved across empty config_option updates. */
    private _hermesModelsRaw: unknown = null;
    private _onModelsChanged: ModelsChangedHandler;
    private _onUsage: UsageHandler;
    private _onSegmentEnd: SegmentEndHandler;
    private _resolveMcpServers: McpServersResolver;
    private _onHistoryReplay: HistoryReplayHandler;
    /** Monotonic id so stale prompt rejections after cancel are ignored. */
    private _activePromptId = 0;
    private _promptPromise: Promise<unknown> | null = null;
    /** When false, drop streaming chunks from a cancelled or superseded turn. */
    private _acceptStreamOutput = false;
    private _toolCallTracker = new ToolCallTracker();
    /** Cached after first ``method not found`` — avoids repeated Hermes log noise. */
    private _modelOptionsKnownUnsupported = false;
    private _hermesSetModelKnownUnsupported = false;
    private _setConfigOptionKnownUnsupported = false;
    private _modelOptionsFetchPromise: Promise<AcpModelOptionsResponse | null> | null = null;
    /** Full provider catalog from ``model.options``; survives sparse session model updates. */
    private _cachedModelOptions: AcpModelOptionsResponse | null = null;

    private static readonly VALID: Record<AcpStatus, AcpStatus[]> = {
        idle:        ['connecting'],
        connecting:  ['ready', 'error'],
        ready:       ['prompting', 'error', 'idle'],
        prompting:   ['ready', 'error', 'idle'],
        error:       ['connecting', 'idle'],
    };

    static canTransitionTo(from: AcpStatus, to: AcpStatus): boolean {
        return AcpClient.VALID[from]?.includes(to) ?? false;
    }

    constructor(
        onMessage: MessageHandler,
        onStatus: StatusHandler,
        onPermission?: PermissionHandler,
        onConnectionLost?: ConnectionLostHandler,
        onFileSystem?: FileSystemHandler,
        onTerminal?: TerminalHandler,
        onUsage?: UsageHandler,
        onModelsChanged?: ModelsChangedHandler,
        onSegmentEnd?: SegmentEndHandler,
        resolveMcpServers?: McpServersResolver,
        onHistoryReplay?: HistoryReplayHandler
    ) {
        this._onMessage = onMessage;
        this._onStatus = onStatus;
        this._onPermission = onPermission || (async (request) => {
            const allow = request.options.find(o =>
                o.kind?.startsWith('allow') || o.optionId.startsWith('allow'));
            return allow?.optionId ?? request.options[0]?.optionId ?? null;
        });
        this._onConnectionLost = onConnectionLost || (() => {});
        this._onFileSystem = onFileSystem || { readTextFile: async () => '', writeTextFile: async () => {} };
        this._onTerminal = onTerminal || (() => {});
        this._onLog = () => {};
        this._onUsage = onUsage || (() => {});
        this._onModelsChanged = onModelsChanged || (() => {});
        this._onSegmentEnd = onSegmentEnd || (() => {});
        this._resolveMcpServers = resolveMcpServers || (() => []);
        this._onHistoryReplay = onHistoryReplay || (() => {});
    }

    set onLog(handler: LogHandler) { this._onLog = handler; }

    /** Told about the chunk Hermes answers a steer with; it is not part of the reply. */
    set onSteerNotice(handler: SteerNoticeHandler) { this._onSteerNotice = handler; }

    getModelListState(): ModelListState | null {
        return this._modelListState ?? buildModelListState(this._configOptions);
    }

    getRuntimeModelId(): string {
        return this._runtimeModelId;
    }

    getHermesModelsRaw(): unknown {
        return this._hermesModelsRaw;
    }

    getCachedModelOptions(): AcpModelOptionsResponse | null {
        return this._cachedModelOptions;
    }

    /** Fetch grouped model catalog via Hermes ACP ``model.options`` (best-effort). */
    async fetchModelOptions(): Promise<AcpModelOptionsResponse | null> {
        if (!this._conn || !this._activeSessionId || this._modelOptionsKnownUnsupported) {
            return null;
        }
        if (this._modelOptionsFetchPromise) {
            return this._modelOptionsFetchPromise;
        }
        this._modelOptionsFetchPromise = this._fetchModelOptionsOnce();
        try {
            return await this._modelOptionsFetchPromise;
        } finally {
            this._modelOptionsFetchPromise = null;
        }
    }

    private async _fetchModelOptionsOnce(): Promise<AcpModelOptionsResponse | null> {
        if (!this._conn || !this._activeSessionId || this._modelOptionsKnownUnsupported) {
            return null;
        }
        try {
            const response = await this._conn.agent.request('model.options', {
                sessionId: this._activeSessionId,
            } as any);
            if (!response || typeof response !== 'object') {
                return null;
            }
            const parsed = response as AcpModelOptionsResponse;
            if (parsed.providers?.length) {
                this._cachedModelOptions = parsed;
            }
            return parsed;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (this._isMethodNotFoundError(err)) {
                this._modelOptionsKnownUnsupported = true;
            }
            this._onLog(`model.options unavailable: ${msg}`);
            return null;
        }
    }

    get status(): AcpStatus {
        return this._status;
    }

    async start(cwd: string = process.cwd(), hermesPath?: string, hermesProfile?: string): Promise<void> {
        if (!this._transitionTo('connecting', 'Loading profile & session...')) {
            return;
        }

        try {
            const resolvedPath = await findHermesExecutableOrThrow(hermesPath);

            const profile = normalizeHermesCliProfile(hermesProfile);
            const args = ['acp', '--profile', profile];

            this._process = spawn(resolvedPath, args, {
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            const childInput = new WritableStream<Uint8Array>({
                write: async (chunk) => {
                    const canContinue = this._process?.stdin?.write(Buffer.from(chunk));
                    if (canContinue === false) {
                        // Backpressure: wait for drain before writing more
                        await new Promise<void>((resolve) => {
                            this._process?.stdin?.once('drain', () => resolve());
                        });
                    }
                },
                close: () => {
                    this._process?.stdin?.end();
                }
            });

            const childOutput = new ReadableStream<Uint8Array>({
                start: (controller) => {
                    const stdout = this._process?.stdout;
                    if (stdout) {
                        stdout.on('data', (chunk: Buffer) => {
                            controller.enqueue(new Uint8Array(chunk));
                        });
                        stdout.on('end', () => controller.close());
                        stdout.on('error', (err) => controller.error(err));
                    }
                }
            });

            const stream = ndJsonStream(childInput, childOutput);

            this._process.on('error', (err) => {
                this._transitionTo('error', `Process error: ${err.message}`);
                this._onConnectionLost();
            });

            this._process.on('exit', (code, signal) => {
                if (this._status !== 'idle') {
                    // Manual cleanup: don't call stop() which would override error status
                    this._session?.dispose();
                    this._session = null;
                    this._conn = null;
                    this._app = null;
                    this._process = null;
                    // Kill terminal children
                    for (const [, t] of this._terminals) {
                        try { t.process.kill(); } catch { /* ignore */ }
                    }
                    this._terminals.clear();
                    this._transitionTo('error', `Process exited (code: ${code}, signal: ${signal})`);
                    this._onConnectionLost();
                }
            });

            this._process.stderr?.on('data', (chunk: Buffer) => {
                const line = chunk.toString().trim();
                if (line) {
                    this._onLog(line);
                }
            });

            this._app = client({ name: 'hermes-vscode' });

            this._app.onRequest('session/request_permission', async ({ params }) => {
                this._endAssistantSegment();
                const p = params as any;
                const toolCall = p.toolCall;
                const title = toolCall?.title || p.description || p.message || 'Unknown operation';
                const detail = extractPermissionDetail(toolCall);
                const options: PermissionOption[] = (p.options || []).map((o: any) => ({
                    optionId: String(o.optionId ?? ''),
                    name: String(o.name || o.optionId || ''),
                    kind: o.kind ? String(o.kind) : undefined,
                })).filter((o: PermissionOption) => o.optionId);
                if (options.length === 0) {
                    return { outcome: { outcome: 'cancelled' } } as any;
                }
                const selectedId = await this._onPermission({
                    title,
                    detail,
                    options,
                    toolCallId: toolCall?.toolCallId,
                });
                if (selectedId && options.some(o => o.optionId === selectedId)) {
                    return { outcome: { outcome: 'selected', optionId: selectedId } } as any;
                }
                return { outcome: { outcome: 'cancelled' } } as any;
            });

            this._app.onNotification('session/update', async ({ params }) => {
                this._handleSessionUpdate(params);
            });

            // Register fs capability handlers
            this._app.onRequest(methods.client.fs.readTextFile as any, async ({ params }: any) => {
                const content = await this._onFileSystem.readTextFile(params.path);
                return { content };
            });

            this._app.onRequest(methods.client.fs.writeTextFile as any, async ({ params }: any) => {
                await this._onFileSystem.writeTextFile(params.path, params.content);
                return {};
            });

            // Register terminal capability handlers
            this._app.onRequest(methods.client.terminal.create as any, async ({ params }: any) => {
                return this._handleTerminalCreate(params);
            });
            this._app.onRequest(methods.client.terminal.output as any, async ({ params }: any) => {
                return this._handleTerminalOutput(params);
            });
            this._app.onRequest(methods.client.terminal.waitForExit as any, async ({ params }: any) => {
                return this._handleTerminalWaitForExit(params);
            });
            this._app.onRequest(methods.client.terminal.release as any, async ({ params }: any) => {
                return this._handleTerminalRelease(params);
            });
            this._app.onRequest(methods.client.terminal.kill as any, async ({ params }: any) => {
                return this._handleTerminalKill(params);
            });

            this._conn = this._app.connect(stream);
            const ctx = this._conn.agent;

            await ctx.request(methods.agent.initialize, {
                protocolVersion: PROTOCOL_VERSION,
                clientCapabilities: {
                    fs: { readTextFile: true, writeTextFile: true },
                    terminal: true
                }
            } as any);
            // Note: `as any` is needed because ClientContext.request() type
            // doesn't include the fs/terminal capability fields in its schema type.
            // When ACP SDK schema updates, this cast can be removed.

            // No session/new here. Connecting used to create one immediately and then
            // `_resumeOrAdoptSession` loaded the tab's real session on top of it, leaving an
            // untitled zero-message row in state.db on every activation and profile switch.
            // A session is created by newSession() when something actually needs one.
            this._activeSessionId = '';
            this._loadedSessionId = '';
            this._onLog('Connected (no session until one is needed)');
            this._transitionTo('ready');

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._cleanupResources();
            this._transitionTo('error', `Connection failed: ${msg}`);
            throw err;
        }
    }

    async sendMessage(text: string | any | any[]): Promise<void> {
        if (this._status !== 'ready' || !this._activeSessionId) {
            this._onMessage('assistant', 'Please wait for connection...');
            return;
        }

        const promptId = ++this._activePromptId;
        this._responseBuffer = '';
        this._thoughtBuffer = '';
        this._toolCallTracker.clear();
        this._transitionTo('prompting', 'Hermes is thinking...');
        this._acceptStreamOutput = true;

        if (promptId !== this._activePromptId) {
            this._acceptStreamOutput = false;
            this._restoreReadyAfterAbortedPrompt();
            return;
        }

        let promptPromise: Promise<unknown>;
        try {
            promptPromise = this._promptActiveSession(text) as Promise<unknown>;
        } catch (err) {
            if (promptId === this._activePromptId) {
                const msg = err instanceof Error ? err.message : String(err);
                this._onMessage('assistant', `Error: ${msg}`);
                this._transitionTo('ready');
            }
            return;
        }

        if (promptId !== this._activePromptId) {
            this._acceptStreamOutput = false;
            void this._abandonOrphanPrompt(promptPromise);
            this._restoreReadyAfterAbortedPrompt();
            return;
        }

        this._promptPromise = promptPromise;

        try {
            await promptPromise;
            if (promptId === this._activePromptId) {
                this._transitionTo('ready');
            }
        } catch (err) {
            if (promptId === this._activePromptId) {
                const msg = err instanceof Error ? err.message : String(err);
                this._onMessage('assistant', `Error: ${msg}`);
                this._transitionTo('ready');
            }
        } finally {
            if (this._promptPromise === promptPromise) {
                this._promptPromise = null;
            }
            if (promptId === this._activePromptId) {
                this._acceptStreamOutput = false;
            }
        }
    }

    /**
     * Send guidance into the running turn.
     *
     * Hermes treats `/steer <text>` sent as a prompt during a run as a slash command: the text
     * is delivered after the current tool batch and the run continues. The raw request is used
     * on purpose — `sendMessage` would bump `_activePromptId`, wipe the buffers and end the
     * turn's stream. False means the turn is not running (or the agent refused), and the caller
     * should send the text as an ordinary message instead.
     */
    async steer(text: string): Promise<boolean> {
        const body = (text || '').trim();
        if (!body || this._status !== 'prompting' || !this._activeSessionId) {
            return false;
        }
        this._onLog(`steer ${body.slice(0, 80)}`);
        this._steersInFlight += 1;
        try {
            await this._promptActiveSession(`/steer ${body}`);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._onLog(`steer failed: ${msg}`);
            return false;
        } finally {
            this._steersInFlight -= 1;
        }
    }

    async cancel(): Promise<void> {
        if (!this._conn || !this._activeSessionId) {
            return;
        }
        if (this._status !== 'prompting') {
            return;
        }

        ++this._activePromptId;
        this._acceptStreamOutput = false;
        this._responseBuffer = '';
        this._thoughtBuffer = '';
        this._emitCancelledToolCalls();

        // Let sendMessage observe cancellation if it is between prompting and prompt().
        await Promise.resolve();

        if (this._status !== 'prompting') {
            return;
        }

        const pending = this._promptPromise;

        try {
            await this._conn.agent.notify(methods.agent.session.cancel, {
                sessionId: this._activeSessionId
            });
        } catch {
            // best-effort
        }

        if (pending) {
            await pending.catch(() => {});
        } else {
            await this._waitForPromptPromise(3000);
        }

        this._promptPromise = null;
        if (this._status === 'prompting') {
            this._transitionTo('ready');
        }
    }

    private _restoreReadyAfterAbortedPrompt(): void {
        if (this._status === 'prompting') {
            this._transitionTo('ready');
        }
    }

    private async _waitForPromptPromise(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!this._promptPromise && this._status === 'prompting' && Date.now() < deadline) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        if (this._promptPromise) {
            await this._promptPromise.catch(() => {});
        }
    }

    private async _abandonOrphanPrompt(promptPromise: Promise<unknown>): Promise<void> {
        try {
            if (this._conn && this._activeSessionId) {
                await this._conn.agent.notify(methods.agent.session.cancel, {
                    sessionId: this._activeSessionId
                });
            }
        } catch {
            // best-effort
        }
        await promptPromise.catch(() => {});
    }

    async setModel(configId: string, valueId: string): Promise<void> {
        if (!this._conn || !this._activeSessionId) {
            throw new Error('Not connected');
        }
        if (this._status === 'prompting') {
            throw new Error('Cannot change model while Hermes is responding');
        }

        const effectiveConfigId = configId || this._modelListState?.configId || '';
        const useHermesSetModel = shouldUseHermesSetModel(
            configId,
            this._modelListState,
            this._hermesModelsRaw,
            valueId
        );

        if (useHermesSetModel && !this._hermesSetModelKnownUnsupported) {
            this._onLog(`session/set_model → ${valueId}`);
            try {
                await this._conn.agent.request('session/set_model', {
                    sessionId: this._activeSessionId,
                    modelId: valueId,
                } as any);
                this._runtimeModelId = valueId;
                this._applyHermesModelSelection(valueId);
                return;
            } catch (err) {
                if (this._isMethodNotFoundError(err)) {
                    this._hermesSetModelKnownUnsupported = true;
                    this._onLog('session/set_model unavailable, falling back to set_config_option');
                } else {
                    throw err;
                }
            }
        }

        if (!effectiveConfigId) {
            if (useHermesSetModel) {
                this._applyHermesModelSelection(valueId);
                throw new Error('Agent model config unavailable; selection saved locally only');
            }
            throw new Error('No model configuration available from agent');
        }

        if (this._setConfigOptionKnownUnsupported) {
            this._applyHermesModelSelection(valueId);
            throw new Error('Agent does not support runtime model switching');
        }

        try {
            const response = await this._conn.agent.request(methods.agent.session.setConfigOption, {
                sessionId: this._activeSessionId,
                configId: effectiveConfigId,
                value: valueId,
            } as any);

            const updated = (response as { configOptions?: unknown[] } | void)?.configOptions;
            if (updated) {
                this._syncConfigOptions(updated);
            }
            this._runtimeModelId = valueId;
        } catch (err) {
            if (this._isMethodNotFoundError(err)) {
                this._setConfigOptionKnownUnsupported = true;
                this._onLog('set_config_option unavailable; keeping local model preference only');
                this._applyHermesModelSelection(valueId);
                throw new Error('Agent does not support runtime model switching');
            }
            throw err;
        }
    }

    /** ACP session id the view is bound to. */
    get activeSessionId(): string {
        return this._activeSessionId;
    }

    /**
     * Sessions Hermes already knows about for this cwd (newest first).
     *
     * Read-only: lets callers validate a stored id instead of creating another.
     */
    async listSessions(cwd?: string): Promise<HermesSessionSummary[]> {
        if (!this._conn) {
            return [];
        }
        const params = cwd ? { cwd } : {};
        const response = await this._conn.agent.request(methods.agent.session.list as any, params as any) as any;
        const sessions = (response as any)?.sessions ?? [];
        return sessions
            .map((s: any) => ({
                sessionId: String(s?.sessionId ?? ''),
                title: typeof s?.title === 'string' ? s.title : undefined,
                cwd: typeof s?.cwd === 'string' ? s.cwd : undefined,
                updatedAt: s?.updatedAt == null ? undefined : String(s.updatedAt),
            }))
            .filter((s: HermesSessionSummary) => s.sessionId.length > 0);
    }

    /**
     * Every session Hermes has for this profile, hidden ones included.
     *
     * Extension methods are ``_``-prefixed ACP requests; the agent answers from its own
     * session store, so the flag and the tabs can never disagree with Hermes.
     */
    async listSessionCatalog(cwd?: string): Promise<CatalogSession[]> {
        if (!this._conn) {
            return [];
        }
        const response = await this._conn.agent.request(
            '_session/catalog' as any,
            (cwd ? { cwd } : {}) as any,
        ) as any;
        const rows = Array.isArray(response?.sessions) ? response.sessions : [];
        return rows
            .map((row: any) => ({
                sessionId: String(row?.session_id ?? row?.sessionId ?? ''),
                title: typeof row?.title === 'string' ? row.title : undefined,
                cwd: typeof row?.cwd === 'string' ? row.cwd : undefined,
                hidden: row?.hidden === true,
                messageCount: Number(row?.message_count ?? row?.messageCount ?? 0) || 0,
                // Hermes stamps in seconds; the tab order compares against Date.now() milliseconds.
                updatedAt: Number(row?.updated_at ?? row?.updatedAt ?? 0) * 1000 || 0,
            }))
            .filter((row: CatalogSession) => row.sessionId.length > 0);
    }

    /** Hide/unhide one Hermes session. The tab list is exactly this flag. */
    async setSessionHidden(sessionId: string, hidden: boolean): Promise<boolean> {
        if (!this._conn) {
            throw new Error('Not connected');
        }
        this._onLog(`session/setHidden ${sessionId} hidden=${hidden}`);
        const response = await this._conn.agent.request(
            '_session/setHidden' as any,
            { sessionId, hidden } as any,
        ) as any;
        return response?.ok === true;
    }

    /**
     * Retitle one Hermes session.
     *
     * Hermes owns titles, so this writes the row and nothing else: the tab takes the new name
     * from the next catalog read. A refusal (a name another session holds, or one past the
     * agent's length limit) arrives as a rejected request, and its message is passed through
     * rather than flattened, because it is the only explanation the user gets.
     */
    async setSessionTitle(sessionId: string, title: string): Promise<boolean> {
        if (!this._conn) {
            throw new Error('Not connected');
        }
        this._onLog(`session/setTitle ${sessionId}`);
        try {
            const response = await this._conn.agent.request(
                '_session/setTitle' as any,
                { sessionId, title } as any,
            ) as any;
            return response?.ok === true;
        } catch (err) {
            // The agent explains a refusal in the JSON-RPC error's `data`, not in its message
            // ("Invalid params"), so the reason is lifted out here and reaches the log intact.
            const data = (err as { data?: unknown })?.data;
            const carried = typeof data === 'string'
                ? data
                : (data && typeof (data as { reason?: unknown }).reason === 'string'
                    ? (data as { reason: string }).reason
                    : '');
            throw new Error(carried || (err instanceof Error ? err.message : String(err)));
        }
    }

    /**
     * Resume an existing Hermes session on the live connection.
     *
     * ACP requires the agent to stream prior history as `session/update` before
     * this resolves, so update routing (already registered app-wide) must exist.
     * Loaded sessions have no SessionBuilder, hence `_promptActiveSession`.
     */
    async loadSession(cwd: string, sessionId: string): Promise<void> {
        if (!this._conn) {
            throw new Error('Not connected');
        }
        if (this._status === 'prompting') {
            await this.cancel();
        }
        const request = this._buildNewSessionRequest(cwd);
        this._onLog(`session/load ${sessionId} cwd=${cwd}`);
        this._session?.dispose();
        this._session = null;
        this._responseBuffer = '';
        this._thoughtBuffer = '';
        this._toolCallTracker.clear();
        // Hermes streams the persisted transcript as `session/update` notifications
        // before answering `session/load`; collect it so the tab can render it.
        const replay: ReplayMessage[] = [];
        this._replaySink = replay;
        let response: any;
        try {
            response = await this._conn.agent.request(
                methods.agent.session.load as any,
                { ...request, sessionId } as any,
            ) as any;
        } finally {
            this._replaySink = null;
        }
        this._loadedSessionId = sessionId;
        this._activeSessionId = sessionId;
        try {
            this._syncSessionModels(response as any);
        } catch { /* load responses may omit the model block */ }
        this._transitionTo('ready');
        if (replay.length > 0) {
            this._onLog(`Replayed ${replay.length} history update(s) for session ${sessionId}`);
            try {
                this._onHistoryReplay(sessionId, replay);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._onLog(`History replay handling failed: ${msg}`);
            }
        }
    }

    /** Prompt whichever session is active; loaded sessions use a raw request. */
    private async _promptActiveSession(text: string | any | any[]): Promise<unknown> {
        if (this._session && !this._loadedSessionId) {
            return this._session.prompt(text);
        }
        if (!this._conn || !this._activeSessionId) {
            throw new Error('No active session');
        }
        const prompt = typeof text === 'string'
            ? [{ type: 'text', text }]
            : Array.isArray(text) ? text : [text];
        return this._conn.agent.request(methods.agent.session.prompt, {
            sessionId: this._activeSessionId,
            prompt,
        } as any);
    }

    async newSession(cwd: string): Promise<void> {
        if (!this._conn) {
            await this.start(cwd);
            if (!this._conn) {
                return;
            }
        }
        if (this._status === 'prompting') {
            await this.cancel();
        }
        try {
            this._session?.dispose();
            this._responseBuffer = '';
            this._thoughtBuffer = '';
            this._toolCallTracker.clear();
            const builder = this._conn.agent.buildSession(this._buildNewSessionRequest(cwd));
            this._session = await builder.start();
            this._activeSessionId = this._session.sessionId;
            this._loadedSessionId = '';
            this._syncSessionModels(this._session.newSessionResponse);
            this._transitionTo('ready');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._transitionTo('error', `New session failed: ${msg}`);
            this._onConnectionLost();
        }
    }

    stop(): void {
        this._cleanupResources();
        this._transitionTo('idle');
    }

    private _cleanupResources(): void {
        try {
            this._session?.dispose();
        } catch { /* ignore */ }
        this._session = null;
        this._activeSessionId = '';
        this._loadedSessionId = '';
        for (const [, term] of this._terminals) {
            try { term.process.kill(); } catch { /* ignore */ }
        }
        this._terminals.clear();
        this._toolCallTracker.clear();
        this._modelOptionsKnownUnsupported = false;
        this._hermesSetModelKnownUnsupported = false;
        this._setConfigOptionKnownUnsupported = false;
        this._modelOptionsFetchPromise = null;
        this._runtimeModelId = '';
        this._session = null;
        this._conn = null;
        this._app = null;

        if (this._process) {
            this._process.kill();
            this._process = null;
        }
    }

    dispose(): void {
        this.stop();
    }

    // ---- Terminal handlers ----

    private _handleTerminalCreate(params: any): any {
        const id = `term_${this._nextTerminalId++}`;
        const cmd = params.command;
        const args = params.args || [];
        const cwd = params.cwd || process.cwd();
        const env = params.env ? { ...process.env, ...params.env } : process.env;

        this._onTerminal(cmd, args, cwd); // mirror to VS Code terminal

        let resolveExit: () => void = () => {};
        const exited = new Promise<void>((r) => { resolveExit = r; });

        const proc = spawn(cmd, args, {
            cwd,
            shell: args.length === 0,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const term: TerminalInstance = {
            process: proc,
            stdout: '',
            stderr: '',
            exitCode: null,
            exitSignal: null,
            exited,
            resolveExit,
        };

        proc.stdout?.on('data', (chunk: Buffer) => {
            term.stdout += chunk.toString();
        });
        proc.stderr?.on('data', (chunk: Buffer) => {
            term.stderr += chunk.toString();
        });
        proc.on('exit', (code, sig) => {
            term.exitCode = code;
            term.exitSignal = sig === null ? null : sig;
            resolveExit();
        });

        this._terminals.set(id, term);
        return { terminalId: id };
    }

    private _handleTerminalOutput(params: any): any {
        const term = this._terminals.get(params.terminalId);
        if (!term) return { output: '', truncated: false, exitStatus: {} };
        let output = (term.stdout + '\n' + term.stderr).replace(/^\n/, '');
        const byteLimit = params.outputByteLimit;
        let truncated = false;
        if (byteLimit && Buffer.byteLength(output, 'utf-8') > byteLimit) {
            output = Buffer.from(output, 'utf-8').subarray(0, byteLimit).toString('utf-8');
            truncated = true;
        }
        return {
            output,
            truncated,
            exitStatus: term.exitCode !== null ? { exitCode: term.exitCode } : undefined,
        };
    }

    private async _handleTerminalWaitForExit(params: any): Promise<any> {
        const term = this._terminals.get(params.terminalId);
        if (!term) return { signal: undefined, exitCode: undefined };
        await term.exited;
        return { exitCode: term.exitCode, signal: term.exitSignal };
    }

    private _handleTerminalRelease(params: any): any {
        const term = this._terminals.get(params.terminalId);
        if (term) {
            term.process.kill();
            this._terminals.delete(params.terminalId);
        }
    }

    private _handleTerminalKill(params: any): any {
        const term = this._terminals.get(params.terminalId);
        if (term) {
            term.process.kill();
        }
    }

    // ---- ACP session update handler ----

    private _handleSessionUpdate(notification: any): void {
        const sessionId = notification?.sessionId;
        if (sessionId && this._session && sessionId !== this._session.sessionId) {
            return;
        }
        const update = notification.update;
        const kind = update.sessionUpdate;

        // Replay updates are whole messages, so they bypass the prompt-only
        // `_acceptStreamOutput` gate and never touch the streaming buffers.
        if (this._replaySink && this._collectReplayUpdate(update, kind)) {
            return;
        }

        switch (kind) {
            case 'agent_message_chunk': {
                if (!this._acceptStreamOutput) {
                    break;
                }
                // Accumulate incremental text chunks into buffer.
                // Assumption: ACP sends INCREMENTAL text per chunk (spec-compliant).
                // If an agent sends the FULL text each time instead, this will
                // double-append. The SDK's readText() uses the same += pattern.
                const text = extractTextFromContentBlock(update.content);
                if (text && this._steersInFlight > 0 && isSteerNotice(text)) {
                    // The steer's own answer rides the same stream; it is not reply text.
                    this._onSteerNotice(text.trim());
                    break;
                }
                if (text) {
                    this._responseBuffer += text;
                    this._onMessage('assistant', this._responseBuffer);
                }
                break;
            }

            case 'agent_thought_chunk': {
                if (!this._acceptStreamOutput) {
                    break;
                }
                const thoughtText = extractTextFromContentBlock(update.content);
                if (thoughtText) {
                    this._thoughtBuffer += thoughtText;
                    this._onMessage('thought', this._thoughtBuffer);
                }
                break;
            }

            case 'tool_call':
                if (!this._acceptStreamOutput) {
                    break;
                }
                this._endAssistantSegment();
                this._emitToolCallUpdate(update, 'tool_call');
                break;

            case 'tool_call_update':
                if (!this._acceptStreamOutput) {
                    break;
                }
                this._emitToolCallUpdate(update, 'tool_call_update');
                break;

            case 'config_option_update': {
                const configOptions = update.configOptions ?? notification.configOptions;
                if (configOptions) {
                    this._syncConfigOptions(configOptions);
                }
                break;
            }

            case 'usage_update': {
                const used = Number(update.used) || 0;
                const size = Number(update.size) || 0;
                if (size > 0) {
                    this._onUsage({ used, size });
                }
                break;
            }
        }
    }

    /** Collect one replayed transcript update; false when it is not transcript content. */
    private _collectReplayUpdate(update: Record<string, unknown>, kind: string): boolean {
        const sink = this._replaySink;
        if (!sink) {
            return false;
        }
        switch (kind) {
            case 'user_message_chunk': {
                const text = extractTextFromContentBlock(update.content);
                if (text) {
                    sink.push({ role: 'user', text });
                }
                return true;
            }

            case 'agent_message_chunk': {
                const text = extractTextFromContentBlock(update.content);
                if (text) {
                    sink.push({ role: 'assistant', text });
                }
                return true;
            }

            case 'agent_thought_chunk': {
                const text = extractTextFromContentBlock(update.content);
                if (text) {
                    sink.push({ role: 'thought', text });
                }
                return true;
            }

            case 'tool_call':
            case 'tool_call_update': {
                this._emitToolCallUpdate(update, kind);
                return true;
            }

            default:
                return false;
        }
    }

    private _syncSessionModels(source: unknown): void {
        if (source && typeof source === 'object') {
            const r = source as Record<string, unknown>;
            if (Array.isArray(r.configOptions)) {
                this._configOptions = r.configOptions as unknown[];
            }
            if (r.models != null) {
                this._hermesModelsRaw = r.models;
            }
        }
        const state = buildModelListStateFromSessionResponse(source);
        if (state) {
            this._modelListState = state;
            this._runtimeModelId = state.currentValueId;
        }
        this._onModelsChanged(this._modelListState);
    }

    private _syncConfigOptions(configOptions: unknown): void {
        this._configOptions = Array.isArray(configOptions) ? configOptions : [];
        const fromConfig = buildModelListState(this._configOptions);
        if (fromConfig) {
            this._modelListState = fromConfig;
        } else if (this._hermesModelsRaw) {
            // Hermes sends empty configOptions on updates; keep native model list.
            this._modelListState = buildModelListStateFromHermesModels(this._hermesModelsRaw);
        }
        this._onModelsChanged(this._modelListState);
    }

    private _applyHermesModelSelection(valueId: string): void {
        if (!this._modelListState && this._hermesModelsRaw) {
            this._modelListState = buildModelListStateFromHermesModels(this._hermesModelsRaw);
        }
        if (!this._modelListState) {
            return;
        }
        const picked = this._modelListState.models.find(m => m.valueId === valueId);
        this._modelListState = {
            ...this._modelListState,
            configId: HERMES_MODEL_CONFIG_ID,
            currentValueId: valueId,
            currentLabel: picked?.name ?? valueId,
            fromAgent: true,
        };
        if (this._hermesModelsRaw && typeof this._hermesModelsRaw === 'object') {
            const raw = this._hermesModelsRaw as Record<string, unknown>;
            this._hermesModelsRaw = {
                ...raw,
                currentModelId: valueId,
                current_model_id: valueId,
            };
        }
        this._onModelsChanged(this._modelListState);
    }

    /** Finalize the current assistant/thought stream so the next chunk starts fresh. */
    private _endAssistantSegment(): void {
        this._responseBuffer = '';
        this._thoughtBuffer = '';
        this._onSegmentEnd();
    }

    private _emitToolCallUpdate(update: Record<string, unknown>, kind: 'tool_call' | 'tool_call_update'): void {
        const parsed = parseToolCallSessionUpdate(update, kind);
        if (!parsed) {
            return;
        }
        const merged = this._toolCallTracker.apply(parsed);
        const text = formatToolCallDisplay(merged);
        if (this._replaySink) {
            this._replaySink.push({ role: 'tool', text, toolCallId: merged.toolCallId });
            return;
        }
        this._onMessage('tool', text, merged.toolCallId);
    }

    private _emitCancelledToolCalls(): void {
        for (const view of this._toolCallTracker.cancelActive()) {
            this._onMessage('tool', formatToolCallDisplay(view), view.toolCallId);
        }
    }

    private _buildNewSessionRequest(cwd: string): { cwd: string; mcpServers: SessionMcpServer[] } {
        const mcpServers = this._resolveMcpServers(cwd);
        this._onLog(`session/new cwd=${cwd} mcpServers=${mcpServers.length}`);
        return { cwd, mcpServers };
    }

    private _transitionTo(status: AcpStatus, message?: string): boolean {
        const allowed = AcpClient.VALID[this._status];
        if (!allowed || !allowed.includes(status)) {
            return false;
        }
        this._status = status;
        this._onStatus(status, message);
        return true;
    }

    private _isMethodNotFoundError(err: unknown): boolean {
        const msg = err instanceof Error ? err.message : String(err);
        return /method not found|method_not_found/i.test(msg);
    }
}
