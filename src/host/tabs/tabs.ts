import type { SessionInfo } from '../../shared/chat';

/**
 * The bookkeeping rules of the tab index: registering a tab, and the two order rules the strip
 * has — sticky first, and pins stay inside their own group.
 *
 * Pure array-in/array-out, so each rule can be read and tested on its own. The panel keeps
 * the writes and the posts.
 */

export function registerSession(
    sessions: SessionInfo[],
    entry: { id: string; title: string; now?: number; workspace?: string }
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
    if (entry.workspace) {
        record.workspace = entry.workspace;
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

/**
 * Move a tab to another workspace.
 *
 * The only write path for the tag: `cwd` is Hermes' to report and gets overwritten on every
 * catalog read, where this field is ours and rides forward untouched.
 */
export function moveSessionToWorkspace(sessions: SessionInfo[], sessionId: string, workspace: string): SessionInfo[] {
    const index = sessions.findIndex(session => session.id === sessionId);
    if (index < 0 || !workspace || sessions[index].workspace === workspace) {
        return sessions;
    }
    const next = sessions.slice();
    next[index] = { ...sessions[index], workspace };
    return next;
}

/**
 * Put a tab in a project folder, or back on the plane when `folderId` is empty.
 *
 * `folder` is a folder id, not a name: a rename must not move the tabs that belong to it.
 */
export function moveSessionToFolder(sessions: SessionInfo[], sessionId: string, folderId: string): SessionInfo[] {
    const index = sessions.findIndex(session => session.id === sessionId);
    if (index < 0 || (sessions[index].folder || '') === folderId) {
        return sessions;
    }
    const next = sessions.slice();
    const record: SessionInfo = { ...sessions[index] };
    if (folderId) {
        record.folder = folderId;
    } else {
        delete record.folder;
    }
    next[index] = record;
    return next;
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
