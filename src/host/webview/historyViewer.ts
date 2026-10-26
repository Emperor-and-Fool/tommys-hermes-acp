/**
 * The history viewer: another session's messages, read-only, in one temporary editor tab.
 *
 * Everything it shows comes from the local copy — `SessionStore.readMessages` — never from the
 * Hermes export; the export is Phase 4's job and only runs at Attach time, for the message ids.
 *
 * Not a surface: it is absent from `Surfaces`, so broadcast chat traffic never reaches it, and it
 * has its own viewType so the chat panel's serializer (extension.ts) does not restore it after a
 * reload. One tab at most: `open()` reuses the live panel instead of creating a second one.
 */
import * as vscode from 'vscode';
import type { HistoryRef, SessionInfo, ChatMessage } from '../../shared/chat';
import type { HostToPane, PaneToHost } from '../../shared/webview';
import { anchorFor } from '../chat/historyAttach';

/** Its own viewType, deliberately not `CHAT_PANEL_VIEW_TYPE`. */
export const HISTORY_VIEWER_VIEW_TYPE = 'tommys.historyViewer';

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
    /** The local transcript of one session id. */
    readMessages(localId: string): ChatMessage[];
    /** The Hermes profile the session belongs to: the agent needs it beside the session id. */
    profile(): string;
    /** The ticks, resolved: Phase 4 stages this. */
    onPicked(pick: HistoryPick): void;
    /** The tab is gone: put the cursor back in the chat composer. */
    focusComposer(): void;
    log(line: string): void;
}

export class HistoryViewer {
    private _panel?: vscode.WebviewPanel;
    private _sessionId = '';
    private _title = '';
    private _messages: ChatMessage[] = [];

    constructor(private readonly _host: HistoryViewerHost) {}

    /** Show one session read-only, reusing the live tab when there is one. */
    open(hermesSessionId: string, title: string): void {
        const record = this._host.tabs().find(tab => tab.hermesSessionId === hermesSessionId);
        const localId = record?.id || hermesSessionId;
        // Permission cards are cards, not messages: they take no part in a history attach and
        // their groups would shift the pane's sessionIndex away from this array's indices.
        const messages = this._host.readMessages(localId).filter(message => message.role !== 'permission');
        this._sessionId = hermesSessionId;
        this._title = title;
        this._messages = messages;
        this._host.log(`History viewer: ${hermesSessionId} (local id ${localId}, ${messages.length} messages)`);

        if (this._panel) {
            this._panel.title = title;
            this._panel.reveal(vscode.ViewColumn.Active, false);
            // A panel hidden with `retainContextWhenHidden: false` loses its DOM: it reloads and
            // asks for `ready` again, which restores the fields above. A live pane gets the swap.
            this._post({ type: 'newChat' });
            this._restore();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            HISTORY_VIEWER_VIEW_TYPE,
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
                this._restore();
                break;
            case 'historyPicked':
                if (msg.sessionId !== this._sessionId) {
                    break;
                }
                this._pick(msg.indices);
                break;
            case 'historyViewerCancel':
                this._close();
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
            return;
        }
        const ref: HistoryRef = {
            sessionId: this._sessionId,
            profile: this._host.profile(),
            title: this._title,
            count: messages.length,
            messageIds: messages.map(() => null),
            anchor: anchorFor(messages),
        };
        this._close();
        this._host.onPicked({ ref, messages });
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
