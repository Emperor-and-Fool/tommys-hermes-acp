/**
 * Types shared across the chat surfaces.
 *
 * A leaf: this file imports nothing, so anything may import from it without creating a cycle.
 * That is the whole reason it exists — the session modules and the panel both need these
 * shapes, and neither can own them for the other.
 */

/** What the webview posts when the user commits an inline tab title. */
export interface RenameSessionRequest {
    type: 'renameSession';
    sessionId: string;
    title: string;
}

/** Why a title write did not land. `refused` carries Hermes' own explanation in `message`. */
export type SessionTitleRefusal = 'empty' | 'too-long' | 'refused';

/** The result of asking Hermes to retitle a session: the name it now holds, or the refusal. */
export type SessionTitleOutcome =
    | { ok: true; title: string }
    | { ok: false; reason: SessionTitleRefusal; message?: string };

/** One option of a permission prompt, as the transcript keeps it. */
export interface StoredPermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

/** Content-addressed attachment: Hermes never stores the bytes. */
export interface StoredImageRef {
    hash: string;
    mimeType: string;
}

/** One history attach may carry at most this many messages; the pane's tic and the host agree. */
export const MAX_HISTORY_MESSAGES = 15;

/** Where an attached slice of another conversation came from. */
export interface HistoryRef {
    /** The Hermes session the messages were read from. */
    sessionId: string;
    /** The Hermes profile that session belongs to: the agent needs both to find it. */
    profile: string;
    title: string;
    /** How many messages the attach carried. */
    count: number;
    /** Real Hermes message ids, parallel to the attached messages; null where none matched. */
    messageIds: Array<number | null>;
    /** Real timestamps in ms of the matched messages, when at least one id was found. */
    from?: number;
    to?: number;
    /** When no id matched: the opening words of the first message, for the agent to search by. */
    anchor?: string;
}

/** One record of a transcript, as the pane renders it. */
export interface ChatMessage {
    role: string;
    text: string;
    timestamp: number;
    toolCallId?: string;
    aggregatedTools?: Array<{ toolCallId: string; text: string }>;
    permissionId?: string;
    title?: string;
    detail?: string;
    options?: StoredPermissionOption[];
    resolved?: boolean;
    outcome?: 'selected' | 'cancelled';
    selectedOptionId?: string;
    selectedLabel?: string;
    /** Content-addressed attachments for this message: Hermes never stores the bytes. */
    imageRefs?: StoredImageRef[];
    /** Set on role 'history': which conversation the slice came from. */
    history?: HistoryRef;
}

/** One tab: the session row as Hermes reports it, plus the view flags Hermes cannot know. */
export interface SessionInfo {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    modelId?: string;
    modelLabel?: string;
    /** User has sent at least one message to Hermes in this session. */
    agentEngaged?: boolean;
    /** Pinned tabs stay at the front and reorder only within pinned group. */
    pinned?: boolean;
    /**
     * Hermes-side session id backing this tab. Local ids stay for tab/UI history;
     * this is the id ACP `session/load` addresses, so a tab survives reconnects.
     */
    hermesSessionId?: string;
    /** Working directory the Hermes session was created in (used when resuming). */
    cwd?: string;
}

/** What the composer may re-attach from the tab's own transcript. */
export type ContextAttachMode = 'none' | 'last2' | 'last10' | 'all' | 'custom';

/** The picker's answer, sent with a composer send. */
export interface ContextAttachOption {
    mode: ContextAttachMode;
    /** Custom mode: indices into the current tab's transcript, not into another session. */
    indices?: number[];
}

/** What Hermes reports for one session. Only the fields the index actually reads. */
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

/** What a title write needs: the ACP call, the catalog read that follows it, and a log line. */
export interface SessionTitlePort {
    setTitle(sessionId: string, title: string): Promise<boolean>;
    refreshCatalog(): Promise<void>;
    log(line: string): void;
}
