/**
 * The only piece of conversation state the pane keeps on disk.
 *
 * A user message is written here when it is sent, and read back when a replay arrives, to answer
 * one question: did the agent ever receive it? Nothing else uses this file — no paint, no
 * restore, no viewer. Everything the pane shows comes from Hermes.
 *
 * Five is a safety margin over the one message that can be in flight; the cost is a few KB.
 */
import * as fs from 'fs';
import path from 'path';

export const PENDING_USER_LIMIT = 5;

export interface PendingUser {
    text: string;
    savedAt: number;
}

export class PendingUserStore {
    constructor(private readonly _historyDir: string) {}

    pathFor(sessionId: string): string {
        const safe = (sessionId || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
        return path.join(this._historyDir, `pending_${safe}.json`);
    }

    read(sessionId: string): PendingUser[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.pathFor(sessionId), 'utf-8')) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .filter((entry): entry is PendingUser => !!entry && typeof (entry as PendingUser).text === 'string')
                .slice(-PENDING_USER_LIMIT);
        } catch {
            return [];
        }
    }

    /** One write per user turn; the cap is applied on the way in, not on read. */
    append(sessionId: string, text: string, savedAt: number = Date.now()): void {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return;
        }
        const users = [...this.read(sessionId), { text: trimmed, savedAt }].slice(-PENDING_USER_LIMIT);
        this._write(sessionId, users);
    }

    /** Keep only what is still unreceived — usually nothing, which removes the file. */
    retain(sessionId: string, texts: string[]): void {
        const keep = this.read(sessionId).filter(user => texts.includes(user.text));
        if (keep.length === 0) {
            this.clear(sessionId);
            return;
        }
        this._write(sessionId, keep);
    }

    clear(sessionId: string): void {
        try {
            fs.unlinkSync(this.pathFor(sessionId));
        } catch { /* already gone */ }
    }

    private _write(sessionId: string, users: PendingUser[]): void {
        try {
            fs.mkdirSync(this._historyDir, { recursive: true });
            fs.writeFileSync(this.pathFor(sessionId), JSON.stringify(users), 'utf-8');
        } catch { /* the sidecar is a guard, never a blocker */ }
    }
}
