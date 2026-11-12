/**
 * Types shared across the chat surfaces.
 *
 * A leaf: this file imports nothing, so anything may import from it without creating a cycle.
 * That is the whole reason it exists — the session modules and the panel both need these
 * shapes, and neither can own them for the other.
 */

const STEER_OPEN = /^\[OUT-OF-BAND USER MESSAGE[^\]]*\]\s*/;

const STEER_CLOSE = /\s*\[\/OUT-OF-BAND USER MESSAGE\]\s*$/;

/**
 * Text the agent stored for a steer carries the delivery wrapper it was sent with. That marker
 * says how the message arrived once; rendered or replayed verbatim it reads as if the user had
 * typed it. Stripping is idempotent, so both sides of a comparison may apply it.
 */
export function unwrapSteer(text: string): { text: string; steer: boolean } {
    if (!text.startsWith('[OUT-OF-BAND USER MESSAGE')) {
        return { text, steer: false };
    }
    return { text: text.replace(STEER_OPEN, '').replace(STEER_CLOSE, '').trim(), steer: true };
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
    /** Set on role 'peer': the messages the forward carried, one bubble each after a restore. */
    peerMessages?: Array<{ text: string; sentBy?: string; sourceMessageId?: string }>;
    /** Set on role 'history': which conversation the slice came from. */
    history?: HistoryRef;
    /** Set on a user message that went into a *running* turn rather than starting one. */
    steer?: boolean;
    /** Set on role 'peer': a draft forwarded from the sibling pane, not yet a turn. */
    peer?: PeerRef;
    /** Where a peer card stands. Absent on everything that is not a peer card. */
    peerState?: PeerState;
}

/** Who sent a forwarded draft, and which envelope it came in on. */
export interface PeerRef {
    forwarderProfile: string;
    forwarderHost: string;
    sourceMessageId?: string;
    /** The pane-mail envelope id: the dedupe key, and what the actions address. */
    envelopeId: string;
    /** Which side sent it: the accent on the card. */
    forwarderRole?: 'primary' | 'secondant';
    /** Who wrote it: 'user', 'agent', 'tool', a profile name, or 'mixed' on the envelope. */
    sentBy?: string;
    /** The messages the forward carried, so the card can draw one bubble each. */
    peerMessages?: Array<{ text: string; sentBy?: string; sourceMessageId?: string }>;
}

/** A peer card is pending until the user delivers or dismisses it. */
export type PeerState = 'pending' | 'delivered' | 'dismissed' | 'expired';

/** The state an action leaves behind: the first decision stands. */
export function peerStateAfter(current: PeerState, action: 'deliver' | 'dismiss'): PeerState {
    if (current !== 'pending') {
        return current;
    }
    return action === 'deliver' ? 'delivered' : 'dismissed';
}

/**
 * One tab: the id pair (local, Hermes) and the view flags Hermes cannot know.
 *
 * Nothing here is a fact about the conversation's content. A count or an "engaged" flag read
 * from the transcript was a local copy of something Hermes owns, and it outlived the transcript
 * it was derived from — which is how the local copy came to stand in for the link itself.
 */
export interface SessionInfo {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    modelId?: string;
    modelLabel?: string;
    /** Sticky tabs stay at the front and reorder only within sticky group. */
    sticky?: boolean;
    /**
     * Hermes-side session id backing this tab. Local ids stay for tab/UI history;
     * this is the id ACP `session/load` addresses, so a tab survives reconnects.
     */
    hermesSessionId?: string;
    /** Working directory the Hermes session was created in (used when resuming). */
    cwd?: string;
    /** The workspace this tab was opened in, by id: the tab's reference into the workspace list. */
    workspaceId?: string;
    /** The project this tab was moved into. Absent means the plane below the projects. */
    project?: string;
}

/**
 * THE THREE RECORDS BELOW ARE ROWS OF THREE TABLES.
 *
 * `Workspace` is global; `Project` and `SessionInfo` are partitioned by the profile (the scope
 * key). `Project.workspaceId` and `SessionInfo.workspaceId` / `.project` are foreign keys into
 * `Workspace.id` and `Project.id` — never paths, never names. The schema they are written for is
 * spelled out in `host/workspace/workSpace.ts`; keep additions to these types a column of one of
 * those tables, and nothing here has to change when the storage becomes SQLite.
 */

/**
 * One workspace this editor has opened.
 *
 * It carries an id and not only a path, because two things point at a workspace — a project and a
 * tab — and they must point at it the way a foreign key does. The path is the identity VS Code
 * gives us; the id is the one everything else refers to.
 */
export interface Workspace {
    id: string;
    path: string;
    lastSeen: number;
}

/**
 * A project folder: the name he gives a group of tabs, and the workspace it is connected to.
 *
 * The connection is what makes the folder a parent: its tabs are the ones opened in that
 * workspace, unless a tab was moved into it by hand.
 */
export interface Project {
    id: string;
    name: string;
    /** The id of the workspace this project belongs to. */
    workspaceId: string;
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
    /**
     * Whether the active tab is bound to a session Hermes just listed. A tab that is not —
     * a brand-new one, or one whose session vanished — is kept by hand; a linked one is the
     * catalog's to supply, so the record is rebuilt from the row rather than carried forward.
     */
    activeLinked: boolean;
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
