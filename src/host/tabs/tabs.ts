import type { SessionInfo } from '../../shared/chat';

/**
 * The bookkeeping rules of the tab index: registering a tab, and the two order rules the strip
 * has — pinned first, and pins stay inside their own group.
 *
 * Pure array-in/array-out, so each rule can be read and tested on its own. The panel keeps
 * the writes and the posts.
 */

export function registerSession(
    sessions: SessionInfo[],
    entry: { id: string; title: string; now?: number }
): SessionInfo[] {
    if (sessions.some(session => session.id === entry.id)) {
        return sessions;
    }
    const now = entry.now ?? Date.now();
    return [
        {
            id: entry.id,
            title: entry.title,
            createdAt: parseInt(entry.id, 36) || now,
            updatedAt: now,
        },
        ...sessions,
    ];
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

/** Pinned first, then the most recently updated. The one order rule the strip has. */
function sortPinnedFirst(sessions: SessionInfo[]): SessionInfo[] {
    return [...sessions].sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) {
            return a.pinned ? -1 : 1;
        }
        return b.updatedAt - a.updatedAt;
    });
}

export function normalizePinnedOrder(sessions: SessionInfo[]): SessionInfo[] {
    return sortPinnedFirst(sessions);
}

/**
 * Toggle a pin. The tab is stamped as just updated, so it sorts into place by the one order
 * rule: pinned tabs first, then the most recent — which is where the user just put it.
 */
export function pinSession(sessions: SessionInfo[], sessionId: string, now: number = Date.now()): SessionInfo[] {
    const index = sessions.findIndex(record => record.id === sessionId);
    if (index === -1) {
        return sessions;
    }
    const next = sessions.map((record, position) =>
        position === index ? { ...record, pinned: !record.pinned, updatedAt: now } : record
    );
    return sortPinnedFirst(next);
}

/**
 * Apply the order the strip reported. In our model a tab is one session, so the strip sends
 * everything it shows: tabs it does not mention are appended rather than dropped, and ids it
 * invents are ignored. Pinned tabs stay at the front whatever order arrived.
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
    return normalizePinnedOrder([...placed, ...rest]);
}
