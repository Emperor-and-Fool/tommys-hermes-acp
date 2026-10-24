import type { SessionInfo } from '../HermesChatProvider';
import type { SessionTitleOutcome } from '../../types/chat';

/**
 * What Hermes reports for one session. Only the fields the index actually reads; anything
 * else in the catalog is ignored rather than carried along.
 */
export interface CatalogRow {
    sessionId: string;
    title?: string;
    updatedAt?: number;
    messageCount?: number;
    cwd?: string;
    hidden?: boolean;
}

export interface ApplyCatalogInput<T extends CatalogRow = CatalogRow> {
    /** The local index as it stands. */
    previous: SessionInfo[];
    /** What Hermes just reported, as the caller received it. */
    rows: T[];
    /** The tab the pane is showing: it may not be in the catalog yet. */
    activeId: string;
    /** A tab with no messages yet is new; it is kept even when Hermes does not list it. */
    activeHasMessages: boolean;
    now?: number;
}

export interface ApplyCatalogResult<T extends CatalogRow = CatalogRow> {
    sessions: SessionInfo[];
    /** The tab to show: unchanged, or the newest when the old one is gone. */
    activeId: string;
    activeChanged: boolean;
    /** Rows Hermes flagged hidden: closed tabs, retrievable through the picker. */
    hiddenRows: T[];
}

/**
 * Merge Hermes' catalog into the local index.
 *
 * Hermes owns the sessions; this index only remembers what it cannot know: which local tab
 * belongs to which session, and the view flags the user set (pin, model snapshot, cwd). Ten of
 * these fields are carried forward from the previous record, which is why the merge is a
 * function rather than a loop buried in the panel: it can be read, and it can be tested.
 */
export function applyCatalogRows<T extends CatalogRow>(input: ApplyCatalogInput<T>): ApplyCatalogResult<T> {
    const now = input.now ?? Date.now();
    const previousById = new Map(input.previous.map(record => [record.id, record]));
    const previousByHermes = new Map(
        input.previous
            .filter(record => !!record.hermesSessionId)
            .map(record => [record.hermesSessionId as string, record])
    );

    const sessions: SessionInfo[] = [];
    for (const row of input.rows) {
        if (row.hidden) {
            continue;
        }
        // A tab opened through session/new carries its local id until the catalog lists it,
        // so match on the Hermes id as well, or the same session would open twice.
        const prior = previousById.get(row.sessionId) || previousByHermes.get(row.sessionId);
        sessions.push({
            id: prior?.id || row.sessionId,
            // Hermes owns the title; the local record only remembers the last one it saw.
            title: row.title || prior?.title || row.sessionId.slice(0, 8),
            createdAt: prior?.createdAt ?? (row.updatedAt || now),
            updatedAt: row.updatedAt || prior?.updatedAt || now,
            messageCount: row.messageCount ?? prior?.messageCount ?? 0,
            pinned: prior?.pinned,
            modelId: prior?.modelId,
            modelLabel: prior?.modelLabel,
            agentEngaged: prior?.agentEngaged ?? (row.messageCount ?? 0) > 0,
            hermesSessionId: row.sessionId,
            cwd: row.cwd ?? prior?.cwd,
        });
    }

    // A session created moments ago has no messages, so the catalog does not list it yet;
    // keep the tab the user is sitting in until its first turn lands.
    const current = previousById.get(input.activeId);
    if (current && !input.activeHasMessages && !sessions.some(record => record.id === input.activeId)) {
        sessions.unshift(current);
    }

    sessions.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) {
            return a.pinned ? -1 : 1;
        }
        return b.updatedAt - a.updatedAt;
    });

    // The active id can disappear on us: closed elsewhere, or a stale id restored from disk
    // before the connection existed. Fall back to the newest tab rather than leave the view
    // pointed at a session that is no longer open.
    let activeId = input.activeId;
    let activeChanged = false;
    if (sessions.length > 0 && !sessions.some(record => record.id === activeId)) {
        activeId = sessions[0].id;
        activeChanged = true;
    }

    return {
        sessions,
        activeId,
        activeChanged,
        hiddenRows: input.rows.filter(row => row.hidden),
    };
}

/** Hermes' own ceiling (`SessionDB.MAX_TITLE_LENGTH`); checking here saves a round trip. */
export const MAX_SESSION_TITLE_LENGTH = 100;

/**
 * The title a write would send, or the reason Hermes would refuse it.
 *
 * Whitespace collapses the way the agent collapses it, so a title made only of spaces is
 * empty here as well rather than on the other side of the connection.
 */
export function normalizeSessionTitle(raw: unknown): SessionTitleOutcome {
    if (typeof raw !== 'string') {
        return { ok: false, reason: 'empty' };
    }
    const title = raw.replace(/\s+/g, ' ').trim();
    if (!title) {
        return { ok: false, reason: 'empty' };
    }
    if (title.length > MAX_SESSION_TITLE_LENGTH) {
        return { ok: false, reason: 'too-long' };
    }
    return { ok: true, title };
}

/** What a title write needs: the ACP call, the catalog read that follows it, and a log line. */
export interface SessionTitlePort {
    setTitle(sessionId: string, title: string): Promise<boolean>;
    refreshCatalog(): Promise<void>;
    log(line: string): void;
}

/**
 * Retitle a tab through Hermes, then re-read the catalog.
 *
 * The local index is never written here: the strip takes the name from the catalog like every
 * other field Hermes owns. A refusal is reported, not swallowed — the caller logs it and the
 * tab keeps the title Hermes still holds.
 */
export async function renameSession(
    port: SessionTitlePort,
    sessionId: string,
    rawTitle: unknown
): Promise<SessionTitleOutcome> {
    const normalized = normalizeSessionTitle(rawTitle);
    if (!normalized.ok) {
        return normalized;
    }
    try {
        await port.setTitle(sessionId, normalized.title);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: 'refused', message };
    }
    await port.refreshCatalog();
    return normalized;
}
