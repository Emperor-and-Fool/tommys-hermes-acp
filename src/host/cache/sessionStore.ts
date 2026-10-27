import * as fs from 'fs';
import * as path from 'path';
import { activeSessionPathFor, sessionsPathFor } from './profileStorage';
import type { ChatMessage, SessionInfo } from '../../shared/chat';

/** The catalog keeps the most recent 50 sessions; a transcript keeps the last 100 messages. */
export const CATALOG_LIMIT = 50;
export const TRANSCRIPT_LIMIT = 100;

/**
 * Everything the extension keeps on disk about sessions: the catalog, one transcript per
 * session, and which session was last active.
 *
 * This class reads and writes files and does nothing else. It holds no session state, knows
 * nothing about the webview, and never decides what to keep — the caps are the caller's
 * contract, spelled out in the constants above.
 */
export class SessionStore {
    constructor(private _historyDir: string, private _scopeKey: string) {}

    /** The catalog is per profile; the transcripts are not. */
    setScope(scopeKey: string): void {
        this._scopeKey = scopeKey;
    }

    get catalogPath(): string {
        return sessionsPathFor(this._historyDir, this._scopeKey);
    }

    get activeIdPath(): string {
        return activeSessionPathFor(this._historyDir, this._scopeKey);
    }

    msgPath(sessionId: string): string {
        return path.join(this._historyDir, `msgs_${sessionId}.json`);
    }

    readCatalog(): SessionInfo[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.catalogPath, 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /** Returns whether the write happened, for a caller that does more on success. */
    writeCatalog(records: SessionInfo[]): boolean {
        try {
            fs.writeFileSync(this.catalogPath, JSON.stringify(records.slice(0, CATALOG_LIMIT), null, 2));
            return true;
        } catch {
            return false;
        }
    }

    readMessages(sessionId: string): ChatMessage[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.msgPath(sessionId), 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * The live transcript write: the last 100 messages. Returns whether it happened, so the
     * caller can decide whether to update the catalog afterwards.
     */
    writeMessages(sessionId: string, messages: ChatMessage[]): boolean {
        try {
            fs.writeFileSync(this.msgPath(sessionId), JSON.stringify(messages.slice(-TRANSCRIPT_LIMIT), null, 2));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * The replay write: what Hermes sent, uncapped. It replaces the file the live writes keep,
     * which is why the caller has to carry anything local across before calling this.
     */
    writeReplayedMessages(sessionId: string, messages: ChatMessage[]): boolean {
        try {
            fs.writeFileSync(this.msgPath(sessionId), JSON.stringify(messages, null, 2));
            return true;
        } catch {
            return false;
        }
    }

    readActiveId(): string | null {
        try {
            const id = fs.readFileSync(this.activeIdPath, 'utf-8').trim();
            return id || null;
        } catch {
            return null;
        }
    }

    writeActiveId(sessionId: string): boolean {
        try {
            fs.writeFileSync(this.activeIdPath, sessionId);
            return true;
        } catch {
            return false;
        }
    }
}
