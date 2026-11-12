import type { SessionInfo } from '../../shared/chat';

/**
 * The tab, as a record with rules: registering one, the Hermes id behind it, the one order rule
 * (sticky first, then most recent), and the reorder the strip reports.
 *
 * Pure array-in/array-out, so each rule can be read and tested on its own. The writes and the
 * posts stay with whoever holds the index.
 */

export function registerSession(
    sessions: SessionInfo[],
    entry: { id: string; title: string; now?: number; workspaceId?: string; project?: string }
): SessionInfo[] {
    if (sessions.some(session => session.id === entry.id)) {
        return sessions;
    }
    const now = entry.now ?? Date.now();
    const record: SessionInfo = {
        id: entry.id,
        title: entry.title,
        createdAt: parseInt(entry.id, 36) || now,
        updatedAt: now,
    };
    // Absent stays absent: a tab opened with no workspace gains no empty field.
    if (entry.workspaceId) {
        record.workspaceId = entry.workspaceId;
    }
    // A session started while one project is in use belongs to that project: the new tab lands
    // where the work is, not on the plane where it has to be dragged out of.
    if (entry.project) {
        record.project = entry.project;
    }
    return [record, ...sessions];
}

/**
 * The Hermes session behind a tab.
 *
 * A tab opened from the pane carries a local id until the catalog lists it, so the id the strip
 * shows is not always the id Hermes knows. Writes that address a session by id — a rename — must
 * use this one.
 */
export function hermesSessionIdFor(sessions: SessionInfo[], tabId: string): string {
    const record = sessions.find(session => session.id === tabId);
    return record?.hermesSessionId || tabId;
}

/** Sticky first, then the most recently updated. The one order rule the strip has. */
function sortStickyFirst(sessions: SessionInfo[]): SessionInfo[] {
    return [...sessions].sort((a, b) => {
        if (!!a.sticky !== !!b.sticky) {
            return a.sticky ? -1 : 1;
        }
        return b.updatedAt - a.updatedAt;
    });
}

export function normalizeStickyOrder(sessions: SessionInfo[]): SessionInfo[] {
    return sortStickyFirst(sessions);
}

/**
 * Toggle a pin. The tab is stamped as just updated, so it sorts into place by the one order
 * rule: sticky tabs first, then the most recent — which is where the user just put it.
 */
export function stickSession(sessions: SessionInfo[], sessionId: string, now: number = Date.now()): SessionInfo[] {
    const index = sessions.findIndex(record => record.id === sessionId);
    if (index === -1) {
        return sessions;
    }
    const next = sessions.map((record, position) =>
        position === index ? { ...record, sticky: !record.sticky, updatedAt: now } : record
    );
    return sortStickyFirst(next);
}

/**
 * Apply the order the strip reported. In our model a tab is one session, so the strip sends
 * everything it shows: tabs it does not mention are appended rather than dropped, and ids it
 * invents are ignored. Sticky tabs stay at the front whatever order arrived.
 */
export function reorderSessions(sessions: SessionInfo[], ids: unknown[]): SessionInfo[] | null {
    const order = ids.filter((id): id is string => typeof id === 'string');
    if (!order.length) {
        return null;
    }
    const position = new Map(order.map((id, index) => [id, index]));
    const placed = sessions
        .filter(session => position.has(session.id))
        .sort((a, b) => (position.get(a.id) as number) - (position.get(b.id) as number));
    const rest = sessions.filter(session => !position.has(session.id));
    return normalizeStickyOrder([...placed, ...rest]);
}
