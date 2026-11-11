import type { ChatMessage, HistoryRef, PeerState, ProjectFolder, SessionInfo, StoredImageRef, WorkspaceEntry } from '../../shared/chat';
import type { HostToPane } from '../../shared/webview';
import type { CatalogSession, PermissionRequest } from '../acp/AcpClient';
import { SessionStore } from './sessionStore';
import { applyCatalogRows } from './catalog';
import { PendingUserStore } from './pendingUsers';
import {
    moveSessionToFolder,
    moveSessionToWorkspace,
    normalizeStickyOrder,
    stickSession,
    registerSession,
    reorderSessions,
} from '../tabs/tabs';
import { canAggregateToolTexts, rebuildAggregatedToolText } from '../../shared/toolAggregate';
import { buildSessionExportPayload } from '../chat/sessionExport';
import { t } from '../i18n';

/** What the sessions state needs from the provider: the pane, the log, the title, the model label. */
export interface SessionsHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    updatePanelTitle(): void;
    modelLabel(): string | undefined;
    /** The workspace this window is, read when a tab record is created. */
    currentWorkspace(): string;
    /** Every workspace this editor has opened: what a "move to" menu offers. */
    workspaces(): WorkspaceEntry[];
    /** The project folders he named, in the order the strip draws them. */
    folders(): ProjectFolder[];
}

/**
 * Session state: the tab list, the active id, the transcript, the hidden rows, the scope and
 * the store that persists them. Methods moved here keep their bodies unchanged; the provider
 * reaches them through one-line delegates until Part B closes the seam.
 */
export class Sessions {
    activeId: string = '';
    messages: ChatMessage[] = [];
    tabs: SessionInfo[] = [];
    /**
     * Hermes' catalog as last read. In memory only: the count lives here, where it is as fresh
     * as the last read, and never in `sessions.json`, where it would outlive its source.
     */
    catalogRows: CatalogSession[] = [];
    hiddenSessions: CatalogSession[] = [];
    scopeKey: string;
    store: SessionStore;
    /** Last few user turns: the one state Hermes cannot hold for us. */
    pendingUsers: PendingUserStore;

    constructor(
        private readonly historyDir: string,
        scopeKey: string,
        private readonly host: SessionsHost,
    ) {
        this.scopeKey = scopeKey;
        this.store = new SessionStore(this.historyDir, this.scopeKey);
        this.pendingUsers = new PendingUserStore(this.historyDir);
    }

    /** Load the catalog, restore the active id, and register it. Its transcript is Hermes'. */
    init(): void {
        this.loadCatalog();
        this.activeId = this.restoreActive();
        this.ensureRegistered();
    }

    private restoreActive(): string {
        const id = this.store.readActiveId();
        if (id && this.tabs.some(s => s.id === id)) {
            return id;
        }
        return Date.now().toString(36);
    }

    private saveActive(): void {
        this.store.writeActiveId(this.activeId);
    }

    /** The first user turn's opening words, or undefined while the tab has none. */
    private _tabTitle(): string | undefined {
        return this.messages.find(m => m.role === 'user')?.text.slice(0, 40);
    }

    saveCurrent(): void {
        const firstUser = this._tabTitle();
        const existing = this.tabs.find(s => s.id === this.activeId);
        if (existing) {
            existing.updatedAt = Date.now();
            // Hermes owns the title of any session it knows about: the catalog supplies it,
            // and this cache must not overwrite it with the first user message (which here is
            // usually the injected memory preamble). Only a purely local chat, which Hermes
            // has never seen, derives a title from its own text.
            if (firstUser && !existing.hermesSessionId) {
                existing.title = firstUser;
            }
        } else {
            const workspace = this.host.currentWorkspace();
            this.tabs.unshift({
                id: this.activeId,
                title: firstUser || t('newChat'),
                createdAt: parseInt(this.activeId, 36) || Date.now(),
                updatedAt: Date.now(),
                ...(workspace ? { workspace } : {}),
            });
        }
        if (this.saveCatalog()) {
            this.saveActive();
        }
        this.postList();
    }

    ensureRegistered(): void {
        const next = registerSession(this.tabs, {
            id: this.activeId,
            title: this._tabTitle() || t('newChat'),
            workspace: this.host.currentWorkspace(),
        });
        if (next === this.tabs) {
            return;
        }
        this.tabs = next;
        this.saveCatalog();
    }

    postList(): void {
        this.host.updatePanelTitle();
        this.host.post({
            type: 'sessionList',
            sessions: this.tabs,
            activeSessionId: this.activeId,
            workspaces: this.host.workspaces(),
            folders: this.host.folders(),
        });
    }

    postHidden(): void {
        this.host.post({
            type: 'hiddenSessions',
            sessions: this.hiddenSessions,
        });
    }

    /**
     * One write point for the session catalog: the same 50-record snapshot was assembled in
     * eleven places, and the store that owns this file needs a single seam to cut along.
     * Returns whether the write happened, for the one caller that does more on success.
     */
    saveCatalog(): boolean {
        const ok = this.store.writeCatalog(this.tabs);
        if (!ok) {
            this.host.log(`sessions.json write failed: ${this.store.catalogPath}`);
        }
        return ok;
    }

    private loadCatalog(): void {
        this.tabs = this.store.readCatalog();
        this.normalizeSticky();
    }

    private normalizeSticky(): void {
        this.tabs = normalizeStickyOrder(this.tabs);
    }

    /**
     * Rebuild the tab list from Hermes' catalog.
     *
     * A tab *is* an unhidden session, so the list is a projection of `sessions.hidden`
     * rather than a second store: nothing here can drift from Hermes, a close is the same
     * operation as an open with a different value, and a session created by the TUI or the
     * dashboard appears without any adoption step.
     */
    applyCatalog(rows: CatalogSession[]): void {
        this.catalogRows = rows;
        const result = applyCatalogRows({
            previous: this.tabs,
            rows,
            activeId: this.activeId,
            activeLinked: this.activeIsLinked(),
        });
        if (result.activeChanged) {
            // The tab the pane showed is gone from the catalog, so it points at the newest.
            this.activeId = result.activeId;
            this.messages = [];
        }
        this.tabs = result.sessions;
        this.hiddenSessions = result.hiddenRows;
        this.saveCatalog();
        this.postList();
        this.postHidden();
    }

    /**
     * The link, proven from the source: this tab is bound to a Hermes id, and Hermes lists it.
     *
     * The one predicate that replaces "does the local copy have content". A tab with no binding
     * is new; a tab whose id no longer appears in the catalog points at a session that is gone.
     * Neither is a fact about any message, so neither can go stale behind the transcript's back.
     */
    activeIsLinked(): boolean {
        const record = this.tabs.find(s => s.id === this.activeId);
        return !!record?.hermesSessionId && !!this.catalogRow(record.hermesSessionId);
    }

    /** The catalog's row for a Hermes session: where the count is read from. */
    catalogRow(hermesSessionId: string | undefined): CatalogSession | undefined {
        if (!hermesSessionId) {
            return undefined;
        }
        return this.catalogRows.find(row => row.sessionId === hermesSessionId);
    }

    bindProfileScope(scopeKey: string): void {
        if (scopeKey === this.scopeKey) {
            return;
        }
        this.saveCurrent();
        this.scopeKey = scopeKey;
        this.store.setScope(scopeKey);
        this.tabs = [];
        this.loadCatalog();
        this.activeId = this.restoreActive();
        this.messages = [];
        this.ensureRegistered();
        this.postList();
    }

    /** Point the pane at another tab: save the old one, and let the replay fill the new one. */
    activate(sessionId: string, options?: { skipSaveCurrent?: boolean }): void {
        this.host.log(`Switch to session: ${sessionId}`);
        if (!options?.skipSaveCurrent) {
            this.saveCurrent();
        }
        this.activeId = sessionId;
        this.messages = [];
        this.host.post({ type: 'newChat' });
        this.postList();
    }

    /** A steer is a user message the run has already taken: kept for the transcript, marked. */
    saveSteerMessage(text: string): void {
        this.messages.push({ role: 'user', text, timestamp: Date.now(), steer: true });
        this.persistMessages();
    }

    /** A forwarded draft: stored like any message, with who sent it and where it stands. */
    savePeerMessage(envelope: {
        id: string;
        forwarderProfile: string;
        forwarderHost: string;
        sourceMessageId?: string;
        forwarderRole?: 'primary' | 'secondant';
        sentBy?: string;
        peerMessages?: Array<{ text: string; sentBy?: string; sourceMessageId?: string }>;
    }, text: string, history?: HistoryRef): void {
        const record: ChatMessage = {
            role: 'peer',
            text,
            timestamp: Date.now(),
            peer: {
                envelopeId: envelope.id,
                forwarderProfile: envelope.forwarderProfile,
                forwarderHost: envelope.forwarderHost,
                sourceMessageId: envelope.sourceMessageId,
                forwarderRole: envelope.forwarderRole,
                sentBy: envelope.sentBy,
                peerMessages: envelope.peerMessages,
            },
            peerState: 'pending',
        };
        // The envelope a session-memory pick arrived with: kept so the card can redraw it after a
        // reload, and so delivering it can tell the agent which conversation the text came from.
        if (history) {
            record.history = history;
        }
        this.messages.push(record);
        this.persistMessages();
    }

    /**
     * Dismissed or expired: nothing was delivered, so the body has no place in this tab's
     * conversation. The note keeps the fact and the sender; the original text still lives in the
     * sender's own session, so nothing is lost by dropping this copy.
     *
     * No persistMessages() here on purpose: a transcript is Hermes', and a local peer card is not
     * part of it. The shortened text lives as long as this tab does — a pane re-show or a tab
     * switch inside this window shows the note, a window reload rebuilds from Hermes and the card
     * is simply gone, which is the intended end state for an undelivered forward.
     */
    shortenPeerMessage(envelopeId: string, note: string): void {
        const stored = this.messages.find(m => m.role === 'peer' && m.peer?.envelopeId === envelopeId);
        if (!stored || stored.peerState === 'delivered') {
            return;
        }
        stored.text = note;
    }

    /** Deliver or Dismiss: the first decision stands, and it survives a reload. */
    setPeerState(envelopeId: string, state: PeerState): boolean {
        const stored = this.messages.find(m => m.role === 'peer' && m.peer?.envelopeId === envelopeId);
        if (!stored || stored.peerState === state || stored.peerState !== 'pending') {
            return false;
        }
        stored.peerState = state;
        this.persistMessages();
        return true;
    }

    saveMessage(role: string, text: string, toolCallId?: string, imageRefs?: StoredImageRef[], history?: HistoryRef): void {
        const record: ChatMessage = { role, text, timestamp: Date.now(), toolCallId };
        if (imageRefs && imageRefs.length) {
            record.imageRefs = imageRefs;
        }
        if (history) {
            record.history = history;
        }
        this.messages.push(record);
        this.persistMessages();
    }

    upsertToolMessage(toolCallId: string, text: string): void {
        const stored = this.findToolMessage(toolCallId);
        if (stored) {
            if (stored.aggregatedTools?.length) {
                const entry = stored.aggregatedTools.find(t => t.toolCallId === toolCallId);
                if (entry) {
                    entry.text = text;
                }
                stored.text = rebuildAggregatedToolText(stored.aggregatedTools);
            } else {
                stored.text = text;
            }
            stored.timestamp = Date.now();
            this.persistMessages();
            return;
        }

        const last = this.messages[this.messages.length - 1];
        if (last?.role === 'tool' && canAggregateToolTexts(last.text, text)) {
            if (!last.aggregatedTools?.length) {
                last.aggregatedTools = [{
                    toolCallId: last.toolCallId || `tool_${last.timestamp}`,
                    text: last.text,
                }];
                delete last.toolCallId;
            }
            last.aggregatedTools.push({ toolCallId, text });
            last.text = rebuildAggregatedToolText(last.aggregatedTools);
            last.timestamp = Date.now();
            this.persistMessages();
            return;
        }

        this.saveMessage('tool', text, toolCallId);
    }

    private findToolMessage(toolCallId: string): ChatMessage | undefined {
        return this.messages.find(m => {
            if (m.role !== 'tool') {
                return false;
            }
            if (m.toolCallId === toolCallId) {
                return true;
            }
            return m.aggregatedTools?.some(t => t.toolCallId === toolCallId) ?? false;
        });
    }

    /**
     * The only write left: the tab index and the active id.
     *
     * It used to take `(role, text)` and append user turns to the sidecar, but no caller ever
     * passed them — so the sidecar was never written and `findUndelivered` always read nothing.
     * The append now happens where the send happens (`saveOutgoingUser`), which is the only place
     * that can tell a real send from a replayed user row.
     */
    persistMessages(): void {
        this.saveCurrent();
    }

    /**
     * A message the user actually sent — not a replay echoing one back.
     *
     * The sidecar exists to answer one question when a replay arrives: did Hermes ever receive
     * this? Only a send can answer it, so only a send writes it.
     */
    saveOutgoingUser(text: string, imageRefs?: StoredImageRef[]): void {
        this.saveMessage('user', text, undefined, imageRefs);
        this.pendingUsers.append(this.activeId, text);
    }

    private permissionBodyText(title?: string, detail?: string): string {
        const parts: string[] = [];
        if (title?.trim()) {
            parts.push(title.trim());
        }
        if (detail?.trim()) {
            parts.push(detail.trim());
        }
        return parts.join('\n\n');
    }

    savePermissionRequest(id: string, request: PermissionRequest): void {
        this.messages.push({
            role: 'permission',
            text: this.permissionBodyText(request.title, request.detail),
            timestamp: Date.now(),
            permissionId: id,
            title: request.title,
            detail: request.detail,
            options: request.options.map(o => ({
                optionId: o.optionId,
                name: o.name,
                kind: o.kind,
            })),
            resolved: false,
        });
        this.persistMessages();
    }

    resolvePermissionHistory(
        id: string,
        outcome: 'selected' | 'cancelled',
        selectedOptionId?: string,
        selectedLabel?: string
    ): void {
        const stored = this.messages.find(m => m.permissionId === id && m.role === 'permission');
        if (!stored) {
            return;
        }
        stored.resolved = true;
        stored.outcome = outcome;
        stored.selectedOptionId = selectedOptionId;
        stored.selectedLabel = selectedLabel;
        if (outcome === 'selected' && selectedLabel) {
            stored.text = `${stored.text}\n\n${t('permissionSelected', selectedLabel)}`;
        } else if (outcome === 'cancelled') {
            stored.text = `${stored.text}\n\n${t('permissionCancelled')}`;
        }
        this.persistMessages();
    }

    handleDeleteMessages(indices: unknown): void {
        if (!Array.isArray(indices) || indices.length === 0) {
            return;
        }
        const sorted = [...new Set(indices.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))]
            .sort((a, b) => b - a);
        for (const index of sorted) {
            if (index < this.messages.length) {
                this.messages.splice(index, 1);
            }
        }
        this.persistMessages();
    }

    handleReorderSessions(sessionIds: unknown): void {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return;
        }
        const next = reorderSessions(this.tabs, sessionIds);
        if (!next) {
            return;
        }
        this.tabs = next;
        this.host.log(`Reorder sessions: ${this.tabs.map(s => s.id).join(', ')}`);
        this.saveCatalog();
        this.postList();
    }

    handleToggleStickySession(sessionId: string): void {
        const next = stickSession(this.tabs, sessionId);
        if (next === this.tabs) {
            return;
        }
        this.tabs = next;
        const stickyNow = !!next.find(record => record.id === sessionId)?.sticky;
        this.host.log(`${stickyNow ? 'Sticky' : 'Drop'} session ${sessionId}`);
        this.saveCatalog();
        this.postList();
    }

    /** Move one tab to another workspace: our tag, so no catalog read can put it back. */
    setWorkspace(sessionId: string, workspace: string): void {
        const next = moveSessionToWorkspace(this.tabs, sessionId, workspace);
        if (next === this.tabs) {
            return;
        }
        this.tabs = next;
        this.host.log(`Session ${sessionId} moved to workspace ${workspace}`);
        this.saveCatalog();
        this.postList();
    }

    /** A folder is gone: every tab that was in it goes back to the plane. */
    clearFolder(folderId: string): void {
        if (!folderId) {
            return;
        }
        let changed = false;
        const next = this.tabs.map(session => {
            if (session.folder !== folderId) {
                return session;
            }
            changed = true;
            return { ...session, folder: undefined };
        });
        if (!changed) {
            return;
        }
        this.tabs = next;
        this.host.log(`Folder ${folderId} removed: its tabs are back on the plane`);
        this.saveCatalog();
    }

    /** Put one tab in a folder, or back on the plane. */
    setFolder(sessionId: string, folderId: string): void {
        const next = moveSessionToFolder(this.tabs, sessionId, folderId);
        if (next === this.tabs) {
            return;
        }
        this.tabs = next;
        this.host.log(`Session ${sessionId} -> folder ${folderId || '(none)'}`);
        this.saveCatalog();
        this.postList();
    }

    handleSessionExport(sessionId: string, action: unknown, indices?: unknown): void {
        if (action !== 'copy' && action !== 'export') {
            return;
        }
        const session = this.tabs.find(s => s.id === sessionId);
        if (!session) {
            return;
        }
        if (sessionId !== this.activeId) {
            // Only the tab on screen has a transcript in hand; Hermes owns the rest.
            this.host.log(`Export: ${sessionId} is not the open tab; nothing local to export`);
            return;
        }
        let messages = this.messages;
        if (Array.isArray(indices) && indices.length > 0) {
            const pick = new Set(
                indices.filter((index): index is number => typeof index === 'number' && index >= 0)
            );
            messages = messages.filter((_, index) => pick.has(index));
        }
        const payload = buildSessionExportPayload(session, messages, this.host.modelLabel());
        this.host.post({
            type: 'sessionExport',
            action,
            ...payload,
        });
    }
}
