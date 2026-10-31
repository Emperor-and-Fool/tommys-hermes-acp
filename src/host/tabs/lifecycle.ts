/**
 * A tab's life as Hermes knows it: the catalog read, resume and adopt, replay, switching,
 * closing and reopening, renaming, and the blank tab.
 *
 * Everything here was the provider's. The split follows one line: this file is where a tab
 * meets Hermes (sessions, history, hidden flags, titles); what a tab *is* locally — its id,
 * its transcript, its order — is Sessions, which this file is handed rather than owns.
 *
 * The replay flag and the persisted session id live here too: only these methods read them.
 * The flag guards one thing the whole file shares — a load the user asked for must not repaint
 * over a pending turn.
 */
import * as vscode from 'vscode';
import type { AcpClient, CatalogSession, ReplayMessage } from '../acp/AcpClient';
import type { AttachmentStore } from '../cache/attachments';
import { renameSession } from '../cache/catalog';
import { countsTowardMessageCount, replayCountDiffers } from '../acp/replayProgress';
import { buildReplayMessages } from '../cache/replay';
import type { Sessions } from '../cache/sessions';
import { findUndelivered, lastUserMessageText } from '../cache/undelivered';
import { t } from '../i18n';
import { hermesSessionIdFor } from './tabs';
import type { ChatSurface } from '../webview/surfaces';
import type { HostToPane } from '../../shared/webview';

/** What a tab's lifecycle needs from the panel: the connection, the tab records, and the posts. */
export interface TabLifecycleHost {
    acp(): AcpClient | undefined;
    session: Sessions;
    post(msg: HostToPane): void;
    postTo(surface: ChatSurface, msg: HostToPane): void;
    log(line: string): void;
    resolveCwd(): string;
    /** The CLI profile of the agent this pane is talking to: attachments are scoped by it. */
    profile(): string;
    attachments: AttachmentStore;
    promptSessionId(): string | undefined;
    detachActivePrompt(id: string, options?: { savePartial?: boolean }): Promise<void>;
    otherSessionIsPrompting(): boolean;
    syncModelStateForCurrentSession(): Promise<void>;
    syncPromptUiIfReturningToOwner(): void;
    snapshotModelFromProfile(): void;
    saveCatalog(): boolean;
    saveCurrent(): void;
    ensureRegistered(): void;
    postSessionList(): void;
    /** Restate the active tab's staged history pick in the pane (or that it has none). */
    postHistoryState(tabId: string): void;
    /** Forget one tab's staged pick: the tab is gone. */
    dropHistoryStage(tabId: string): void;
    /** Draw the undecided forwarded cards again: reloads and tab switches rebuild the transcript. */
    reinjectOpenPeers?: () => void;
    activate(id: string, options?: { skipSaveCurrent?: boolean; interrupt?: boolean }): void;
    workspaceState: vscode.Memento;
}

export class TabLifecycle {
    /**
     * True only while a load the user asked for (tab switch, adopt, resume) is
     * in flight; a load fired mid-send must not repaint over the pending turn.
     */
    private _renderReplayOnLoad = false;
    /** Hermes session id this workspace last had open (workspaceState-backed). */
    private _persistedHermesSessionId = '';

    constructor(private readonly _host: TabLifecycleHost) {
        this._persistedHermesSessionId = this._host.workspaceState.get<string>('hermesSessionId') || '';
    }

    async readCatalog(): Promise<CatalogSession[] | null> {
        const acp = this._host.acp();
        if (!acp) {
            return null;
        }
        try {
            return await acp.listSessionCatalog();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.log(`session/catalog failed: ${msg}`);
            return null;
        }
    }

    async syncFromHermes(cwd: string): Promise<void> {
        void cwd;
        const rows = await this.readCatalog();
        if (rows) {
            this._host.session.applyCatalog(rows);
        }
    }

    async refreshFromHermes(): Promise<void> {
        await this.syncFromHermes(this._host.resolveCwd());
        this._host.postSessionList();
    }

    async resumeOrAdopt(cwd: string): Promise<void> {
        const acp = this._host.acp();
        if (!acp) {
            return;
        }
        await this.syncFromHermes(cwd);
        const session = this._host.session;
        const tabBound = session.tabs.find(rec => rec.id === session.activeId)?.hermesSessionId;
        const remembered = tabBound || this._persistedHermesSessionId;
        // The catalog row is the link's proof: the id is bound, and Hermes still lists it. A
        // pointer at a session Hermes no longer lists is not a target — treating it as one used to
        // skip adoption and leave the throwaway session `session/new` created bound to the tab.
        const target = remembered && session.catalogRow(remembered) ? remembered : undefined;
        if (remembered && !target) {
            this._host.log(`Tab points at ${remembered}, which this profile no longer lists; adopting instead`);
        }
        // First run / unlinked tab: open the most recent Hermes session rather than
        // leaving the throwaway session `session/new` just created in front of the
        // user. This is what makes existing conversations reappear as tabs.
        if (!target && !session.activeIsLinked()) {
            const newest = session.tabs.find(rec => !!rec.hermesSessionId && !!session.catalogRow(rec.hermesSessionId));
            if (newest?.hermesSessionId) {
                session.activeId = newest.id;
                session.messages = [];
                this._host.post({ type: 'newChat' });
                if (!await this._loadForReplay(acp, newest.cwd || cwd, newest.hermesSessionId, 'Adopt')) {
                    // The tab stays empty and this pane stays unbound: binding the throwaway would
                    // present a session Hermes never had, and letting the error escape would send
                    // it to Connection's catch, which disposes the whole client.
                    this._host.postSessionList();
                    return;
                }
                this.bindHermesSessionId(newest.hermesSessionId);
                this._host.postSessionList();
                this._host.log(`Adopted most recent Hermes session ${newest.hermesSessionId}`);
                return;
            }
        }
        if (target && target !== acp.activeSessionId) {
            const targetCwd = session.tabs.find(rec => rec.hermesSessionId === target)?.cwd || cwd;
            if (await this._loadForReplay(acp, targetCwd, target, 'Resume')) {
                this.bindHermesSessionId(target);
                this._host.log(`Resumed Hermes session ${target}`);
                return;
            }
        }
        this.bindHermesSessionId(acp.activeSessionId);
    }

    /** Load one session with the replay allowed to paint; false, with a log line, when it fails. */
    private async _loadForReplay(
        acp: AcpClient,
        cwd: string,
        hermesSessionId: string,
        verb: string,
    ): Promise<boolean> {
        this._renderReplayOnLoad = true;
        try {
            await acp.loadSession(cwd, hermesSessionId);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.log(`${verb} failed for ${hermesSessionId}: ${msg}`);
            return false;
        } finally {
            this._renderReplayOnLoad = false;
        }
    }

    async resumeTabHermesSession(sessionId: string): Promise<boolean> {
        const acp = this._host.acp();
        const bound = this._host.session.tabs.find(rec => rec.id === sessionId)?.hermesSessionId;
        if (!acp || !bound) {
            return false;
        }
        // `bound === acp.activeSessionId` used to return false here — "the client is already on that
        // session". True of the client, false of the pane: the transcript is the replay, and since
        // the local mirror was removed there is nothing else to paint. Replaying again costs one
        // load; skipping it leaves a blank pane that is indistinguishable from an empty session.
        if (bound === acp.activeSessionId) {
            this._host.log(`Replaying ${bound} again — the pane holds no transcript of its own`);
        }
        try {
            const record = this._host.session.tabs.find(rec => rec.id === sessionId);
            this._renderReplayOnLoad = true;
            try {
                await acp.loadSession(record?.cwd || this._host.resolveCwd(), bound);
            } finally {
                this._renderReplayOnLoad = false;
            }
            this._host.log(`Switched Hermes session to ${bound}`);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.log(`Resume failed for ${bound}: ${msg}`);
            return false;
        }
    }

    handleHistoryReplay(hermesSessionId: string, replay: ReplayMessage[]): void {
        const record = this._host.session.tabs.find(
            rec => rec.hermesSessionId === hermesSessionId || rec.id === hermesSessionId
        );
        const localId = record?.id || hermesSessionId;
        const messages = buildReplayMessages(replay);
        if (messages.length === 0) {
            return;
        }
        // A send that died between the pane and the agent leaves a user message in the local
        // mirror that Hermes never received. Read it before the replay overwrites the file.
        const pending = this._host.session.pendingUsers.read(localId);
        const undelivered = findUndelivered(lastUserMessageText(pending.map(user => ({ role: 'user', text: user.text, timestamp: user.savedAt }))), messages);
        // Whatever the replay contains has arrived: keep only what it does not.
        this._host.session.pendingUsers.retain(
            localId,
            pending.map(user => user.text).filter(text => findUndelivered(text, messages) !== null)
        );
        // More rows than Hermes counts means the two disagree. The pending user turns explain a
        // little of it; beyond that it is a signal worth a line rather than something to hide.
        const countedRows = replay.filter(row => countsTowardMessageCount(row.role)).length;
        const sourceCount = this._host.session.catalogRow(hermesSessionId)?.messageCount ?? 0;
        if (replayCountDiffers(countedRows, sourceCount, pending.length)) {
            this._host.log(
                `Replay for ${localId} carried ${countedRows} row(s) against the catalog's ${sourceCount} — ` +
                    `Hermes' count and its replay disagree`
            );
        }
        // The replay is text-only, so refs are restored from the attachment sidecar: the agent's
        // sequence carries thought and tool records and rewrites this file, so neither position
        // nor the file itself can be trusted to still hold them.
        try {
            const used = new Set<string>();
            for (const msg of messages) {
                if (msg.role !== 'user' || (msg.imageRefs && msg.imageRefs.length)) continue;
                const refs = this._host.attachments.refsFromIndex(this._attachmentScope(localId), msg.text, used, true);
                if (refs.length) {
                    msg.imageRefs = refs;
                }
            }
        } catch { /* the transcript still restores, without the pictures */ }
        this._host.log(`Replayed ${messages.length} messages for session ${localId}`);
        if (!this._renderReplayOnLoad || this._host.session.activeId !== localId) {
            // Cached only: the user is either elsewhere or mid-send in this tab.
            this._host.postSessionList();
            return;
        }
        this._host.session.messages = messages;
        this._host.post({ type: 'newChat' });
        this._host.post({
            type: 'restoreHistory',
            messages: this._host.attachments.hydrateImages(this._attachmentScope(localId), this._host.session.messages),
            localHistoryOnly: false,
        });
        // Hermes' replay never contains a card it was never sent; the inbox still holds it.
        this._host.reinjectOpenPeers?.();
        this._host.postSessionList();
        if (undelivered) {
            this._host.log(`Undelivered message offered back to the composer: ${localId}`);
            this._host.post({ type: 'undeliveredMessage', text: undelivered });
        }
    }

    bindHermesSessionId(hermesSessionId: string): void {
        if (!hermesSessionId) {
            return;
        }
        this._persistedHermesSessionId = hermesSessionId;
        const rec = this._host.session.tabs.find(item => item.id === this._host.session.activeId);
        if (rec && rec.hermesSessionId !== hermesSessionId) {
            rec.hermesSessionId = hermesSessionId;
            this._host.saveCatalog();
        }
        void this._host.workspaceState.update('hermesSessionId', hermesSessionId);
    }

    /** The conversation a tab's attachments belong to: its Hermes id once bound, else its own. */
    private _attachmentScope(localId: string): { sessionId: string; profile: string } {
        const record = this._host.session.tabs.find(rec => rec.id === localId);
        return { sessionId: record?.hermesSessionId || localId, profile: this._host.profile() };
    }

    restoreMessages(target?: ChatSurface): void {
        if (this._host.session.messages.length === 0) {
            // Nothing to repaint, but the chip still belongs to the tab now on screen.
            this.postHistoryState();
            return;
        }
        this._host.log(`Restoring ${this._host.session.messages.length} messages`);
        const msg: HostToPane = {
            type: 'restoreHistory',
            messages: this._host.attachments.hydrateImages(
                this._attachmentScope(this._host.session.activeId),
                this._host.session.messages,
            ),
            localHistoryOnly: true,
        };
        if (target) {
            this._host.postTo(target, msg);
        } else {
            this._host.post(msg);
        }
        this.postHistoryState();
    }

    /** One place for it: every path that puts another tab on screen ends here. */
    private postHistoryState(): void {
        this._host.postHistoryState(this._host.session.activeId);
    }

    async createBlankTab(): Promise<void> {
        this._host.saveCurrent();
        this._host.session.messages = [];
        this._host.session.activeId = Date.now().toString(36);
        this._host.ensureRegistered();
        this._host.snapshotModelFromProfile();
        this._host.post({ type: 'newChat' });
        this._host.postSessionList();
        this.postHistoryState();
    }

    async endPromptBeforeSwitch(options?: { interrupt?: boolean }): Promise<boolean> {
        if (this.currentSessionIsPrompting()) {
            if (!options?.interrupt) {
                return false;
            }
            await this._host.detachActivePrompt(this._host.session.activeId, { savePartial: true });
        } else if (this._host.otherSessionIsPrompting()) {
            await this._host.detachActivePrompt(this._host.promptSessionId()!, { savePartial: true });
        }
        return true;
    }

    currentSessionIsPrompting(): boolean {
        return this._host.acp()?.status === 'prompting'
            && !!this._host.promptSessionId()
            && this._host.promptSessionId() === this._host.session.activeId;
    }

    async switchTo(
        sessionId: string,
        options?: { skipSaveCurrent?: boolean; interrupt?: boolean }
    ): Promise<void> {
        if (sessionId === this._host.session.activeId) {
            return;
        }
        if (!(await this.endPromptBeforeSwitch(options))) {
            return;
        }
        this._host.activate(sessionId, options);
        // Resumed history arrives as session/update; only fall back to the local
        // render cache when this tab has no Hermes session to replay.
        const resumed = await this.resumeTabHermesSession(sessionId);
        if (!resumed) {
            // A tab with a Hermes session that would not load must not look like an empty
            // conversation: say so, and leave the transcript alone.
            const bound = this._host.session.tabs.find(rec => rec.id === sessionId)?.hermesSessionId;
            if (bound) {
                const text = t('sessionReplayFailed');
                this._host.log(`No transcript for ${bound}: the load was skipped or failed`);
                this._host.post({ type: 'addMessage', role: 'assistant', text, sessionId });
            } else {
                this.restoreMessages();
            }
        } else {
            // The replay repaints this tab when it arrives; the chip is this tab's already.
            this.postHistoryState();
        }
        // A forward is addressed to the agent, not to a conversation: whatever is still undecided
        // belongs in the tab now on screen.
        this._host.reinjectOpenPeers?.();
        await this._host.syncModelStateForCurrentSession();
        this._host.syncPromptUiIfReturningToOwner();
    }

    async closeSessions(sessionId: string, mode: unknown): Promise<void> {
        if (typeof mode !== 'string' || !this._host.session.tabs.length) {
            return;
        }
        const ids = this._host.session.tabs.map(s => s.id);
        const idx = ids.indexOf(sessionId);
        let toHide: string[] = [];
        switch (mode) {
            case 'self':
                toHide = idx === -1 ? [] : [sessionId];
                break;
            case 'others':
                toHide = idx === -1 ? [] : ids.filter(id => id !== sessionId);
                break;
            case 'left':
                toHide = idx > 0 ? ids.slice(0, idx) : [];
                break;
            case 'right':
                toHide = idx !== -1 && idx < ids.length - 1 ? ids.slice(idx + 1) : [];
                break;
            case 'all':
                toHide = [...ids];
                break;
            default:
                return;
        }
        if (!toHide.length) {
            return;
        }
        await this.hideSessions(toHide, mode === 'all' ? undefined : sessionId);
    }

    async hideSessions(toHide: string[], focusSessionId?: string): Promise<void> {
        const acp = this._host.acp();
        const tabs = this._host.session.tabs;
        for (const id of toHide) {
            // A closed tab's staged pick has nowhere to go; it must not outlive the tab.
            this._host.dropHistoryStage(id);
            // The strip's id is only the tab's until the catalog lists it. A tab that was never
            // bound has no Hermes session to hide, so the local removal is the whole close.
            const bound = tabs.find(tab => tab.id === id)?.hermesSessionId;
            if (acp && bound) {
                try {
                    await acp.setSessionHidden(hermesSessionIdFor(tabs, id), true);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this._host.log(`Hide failed for ${bound}: ${msg}`);
                }
            }
        }
        this._host.log(`Closed ${toHide.length} tab(s)`);
        const hidingActive = toHide.includes(this._host.session.activeId);
        const remaining = this._host.session.tabs.filter(rec => !toHide.includes(rec.id));
        if (hidingActive) {
            const nextId = focusSessionId && remaining.some(rec => rec.id === focusSessionId)
                ? focusSessionId
                : remaining[0]?.id;
            if (nextId) {
                await this.switchTo(nextId, { skipSaveCurrent: true });
            } else {
                this._host.session.messages = [];
                this._host.post({ type: 'noActiveTab' });
                this.postHistoryState();
            }
        }
        await this.refreshFromHermes();
    }

    async openTab(sessionId?: string): Promise<void> {
        if (!sessionId) {
            await this.createBlankTab();
            return;
        }
        if (!this._host.session.tabs.some(rec => rec.id === sessionId)) {
            const acp = this._host.acp();
            if (acp) {
                try {
                    await acp.setSessionHidden(sessionId, false);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this._host.log(`Unhide failed for ${sessionId}: ${msg}`);
                    return;
                }
            }
            this._host.log(`Opened closed session ${sessionId}`);
            await this.refreshFromHermes();
        }
        await this.switchTo(sessionId);
    }

    async renameTab(sessionId: unknown, rawTitle: unknown): Promise<void> {
        if (typeof sessionId !== 'string' || !sessionId) {
            return;
        }
        const acp = this._host.acp();
        if (!acp) {
            this._host.log(`Rename needs a live connection (${sessionId})`);
            return;
        }
        // The strip's id is only the tab's: an adopted tab carries a local id, and Hermes would
        // answer "unknown session" for it.
        const hermesSessionId = hermesSessionIdFor(this._host.session.tabs, sessionId);
        const outcome = await renameSession({
            setTitle: (id, title) => acp.setSessionTitle(id, title),
            refreshCatalog: () => this.refreshFromHermes(),
            log: line => this._host.log(line),
        }, hermesSessionId, rawTitle);
        if (outcome.ok) {
            this._host.log(`Renamed ${hermesSessionId} to "${outcome.title}"`);
            return;
        }
        const detail = outcome.message ? ` — ${outcome.message}` : '';
        this._host.log(`Rename refused for ${hermesSessionId}: ${outcome.reason}${detail}`);
    }
}
