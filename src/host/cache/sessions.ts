import * as fs from 'fs';
import type { ChatMessage, HistoryRef, PeerState, SessionInfo, StoredImageRef } from '../../shared/chat';
import type { HostToPane } from '../../shared/webview';
import type { CatalogSession, PermissionRequest } from '../acp/AcpClient';
import { SessionStore } from './sessionStore';
import { applyCatalogRows } from './catalog';
import {
    backfillAgentEngaged,
    markAgentEngaged,
    normalizePinnedOrder,
    pinSession,
    registerSession,
    reorderSessions,
} from '../tabs/tabs';
import { canAggregateToolTexts, rebuildAggregatedToolText } from '../chat/toolAggregate';
import { buildSessionExportPayload } from '../chat/sessionExport';
import { t } from '../i18n';

/** What the sessions state needs from the provider: the pane, the log, the title, the model label. */
export interface SessionsHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    updatePanelTitle(): void;
    modelLabel(): string | undefined;
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
    hiddenSessions: CatalogSession[] = [];
    scopeKey: string;
    store: SessionStore;

    constructor(
        private readonly historyDir: string,
        scopeKey: string,
        private readonly host: SessionsHost,
    ) {
        this.scopeKey = scopeKey;
        this.store = new SessionStore(this.historyDir, this.scopeKey);
    }

    /** Load the catalog, restore the active id, register it, then load its transcript. */
    init(): void {
        this.loadCatalog();
        this.activeId = this.restoreActive();
        this.ensureRegistered();
        this.loadHistory();
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

    msgPath(sid: string): string {
        return this.store.msgPath(sid);
    }

    loadHistory(): void {
        const messages = this.store.readMessages(this.activeId);
        if (messages.length) {
            this.messages = messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            this.host.log(`Loaded ${this.messages.length} messages from history`);
            return;
        }
        this.messages = [];
    }

    saveCurrent(): void {
        const firstUser = this.messages.find(m => m.role === 'user')?.text.slice(0, 40);
        const existing = this.tabs.find(s => s.id === this.activeId);
        if (existing) {
            existing.updatedAt = Date.now();
            existing.messageCount = this.messages.length;
            // Hermes owns the title of any session it knows about: the catalog supplies it,
            // and this cache must not overwrite it with the first user message (which here is
            // usually the injected memory preamble). Only a purely local chat, which Hermes
            // has never seen, derives a title from its own text.
            if (firstUser && !existing.hermesSessionId) {
                existing.title = firstUser;
            }
        } else {
            this.tabs.unshift({
                id: this.activeId,
                title: firstUser || t('newChat'),
                createdAt: parseInt(this.activeId, 36) || Date.now(),
                updatedAt: Date.now(),
                messageCount: this.messages.length,
            });
        }
        try {
            if (this.saveCatalog()) {
                this.saveActive();
            }
        } catch { /* non-critical */ }
        this.postList();
    }

    ensureRegistered(): void {
        const firstUser = this.messages.find(m => m.role === 'user')?.text.slice(0, 40);
        const next = registerSession(this.tabs, {
            id: this.activeId,
            title: firstUser || t('newChat'),
            messageCount: this.messages.length,
        });
        if (next === this.tabs) {
            return;
        }
        this.tabs = next;
        try {
            this.saveCatalog();
        } catch { /* non-critical */ }
    }

    postList(): void {
        this.host.updatePanelTitle();
        this.host.post({
            type: 'sessionList',
            sessions: this.tabs,
            activeSessionId: this.activeId,
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
        return this.store.writeCatalog(this.tabs);
    }

    private loadCatalog(): void {
        this.tabs = this.store.readCatalog();
        for (const session of this.tabs) {
            this.backfillEngaged(session);
        }
        this.normalizePinned();
    }

    private normalizePinned(): void {
        this.tabs = normalizePinnedOrder(this.tabs);
    }

    private backfillEngaged(session: SessionInfo): void {
        if (session.agentEngaged !== undefined) {
            return;
        }
        try {
            // The transcript is the only evidence of whether the agent ever answered here.
            backfillAgentEngaged(session, this.store.readMessages(session.id));
        } catch {
            session.agentEngaged = false;
        }
    }

    markEngaged(): void {
        if (!markAgentEngaged(this.tabs, this.activeId)) {
            return;
        }
        try {
            this.saveCatalog();
        } catch { /* non-critical */ }
        this.postList();
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
        const result = applyCatalogRows({
            previous: this.tabs,
            rows,
            activeId: this.activeId,
            activeHasMessages: this.messages.length > 0,
        });
        if (result.activeChanged) {
            // The tab the pane showed is gone from the catalog, so it points at the newest.
            this.activeId = result.activeId;
            this.messages = [];
        }
        this.tabs = result.sessions;
        this.hiddenSessions = result.hiddenRows;
        try {
            this.saveCatalog();
        } catch { /* non-critical */ }
        this.postList();
        this.postHidden();
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
        this.loadHistory();
        this.ensureRegistered();
        this.postList();
    }

    /** Point the pane at another tab: save the old one, load the new one's transcript. */
    activate(sessionId: string, options?: { skipSaveCurrent?: boolean }): void {
        this.host.log(`Switch to session: ${sessionId}`);
        if (!options?.skipSaveCurrent) {
            this.saveCurrent();
        }
        this.activeId = sessionId;
        this.messages = [];
        this.loadHistory();
        this.host.post({ type: 'newChat' });
        this.postList();
    }

    // NOTE: duplicates store.readMessages + sort — left in place deliberately (see Part A notes).
    private loadFromDisk(sessionId: string): ChatMessage[] {
        try {
            const p = this.msgPath(sessionId);
            if (!fs.existsSync(p)) {
                return [];
            }
            const messages: ChatMessage[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
            return messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } catch {
            return [];
        }
    }

    /** A steer is a user message the run has already taken: kept for the transcript, marked. */
    saveSteerMessage(text: string): void {
        this.messages.push({ role: 'user', text, timestamp: Date.now(), steer: true });
        this.persistMessages();
    }

    /** A forwarded draft: stored like any message, with who sent it and where it stands. */
    savePeerMessage(envelope: {
        id: string;
        fromProfile: string;
        fromHost: string;
        sourceMessageId?: string;
        senderRole?: 'primary' | 'secondant';
    }, text: string): void {
        const record: ChatMessage = {
            role: 'peer',
            text,
            timestamp: Date.now(),
            peer: {
                envelopeId: envelope.id,
                fromProfile: envelope.fromProfile,
                fromHost: envelope.fromHost,
                sourceMessageId: envelope.sourceMessageId,
                senderRole: envelope.senderRole,
            },
            peerState: 'pending',
        };
        this.messages.push(record);
        this.persistMessages();
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

    persistMessages(): void {
        if (this.store.writeMessages(this.activeId, this.messages)) {
            this.saveCurrent();
        }
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
        this.saveCurrent();
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
        try {
            this.saveCatalog();
        } catch { /* non-critical */ }
        this.postList();
    }

    handleTogglePinSession(sessionId: string): void {
        const next = pinSession(this.tabs, sessionId);
        if (next === this.tabs) {
            return;
        }
        this.tabs = next;
        const pinnedNow = !!next.find(record => record.id === sessionId)?.pinned;
        this.host.log(`${pinnedNow ? 'Pin' : 'Unpin'} session ${sessionId}`);
        try {
            this.saveCatalog();
        } catch { /* non-critical */ }
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
        let messages = sessionId === this.activeId
            ? this.messages
            : this.loadFromDisk(sessionId);
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
