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
    /** The cwd of one tab's session: its own root, else the agent's default. */
    resolveCwdFor(sessionId: string): string;
    /**
     * This tab's staged conversation, as the block that carries it — '' when nothing is staged.
     *
     * Read at send time, from the tab the turn belongs to: a pick staged in one tab must never
     * travel into another.
     */
    historyBlock(tabId: string): string;
    /** The tree notice for this tab: the files named once per session and workspace, then ''. */
    treeBlock(tabId: string): string;
    log(line: string): void;
    post(msg: HostToPane): void;
    otherSessionIsPrompting(): boolean;
    detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void>;
    bindHermesSessionId(hermesSessionId: string): void;
    applySessionModelPreference(): Promise<void>;
    /**
     * Bring the session's edit mode in line with the buttons, and wait for Hermes' answer.
     *
     * Awaited before a first prompt goes out: Hermes starts every session on `default`, and a
     * `set_mode` sent after the prompt is refused as busy, so the whole first turn would run on the
     * wrong mode. A refusal is logged and the send goes on — the mode is not worth the message.
     */
    applySessionEditMode(): Promise<void>;
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

/** One image a turn carries: the pane's own payload, passed through untouched. */
export interface PromptImage {
    mimeType?: string;
    data: string;
}

/** What one turn sends: text, in order, and images after it. */
type PromptBlock = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string };

/**
 * How long a permission card waits for an answer before the request is cancelled: Node's
 * `setTimeout` ceiling, 2^31-1 ms (~24.8 days) — any larger delay overflows and fires at once.
 * Hermes' own `approvals.timeout` is clamped at 365 days, so the card is still always the side
 * that gives up first, which is what keeps its expiry message honest.
 */
const PERMISSION_TIMEOUT_MS = 2_147_483_647;

interface PendingPermission {
    resolve: (optionId: string | null) => void;
    /** Cleared on every exit — a timer that fires after an answer would post a second, wrong one. */
    timer: ReturnType<typeof setTimeout>;
}

/** Whether a send may proceed, and whether the reader has already been told why not. */
export type SessionReadiness = { ok: true } | { ok: false; notified: boolean };

/**
 * The turn in flight, and the session it runs on.
 *
 * Holds the streaming state for the current prompt, the pending permission cards, the steer
 * counter and the send epoch (a switch or a detach bumps it, so a late chunk is dropped rather
 * than painted into the next tab), and `ensureSessionReady` — the single `session/new` site: a tab
 * that never had a Hermes session gets one on its first message, and so does a blank tab whose
 * session Hermes refuses to resume; a tab that shows a conversation keeps it, and is told why.
 */
export class PromptRunner {
    promptSessionId: string | undefined;
    lastAssistantText = '';
    lastThoughtText = '';
    sendEpoch = 0;
    stallTimer: ReturnType<typeof setTimeout> | undefined;
    /** Cards waiting for the pane, keyed by id. Turn-scoped: a detach or the timer resolves them. */
    private readonly pendingPermissions = new Map<string, PendingPermission>();
    private permissionCounter = 0;

    /**
     * `permissionTimeoutMs` is a parameter rather than a constant read inside, so a test can watch
     * an unanswered card expire without waiting two minutes.
     */
    constructor(
        private readonly host: PromptHost,
        private readonly permissionTimeoutMs: number = PERMISSION_TIMEOUT_MS,
    ) {}

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
            // An unanswered card used to wait for the rest of the turn: the ACP request stayed
            // open, the agent waited, and nothing ever said which side had given up.
            const timer = setTimeout(() => this._expirePermission(id), this.permissionTimeoutMs);
            this.pendingPermissions.set(id, { resolve, timer });
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
        clearTimeout(pending.timer);
        this.pendingPermissions.delete(id);
        if (optionId) {
            const label = this.host.permissionOptionLabel(id, optionId) ?? optionId;
            this.host.log(`Permission approved: ${optionId}`);
            this.host.resolvePermissionHistory(id, 'selected', optionId, label);
            pending.resolve(optionId);
            return;
        }
        this.host.log('Permission cancelled');
        this.host.resolvePermissionHistory(id, 'cancelled');
        pending.resolve(null);
    }

    /**
     * The card was never answered. Resolve it the way a cancel does — the ACP request has to come
     * back with something — and leave one line in the transcript, so the turn continuing or
     * stopping has a stated reason rather than looking like the agent changed its mind.
     */
    private _expirePermission(id: string): void {
        const pending = this.pendingPermissions.get(id);
        if (!pending) {
            return;
        }
        this.pendingPermissions.delete(id);
        const seconds = Math.round(this.permissionTimeoutMs / 1000);
        this.host.log(`Permission timed out after ${seconds}s; the request was cancelled`);
        this.host.resolvePermissionHistory(id, 'cancelled');
        this.host.post({ type: 'permissionDismiss', id });
        const text = t('permissionTimedOut', seconds);
        this.host.saveMessage('assistant', text);
        this.host.post({ type: 'addMessage', role: 'assistant', text, sessionId: this.host.sessionId() });
        pending.resolve(null);
    }

    /** Resolve every waiting card as cancelled and dismiss it in the pane. */
    cancelPendingPermissions(): void {
        if (this.pendingPermissions.size === 0) {
            return;
        }
        for (const [id, pending] of this.pendingPermissions) {
            clearTimeout(pending.timer);
            this.host.resolvePermissionHistory(id, 'cancelled');
            pending.resolve(null);
            this.host.post({ type: 'permissionDismiss', id });
        }
        this.pendingPermissions.clear();
    }

    /**
     * Send one user turn: the blocks it carries, then the images.
     *
     * The order is the contract — the attached conversation first, then the tree notice, then what
     * the user typed, then one image block per image. A turn that carries nothing but text goes out
     * as a plain string, which is what Hermes expects when there is nothing to wrap.
     *
     * The two blocks are asked for here, in this order, whether or not the turn ends up carrying
     * both: asking is what puts the tree notice on the record, so it is said once for a session and
     * workspace and not again.
     */
    async sendUserTurn(tabId: string, text: string, images?: PromptImage[]): Promise<void> {
        const blocks = this._blocksFor(tabId, text, images);
        if (blocks) {
            await this.host.acp()?.sendMessage(blocks as any);
            return;
        }
        await this.host.acp()?.sendMessage(text);
    }

    /** The blocks for one turn, or undefined when the turn is its text alone. */
    private _blocksFor(tabId: string, text: string, images?: PromptImage[]): PromptBlock[] | undefined {
        const historyBlock = this.host.historyBlock(tabId);
        const treeBlock = this.host.treeBlock(tabId);
        const imageCount = images?.length ?? 0;
        if (imageCount === 0 && !historyBlock && !treeBlock) {
            return undefined;
        }
        const blocks: PromptBlock[] = [];
        if (historyBlock) {
            blocks.push({ type: 'text', text: historyBlock });
        }
        if (treeBlock) {
            blocks.push({ type: 'text', text: treeBlock });
        }
        if (text.length > 0) {
            blocks.push({ type: 'text', text });
        }
        for (const img of images || []) {
            blocks.push({ type: 'image', mimeType: img.mimeType || 'image/png', data: img.data });
        }
        return blocks;
    }

    /**
     * Make sure the active tab has a live ACP session and that the client is bound to it.
     *
     * One session per tab. A tab with a bound session resumes it; a refusal leaves the tab as it
     * was, and a blank tab whose session was refused gets a session of its own — the state a synced
     * session leaves on another machine, where every later message used to vanish. A tab that shows
     * a conversation is never re-sessioned: it is told why, and keeps what it shows. A turn still
     * running for a *different* tab is detached first — under one-session-per-tab that can only
     * mean the active tab was replaced underneath it.
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
        // Hermes may refuse a bound session — one synced from another machine keeps a cwd this one
        // never had. The refusal is kept, not dropped: an empty tab can still be given a session of
        // its own, and a tab that shows a conversation must hear why it cannot go on.
        let refused: string | undefined;
        if (bound && acp.activeSessionId !== bound) {
            try {
                await acp.loadSession(this.host.resolveCwdFor(sessionId), bound);
                this.host.log(`Switched Hermes session to ${bound}`);
            } catch (err) {
                refused = err instanceof Error ? err.message : String(err);
                this.host.log(`Resume failed for ${bound}: ${refused}`);
            }
        }
        if (!bound || refused !== undefined) {
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
                const text = refused !== undefined && bound
                    ? t('sessionResumeFailed', bound, refused)
                    : t('sessionNotFound', sessionId);
                this.host.post({ type: 'addMessage', role: 'assistant', text });
                return { ok: false, notified: true };
            }
            // Blank tab: the first message is what creates its session. A tab whose session Hermes
            // refused is a blank tab holding a stale id, not a conversation to protect — that is the
            // state a failed resume leaves, and it used to swallow every later message.
            await acp.newSession(this.host.resolveCwdFor(sessionId));
            if (this.host.acpStatus() !== 'ready') {
                // `newSession` keeps the connection when the agent refuses and reports through
                // the status; without this check the turn fell through as a success and the send
                // went to a session that was never created — or to whatever was still bound.
                this.host.log('session/new produced no ready session; the tab stays unbound');
                return { ok: false, notified: false };
            }
            this.host.bindHermesSessionId(acp.activeSessionId);
            // Hermes starts every session on `default`. The button's edit mode goes out now, and
            // the send waits for its answer: sent after the prompt, Hermes refuses it as busy and
            // the whole first turn runs on `default`.
            try {
                await this.host.applySessionEditMode();
            } catch (err) {
                // A refused or broken edit mode is logged; the message the user asked for still goes.
                this.host.log(`Edit mode not applied before the first prompt: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        await this.host.applySessionModelPreference();
        this.host.setBoundSessionId(sessionId);
        return { ok: true };
    }
}
