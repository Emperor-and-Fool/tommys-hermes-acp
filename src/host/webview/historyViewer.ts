/**
 * The history viewer: another session's messages, read-only, in one temporary editor tab.
 *
 * Everything it shows is fetched from Hermes' own export, uncached — including a session this
 * pane still has a tab for, so the viewer is a lens on the source rather than a second copy of
 * the transcript. The export is also where Attach gets its message ids.
 *
 * Not a surface: it is absent from `Surfaces`, so broadcast chat traffic never reaches it, and it
 * has its own viewType so the chat panel's serializer (extension.ts) does not restore it after a
 * reload. One tab at most: `open()` reuses the live panel instead of creating a second one.
 */
import * as vscode from 'vscode';
import { identity } from '../../shared/extensionId';
import type { HistoryRef, SessionInfo, ChatMessage } from '../../shared/chat';
import type { HostToPane, PaneToHost } from '../../shared/webview';
import { anchorFor } from '../chat/historyAttach';

/** Its own viewType, deliberately not `chatPanelViewType()`. */
export function historyViewerViewType(): string {
    return identity().historyViewerType;
}

/** What one pick carries, as the viewer hands it on. */
export interface HistoryPick {
    ref: HistoryRef;
    messages: ChatMessage[];
}

/** What the viewer needs from the provider: local reads, the shared page, and the way back. */
export interface HistoryViewerHost {
    /** The pane's HTML, resolved against this webview. */
    html(webview: vscode.Webview): string;
    localResourceRoots(): vscode.Uri[];
    /** The tab list: how a Hermes id finds its local transcript. */
    tabs(): SessionInfo[];
    /** The Hermes profile the session belongs to: the agent needs it beside the session id. */
    profile(): string;
    /**
     * The transcript of a session this pane has no tab for: read from Hermes, never cached.
     * Throws when it could not be read; an empty list means Hermes had nothing to send.
     */
    loadRemote(hermesSessionId: string, profile: string): Promise<ChatMessage[]>;
    /** The sibling pane as the host knows it: the viewer needs it to show a forward button. */
    otherPane(): { live: boolean; profile: string };
    /** The ticked messages, handed to the host to stage in this tab's composer. */
    onPicked(pick: HistoryPick): void;
    /** The same ticks, sent to the sibling pane instead of into this composer. */
    onForwarded(pick: HistoryPick): void;
    /** The tab is gone: put the cursor back in the chat composer. */
    focusComposer(): void;
    log(line: string): void;
}

export class HistoryViewer {
    private _panel: vscode.WebviewPanel | undefined;
    private _sessionId = '';
    private _title = '';
    private _messages: ChatMessage[] = [];
    /** What became of the fetch: kept because the page can be ready after it resolved. */
    private _outcome: 'loading' | 'loaded' | 'empty' | 'failed' = 'loading';
    private _failureReason: string | undefined;

    constructor(private readonly _host: HistoryViewerHost) {}

    /**
     * Show one session read-only, reusing the live tab when there is one.
     *
     * Two sources, one dispatch: a session this pane has a tab for is read from its working
     * copy, instantly; a session with no tab (a closed one, or one Hermes knows and this pane
     * never opened) is fetched from Hermes and never cached. `hidden` and `no local cache` are
     * the same state, so a fetch must not create one.
     */
    open(hermesSessionId: string, title: string): void {
        const record = this._host.tabs().find(tab => tab.hermesSessionId === hermesSessionId);
        this._sessionId = hermesSessionId;
        this._title = title;

        this._messages = [];
        this._host.log(
            `History viewer: ${hermesSessionId}${record ? ` (live tab ${record.id})` : ''}; asking Hermes`
        );

        if (this._panel) {
            this._panel.title = title;
            this._panel.reveal(vscode.ViewColumn.Active, false);
            // A panel hidden with `retainContextWhenHidden: false` loses its DOM: it reloads and
            // asks for `ready` again, which restores the fields above. A live pane gets the swap.
            this._post({ type: 'newChat' });
            this._restore();
            void this._fetch();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            historyViewerViewType(),
            title,
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: this._host.localResourceRoots(),
            }
        );
        this._panel = panel;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: this._host.localResourceRoots(),
        };
        panel.webview.html = this._host.html(panel.webview);
        panel.webview.onDidReceiveMessage((message) => this._onMessage(message as PaneToHost));
        panel.onDidDispose(() => {
            if (this._panel === panel) {
                this._panel = undefined;
            }
        });
        void this._fetch();
    }

    /**
     * The fetch is outside the panel's lifetime: it may finish after the tab is gone. Its outcome is
     * kept, not just posted: the pane's `ready` can arrive after the fetch resolved, and a message
     * sent before the page listens is a message the user never sees.
     */
    private async _fetch(): Promise<void> {
        const sessionId = this._sessionId;
        this._outcome = 'loading';
        this._failureReason = undefined;
        let messages: ChatMessage[];
        try {
            messages = await this._host.loadRemote(sessionId, this._host.profile());
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            if (this._panel === undefined || this._sessionId !== sessionId) {
                return;
            }
            this._outcome = 'failed';
            this._failureReason = reason;
            this._host.log(`History viewer: fetch failed for ${sessionId}: ${reason}`);
            this._post({ type: 'historyFetchFailed', reason });
            return;
        }
        if (this._panel === undefined || this._sessionId !== sessionId) {
            return;
        }
        this._messages = messages.filter(message => message.role !== 'permission');
        this._outcome = this._messages.length ? 'loaded' : 'empty';
        this._host.log(`History viewer: fetched ${this._messages.length} message(s) for ${sessionId}`);
        // The panel may have drawn its loading block already; swap the transcript in.
        this._post({ type: 'newChat' });
        this._restore();
        if (this._outcome === 'empty') {
            this._post({ type: 'historyFetchEmpty' });
        }
    }

    /** Restate an outcome the page may have missed by not being ready yet. */
    private _replayOutcome(): void {
        if (this._outcome === 'failed') {
            this._post({ type: 'historyFetchFailed', reason: this._failureReason });
        } else if (this._outcome === 'empty') {
            this._post({ type: 'historyFetchEmpty' });
        }
    }

    /** A message meant for every pane: this panel is one too, and its forward button says who. */
    postToPanel(msg: HostToPane): void {
        this._post(msg);
    }

    /** The extension is going away: the tab goes with it. */
    dispose(): void {
        this._panel?.dispose();
        this._panel = undefined;
    }

    private _onMessage(msg: PaneToHost): void {
        switch (msg.type) {
            case 'ready':
                this._post({ type: 'surfaceRole', role: 'viewer', hideTabs: true });
                // Presence is posted on change, and this panel is usually created after the last
                // change: without restating it here the forward button stays hidden for good.
                const other = this._host.otherPane();
                this._post({ type: 'setOtherPaneLive', live: other.live, profile: other.profile });
                this._restore();
                this._replayOutcome();
                break;
            case 'historyPicked':
                if (msg.sessionId !== this._sessionId) {
                    break;
                }
                this._pick(msg.indices);
                break;
            case 'historyForwarded':
                if (msg.sessionId !== this._sessionId) {
                    break;
                }
                this._forward(msg.indices);
                break;
            case 'historyViewerCancel':
                this._close();
                break;
            case 'reloadHistoryViewer':
                // The pane rebuilds the transcript from scratch, which is what applies a changed
                // role filter to cards that were created before it changed.
                this._restore();
                break;
            case 'webviewLog':
                this._host.log(msg.line);
                break;
            default:
                // Every other message belongs to a chat surface; this tab is not one.
                break;
        }
    }

    /** Resolve the pane's ticks against the transcript this tab sent, and hand them on. */
    private _pick(indices: number[]): void {
        const pick = this._resolve(indices);
        if (!pick) {
            return;
        }
        this._close();
        this._host.onPicked(pick);
    }

    /**
     * The same resolution, sent to the sibling pane: one card there, envelope included.
     *
     * The panel stays open. Sending is rarely a one-off — the user is reading a conversation and
     * picking what the other agent should see — so closing on the first send turns every further
     * pick into a reopen. Cancel is the way out, and it is right there.
     */
    private _forward(indices: number[]): void {
        const pick = this._resolve(indices);
        if (!pick) {
            return;
        }
        this._host.onForwarded(pick);
    }

    /** Ticked indices → the messages they name and the ref that describes the slice. */
    private _resolve(indices: number[]): HistoryPick | null {
        const seen = new Set<number>();
        const messages: ChatMessage[] = [];
        for (const index of indices) {
            if (!Number.isInteger(index) || index < 0 || index >= this._messages.length || seen.has(index)) {
                continue;
            }
            seen.add(index);
            messages.push(this._messages[index]);
        }
        if (messages.length === 0) {
            this._host.log('History viewer: pick with no resolvable message');
            return null;
        }
        const ref: HistoryRef = {
            sessionId: this._sessionId,
            profile: this._host.profile(),
            title: this._title,
            count: messages.length,
            messageIds: messages.map(() => null),
            anchor: anchorFor(messages),
        };
        return { ref, messages };
    }

    /** Close the tab and put the cursor back where the attach will land. */
    private _close(): void {
        this._panel?.dispose();
        this._panel = undefined;
        this._host.focusComposer();
    }

    private _restore(): void {
        this._post({
            type: 'restoreHistory',
            messages: this._messages,
            localHistoryOnly: false,
            sessionId: this._sessionId,
        });
    }

    private _post(msg: HostToPane): void {
        void this._panel?.webview.postMessage(msg);
    }
}
