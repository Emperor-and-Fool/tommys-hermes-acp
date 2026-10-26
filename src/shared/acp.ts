/** ACP shapes the pane renders: a permission choice and a catalog row. */

export interface PermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

/**
 * One row of Hermes' own session catalog, hidden rows included.
 *
 * ``session/list`` only returns what a client may show, so the sidebar — whose tabs are
 * the inverse projection (a tab is an *unhidden* session) — reads this instead.
 */
export interface CatalogSession {
    sessionId: string;
    title?: string;
    cwd?: string;
    hidden: boolean;
    messageCount: number;
    updatedAt: number;
}
