import type { AcpClient } from '../../acp/AcpClient';
import type { ChatMessage, SessionInfo } from '../HermesChatProvider';
import { t } from '../../i18n';

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
    post(msg: unknown): void;
    otherSessionIsPrompting(): boolean;
    detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void>;
    bindHermesSessionId(hermesSessionId: string): void;
    applySessionModelPreference(): Promise<void>;
    setBoundSessionId(sessionId: string): void;
}

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

    constructor(private readonly host: PromptHost) {}

    /**
     * Make sure the active tab has a live ACP session and that the client is bound to it.
     *
     * One session per tab. A tab with a bound session resumes it; a tab with history but no
     * session is refused; only a blank tab creates one. A turn still running for a *different*
     * tab is detached first — under one-session-per-tab that can only mean the active tab was
     * replaced underneath it.
     */
    async ensureSessionReady(): Promise<boolean> {
        const acp = this.host.acp();
        if (!acp) {
            return false;
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
                return false;
            }
        } else if (!bound) {
            if (this.host.messages().length > 0) {
                // This tab shows a conversation whose Hermes session is gone; creating a new
                // one here would silently replace it, so say so and leave the pane alone.
                this.host.log(`No Hermes session bound to tab ${sessionId}`);
                this.host.post({ type: 'addMessage', role: 'assistant', text: t('sessionNotFound', sessionId) });
                return false;
            }
            // Blank tab: the first message is what creates its session.
            await acp.newSession(this.host.resolveCwd());
            this.host.bindHermesSessionId(acp.activeSessionId);
        }
        await this.host.applySessionModelPreference();
        this.host.setBoundSessionId(sessionId);
        return true;
    }
}
