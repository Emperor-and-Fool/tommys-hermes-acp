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

/**
 * What a catalog read answered.
 *
 * The two halves are not interchangeable: `answered: false` is a Hermes without the method, or a
 * read that failed — a catalog nobody has seen, which may not be read as "this profile has no
 * sessions". An empty `sessions` is only ever an answered catalog. The reason is what the user is
 * shown, so it is part of the answer rather than a log line beside it.
 */
export type CatalogAnswer =
    | { answered: true; sessions: CatalogSession[] }
    | { answered: false; reason: string };
