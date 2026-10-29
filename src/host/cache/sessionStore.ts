import * as fs from 'fs';
import { activeSessionPathFor, sessionsPathFor } from './profileStorage';
import type { SessionInfo } from '../../shared/chat';

/** The catalog keeps the most recent 50 sessions. Transcripts are Hermes' business now. */
export const CATALOG_LIMIT = 50;

/**
 * Everything the extension keeps on disk about sessions: an index of which tab belongs to which
 * Hermes session, and which session was last active. Transcripts are Hermes'.
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
