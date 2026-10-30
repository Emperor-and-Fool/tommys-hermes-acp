import type { AcpClient, PermissionRequest } from '../acp/AcpClient';
import type { ChatMessage, SessionInfo } from '../../shared/chat';
import type { HostToPane } from '../../shared/webview';
import { localizeStatusMessage, t } from '../i18n';

/**
 * What a turn needs from the provider.
 *
 * Deliberately a bag of functions rather than a reference to the provider itself: the
 * provider keeps every member private, and building this once at construction keeps the
 * coupling visible in a single place instead of scattered through `this.`
 *
 * `sessionId` / `messages` / `tabs` are getters, not values — a turn must read the current
 * tab, and the active tab can be replaced while a turn is in flight.
 */
export interface PromptHost {
    acp(): AcpClient | undefined;
    sessionId(): string;
    messages(): ChatMessage[];
    tabs(): SessionInfo[];
    resolveCwd(): string;
    log(line: string): void;
    post(msg: HostToPane): void;
    otherSessionIsPrompting(): boolean;
    detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void>;
    bindHermesSessionId(hermesSessionId: string): void;
    applySessionModelPreference(): Promise<void>;
    setBoundSessionId(sessionId: string): void;
    saveMessage(role: string, text: string): void;
    savePermissionRequest(id: string, request: PermissionRequest): void;
    resolvePermissionHistory(id: string, outcome: 'selected' | 'cancelled', optionId?: string, label?: string): void;
    permissionOptionLabel(id: string, optionId: string): string | undefined;
    acpStatus(): string | undefined;
    isViewingPromptSession(): boolean;
    cancelPendingPermissions(): void;
    awaitSessionReady(): Promise<void>;
}

/** Whether a send may proceed, and whether the reader has already been told why not. */
export type SessionReadiness = { ok: true } | { ok: false; notified: boolean };

/**
 * State of the turn in flight, plus the code that acquires the session it runs on.
 *
 * Step 1 moved the state here alone. Step 2 moves `ensureSessionReady`, which holds the
 * single `session/new` call site: a tab that never had a Hermes session gets one on its
 * first message; a tab that has history but lost its session is refused rather than
 * silently re-sessioned.
 */
export class PromptRunner {
    promptSessionId: string | undefined;
    lastAssistantText = '';
    lastThoughtText = '';
    sendEpoch = 0;
    stallTimer: ReturnType<typeof setTimeout> | undefined;
    /** Cards waiting for the pane, keyed by id. Turn-scoped: a detach resolves them. */
    private readonly pendingPermissions = new Map<string, (optionId: string | null) => void>();
    private permissionCounter = 0;

    constructor(private readonly host: PromptHost) {}

    /**
     * Make sure the active tab has a live ACP session and that the client is bound to it.
     *
     * One session per tab. A tab with a bound session resumes it; a tab with history but no
     * session is refused; only a blank tab creates one. A turn still running for a *different*
     * tab is detached first — under one-session-per-tab that can only mean the active tab was
     * replaced underneath it.
     */
    /**
     * Hermes sends one whole message per chunk, not deltas, so these replace rather than
     * append. Kept here so the turn's text has exactly one owner.
     */
    recordAssistantText(text: string): void {
        this.lastAssistantText = text;
    }

    recordThoughtText(text: string): void {
        this.lastThoughtText = text;
    }

    /** Drop the accumulated turn text without writing it anywhere. */
    clearText(): void {
        this.lastAssistantText = '';
        this.lastThoughtText = '';
    }

    /** Write a completed thought to the transcript, once. */
    flushThought(): void {
        const text = this.lastThoughtText.trim();
        if (!text) {
            return;
        }
        this.host.saveMessage('thought', text);
        this.lastThoughtText = '';
    }

    /** Write the assistant text if there is any, then drop it. */
    saveAssistantText(): void {
        if (!this.lastAssistantText.trim()) {
            return;
        }
        this.host.saveMessage('assistant', this.lastAssistantText);
        this.lastAssistantText = '';
    }

    /** Cancel the no-output hint for this turn. */
    clearStallHint(): void {
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
            this.stallTimer = undefined;
        }
    }

    /**
     * Post "Hermes is initializing..." when the turn has produced nothing for 25 s — the
     * agent is alive but silent while its plugins load, and the pane otherwise looks stuck.
     */
    scheduleStallHint(): void {
        this.clearStallHint();
        this.stallTimer = setTimeout(() => {
            this.stallTimer = undefined;
            if (this.host.acpStatus() !== 'prompting' || !this.host.isViewingPromptSession()) {
                return;
            }
            if (this.lastAssistantText || this.lastThoughtText) {
                return;
            }
            this.host.log('Prompt stall hint: Hermes still initializing');
            this.host.post({
                type: 'status',
                status: 'prompting',
                message: localizeStatusMessage('Hermes is initializing...'),
                sessionId: this.host.sessionId(),
            });
        }, 25000);
    }

    /** Post to the pane only while it shows the tab this turn belongs to. */
    postScoped(msg: HostToPane): void {
        if (!this.host.isViewingPromptSession()) {
            return;
        }
        // The one place a turn stamps its own tab id onto a message; the union cannot express
        // "whatever this is, plus sessionId", so the cast sits here rather than at every caller.
        this.host.post({ ...msg, sessionId: this.host.sessionId() } as HostToPane);
    }

    /**
     * End the turn that belongs to `fromSessionId`, keeping whatever had streamed.
     * A no-op when no turn is running or when the turn belongs to another tab.
     */
    async detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void> {
        if (!this.promptSessionId || this.promptSessionId !== fromSessionId) {
            return;
        }
        if (this.host.acpStatus() !== 'prompting') {
            this.promptSessionId = undefined;
            this.clearText();
            return;
        }
        this.host.log(`Detaching in-flight prompt from session ${fromSessionId}`);
        if (options?.savePartial !== false) {
            this.flushThought();
            this.saveAssistantText();
        }
        this.clearText();
        this.sendEpoch++;
        this.cancelPendingPermissions();
        await this.host.acp()?.cancel();
        this.promptSessionId = undefined;
    }

    /**
     * User pressed Stop. The epoch bump comes first so any chunk still in flight is dropped,
     * and the pending permission cards are resolved as cancelled before the agent answers.
     */
    async cancel(): Promise<void> {
        this.sendEpoch++;
        this.clearStallHint();
        await this.host.awaitSessionReady();
        this.flushThought();
        this.clearText();
        this.promptSessionId = undefined;
        this.cancelPendingPermissions();
        const acp = this.host.acp();
        const wasPrompting = acp?.status === 'prompting';
        await acp?.cancel();
        this.host.post({ type: 'finishAssistantBubble', sessionId: this.host.sessionId() });
        if (!wasPrompting && acp?.status === 'ready') {
            this.host.post({ type: 'status', status: 'ready', sessionId: this.host.sessionId() });
        }
    }

    /** Ask the pane to approve a tool call; resolves with the chosen option id, or null. */
    requestPermission(request: PermissionRequest): Promise<string | null> {
        this.host.log(`Permission requested: ${request.title.slice(0, 80)}`);
        return new Promise((resolve) => {
            const id = `perm_${++this.permissionCounter}`;
            this.pendingPermissions.set(id, resolve);
            this.host.savePermissionRequest(id, request);
            this.host.post({
                type: 'permissionRequest',
                id,
                title: request.title,
                detail: request.detail,
                options: request.options,
            });
        });
    }

    /** The pane answered a card. Unknown ids are ignored — a stale click after a detach. */
    handlePermissionResponse(id: string, optionId: string | null): void {
        const pending = this.pendingPermissions.get(id);
        if (!pending) {
            return;
        }
        this.pendingPermissions.delete(id);
        if (optionId) {
            const label = this.host.permissionOptionLabel(id, optionId) ?? optionId;
            this.host.log(`Permission approved: ${optionId}`);
            this.host.resolvePermissionHistory(id, 'selected', optionId, label);
            pending(optionId);
            return;
        }
        this.host.log('Permission cancelled');
        this.host.resolvePermissionHistory(id, 'cancelled');
        pending(null);
    }

    /** Resolve every waiting card as cancelled and dismiss it in the pane. */
    cancelPendingPermissions(): void {
        if (this.pendingPermissions.size === 0) {
            return;
        }
        for (const [id, resolve] of this.pendingPermissions) {
            this.host.resolvePermissionHistory(id, 'cancelled');
            resolve(null);
            this.host.post({ type: 'permissionDismiss', id });
        }
        this.pendingPermissions.clear();
    }

    /**
     * Bind (or create) this tab's Hermes session.
     *
     * The answer carries who said what: `notified` means this function already told the reader the
     * specific reason, so the caller must not add a second, vaguer line on top of it. Two messages
     * for one send — "no session (id)" followed by "not connected, nothing was sent" — read as two
     * different failures.
     */
    async ensureSessionReady(): Promise<SessionReadiness> {
        const acp = this.host.acp();
        if (!acp) {
            return { ok: false, notified: false };
        }
        if (this.host.otherSessionIsPrompting()) {
            await this.host.detachActivePrompt(this.promptSessionId!, { savePartial: true });
        }
        const sessionId = this.host.sessionId();
        const bound = this.host.tabs().find((rec) => rec.id === sessionId)?.hermesSessionId;
        if (bound && acp.activeSessionId !== bound) {
            const record = this.host.tabs().find((rec) => rec.id === sessionId);
            try {
                await acp.loadSession(record?.cwd || this.host.resolveCwd(), bound);
                this.host.log(`Switched Hermes session to ${bound}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.host.log(`Resume failed for ${bound}: ${msg}`);
                this.host.post({ type: 'addMessage', role: 'assistant', text: t('sessionNotFound', bound) });
                return { ok: false, notified: true };
            }
        } else if (!bound) {
            // A conversation Hermes knows about has user or assistant turns. A peer card waiting
            // for a decision is not one: it is a draft, and refusing here left a fresh tab with a
            // received forward unable to start its session at all.
            const hasConversation = this.host.messages().some(
                (message) => message.role === 'user' || message.role === 'assistant'
            );
            if (hasConversation) {
                // This tab shows a conversation whose Hermes session is gone; creating a new
                // one here would silently replace it, so say so and leave the pane alone.
                this.host.log(`No Hermes session bound to tab ${sessionId}`);
                this.host.post({ type: 'addMessage', role: 'assistant', text: t('sessionNotFound', sessionId) });
                return { ok: false, notified: true };
            }
            // Blank tab: the first message is what creates its session.
            await acp.newSession(this.host.resolveCwd());
            this.host.bindHermesSessionId(acp.activeSessionId);
        }
        await this.host.applySessionModelPreference();
        this.host.setBoundSessionId(sessionId);
        return { ok: true };
    }
}
