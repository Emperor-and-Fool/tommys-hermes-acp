/**
 * The renderers of the chat: the side bar view, the editor panel, or both at once.
 *
 * Everything here was the provider's: the surface list, which role each renderer plays, the
 * editor/rail mode, the panel's lifecycle and the fan-out every post goes through. Moved
 * unchanged. The provider keeps a one-line `_postMessage` delegate onto `post()`, so there is
 * still exactly one way to reach the pane and none of its ~50 call sites had to move.
 *
 * `SurfacesHost` is a bag of functions rather than a reference to the provider, the same shape
 * as `PromptHost`, `DetectionHost` and `ModelHost`.
 */
import * as vscode from 'vscode';
import type { HostToPane } from '../../shared/webview';
import { identity, settingsSection } from '../../shared/extensionId';

/** Webview panel id; the serializer re-creates it after a window reload. */
export function chatPanelViewType(): string {
    return identity().chatPanelType;
}

/**
 * Which renderer of the pane this webview is. `viewer` never enters the surface list: it is the
 * read-only history viewer's own editor tab, and no chat traffic is fanned out to it.
 */
export type SurfaceRole = 'chat' | 'rail' | 'viewer';

/** One renderer of the chat: the side bar view or the single editor panel. */
export interface ChatSurface {
    webview: vscode.Webview;
    role: SurfaceRole;
    view?: vscode.WebviewView;
    panel?: vscode.WebviewPanel;
}

/** What asked for the rail. Logged with the branch it took: the same call can read differently. */
export type RevealTrigger = 'panel:active' | 'openChat' | 'sendSelection' | 'switchSession';

/** What the host supplies: the six provider concerns a surface cannot own. */
export interface SurfacesHost {
    /** The pane's HTML, with its resource URIs resolved against this webview. */
    html(webview: vscode.Webview): string;
    /** Bind the message router to one renderer. */
    wire(webview: vscode.Webview, surface: ChatSurface): void;
    /** The open tab's name, for the editor tab's title. */
    activeTabTitle(): string;
    /** A view was resolved: pick up the locale. */
    onViewResolved(): void;
    /** A view became visible: refresh the locale and connect when idle. */
    onViewVisible(): void;
    localResourceRoots(): vscode.Uri[];
    log(line: string): void;
}

export class Surfaces {
    private _view?: vscode.WebviewView;
    private _list: ChatSurface[] = [];
    private _mode: 'sidebar' | 'editor' = 'sidebar';
    private _panel?: vscode.WebviewPanel;

    constructor(private _host: SurfacesHost) {
        this._mode = this.readMode();
    }

    // Read access for the provider. Every condition stays at its call site; nothing here
    // merges two of them into a new method.
    get view(): vscode.WebviewView | undefined {
        return this._view;
    }

    get list(): ChatSurface[] {
        return this._list;
    }

    get mode(): 'sidebar' | 'editor' {
        return this._mode;
    }

    get hasPanel(): boolean {
        return !!this._panel;
    }

    get hasViewSurface(): boolean {
        return this._list.some(surface => !!surface.view);
    }

    /**
     * Whether the rail is on screen: the side panel, with the conversation in the editor.
     *
     * Only the rail opens the permission-root row by itself, so this is the one question the row
     * asks before spending a new folder's welcome.
     */
    get railVisible(): boolean {
        return this._list.some(surface => surface.role === 'rail' && surface.view?.visible === true);
    }

    /** The webview the plugin icon is read from: whichever renderer exists. */
    get iconWebview(): vscode.Webview | undefined {
        return this._list[0]?.webview ?? this._view?.webview;
    }

    /** Forget the view: it is gone (dispose) and must not be posted to again. */
    detachView(): void {
        this._view = undefined;
    }

    readMode(): 'sidebar' | 'editor' {
        return vscode.workspace.getConfiguration(settingsSection()).get<string>('chatSurface') === 'editor'
            ? 'editor'
            : 'sidebar';
    }

    /** The side bar view: registered by VS Code, so its listeners' order is the contract. */
    resolveView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        const surface = this.addSurface(webviewView.webview, 'view', webviewView);
        webviewView.onDidDispose(() => {
            this.removeSurface(surface);
            if (this._view === webviewView) {
                this._view = undefined;
            }
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: this._host.localResourceRoots()
        };

        webviewView.webview.html = this._host.html(webviewView.webview);
        this._host.onViewResolved();

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._host.onViewVisible();
            }
        });

        this._host.wire(webviewView.webview, surface);
    }

    /** "Move Chat to Editor" / "Move Chat to Sidebar". */
    toggle(): void {
        this.setMode(this._mode === 'editor' ? 'sidebar' : 'editor');
    }

    private addSurface(
        webview: vscode.Webview,
        kind: 'view' | 'panel',
        host: vscode.WebviewView | vscode.WebviewPanel
    ): ChatSurface {
        const isView = kind === 'view';
        const role: SurfaceRole = isView && this._mode === 'editor' ? 'rail' : 'chat';
        const surface: ChatSurface = isView
            ? { webview, role, view: host as vscode.WebviewView }
            : { webview, role, panel: host as vscode.WebviewPanel };
        this._list.push(surface);
        this._host.log(`Surface added (${kind}/${role}, ${this._list.length} live)`);
        return surface;
    }

    private removeSurface(surface: ChatSurface): void {
        const index = this._list.indexOf(surface);
        if (index >= 0) {
            this._list.splice(index, 1);
        }
        this._host.log(`Surface removed (${this._list.length} live)`);
    }

    postRole(surface: ChatSurface): void {
        // The panel is the conversation only: the rail already lists the chats.
        void surface.webview.postMessage({
            type: 'surfaceRole',
            role: surface.role,
            hideTabs: !!surface.panel,
            bodyRole: identity().role,
        });
    }

    postTo(surface: ChatSurface, msg: HostToPane): void {
        void surface.webview.postMessage(msg);
    }

    /**
     * Send to the renderers of one role, and to nobody else.
     *
     * A message that opens something must not fan out: the surface the user is looking at would
     * open it behind their back. When no surface of that role is live, the message is dropped —
     * `republish()` is how a surface that appears later hears it.
     */
    postToRole(role: SurfaceRole, msg: HostToPane): boolean {
        let sent = false;
        for (const surface of this._list) {
            if (surface.role !== role) {
                continue;
            }
            void surface.webview.postMessage(msg);
            sent = true;
        }
        return sent;
    }

    /** Fan out to every renderer: the side bar view and/or the chat panel. */
    post(msg: HostToPane): void {
        if (this._list.length === 0) {
            this._view?.webview.postMessage(msg);
            return;
        }
        for (const surface of this._list) {
            void surface.webview.postMessage(msg);
        }
    }

    private setMode(mode: 'sidebar' | 'editor'): void {
        this._mode = mode;
        this._host.log(`Chat surface: ${mode}`);
        void vscode.workspace
            .getConfiguration(settingsSection())
            .update('chatSurface', mode, vscode.ConfigurationTarget.Global);
        for (const surface of this._list) {
            if (surface.view) {
                surface.role = mode === 'editor' ? 'rail' : 'chat';
                this.postRole(surface);
            }
        }
        if (mode === 'editor') {
            this.openPanel();
        } else {
            this._panel?.dispose();
        }
    }

    /** Reveal the chat panel, creating it when there is none. */
    openPanel(): void {
        const existing = this._panel ?? this._list.find(surface => !!surface.panel)?.panel;
        if (existing) {
            this._panel = existing;
            existing.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            chatPanelViewType(),
            this._host.activeTabTitle(),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true,
                localResourceRoots: this._host.localResourceRoots(),
            }
        );
        this._panel = panel;
        this.wirePanel(panel);
    }

    private wirePanel(panel: vscode.WebviewPanel): void {
        const livePanel = this._list.find(surface => !!surface.panel);
        if (livePanel) {
            this._host.log('Panel already wired; ignoring the duplicate');
            this._panel = livePanel.panel;
            return;
        }
        const surface = this.addSurface(panel.webview, 'panel', panel);
        panel.webview.options = { enableScripts: true, localResourceRoots: this._host.localResourceRoots() };
        panel.webview.html = this._host.html(panel.webview);
        this._host.wire(panel.webview, surface);
        panel.onDidDispose(() => {
            this.removeSurface(surface);
            if (this._panel === panel) {
                this._panel = undefined;
            }
        });
        // The conversation is on screen in an editor tab: what is missing beside it is the list
        // of chats, so the rail follows the panel into view.
        panel.onDidChangeViewState(() => {
            this._host.log(`Chat panel view state: active=${panel.active}, visible=${panel.visible}`);
            if (panel.active) {
                this.revealRail('panel:active');
            }
        });
        this.postRole(surface);
    }

    /** Called by the panel serializer so the tab comes back after a reload. */
    restorePanel(panel: vscode.WebviewPanel): void {
        this._host.log('Serializer restored the chat panel');
        this._mode = 'editor';
        this._panel = panel;
        this.wirePanel(panel);
    }

    /** Keep the editor tab's title on the open tab. */
    updatePanelTitle(): void {
        if (!this._panel) {
            return;
        }
        try {
            this._panel.title = this._host.activeTabTitle();
        } catch { /* panel already disposed */ }
    }

    /**
     * Show our side panel, unless the user is already looking at it.
     *
     * Three intents reach it: a command asking for the chat, our editor panel becoming the active
     * tab, and a session tab clicked inside the panel — in every case the rail is where the other
     * chats are.
     *
     * Documented API first: `WebviewView.show(true)` reveals our own view and keeps the focus in
     * the editor (the typings: "When true the view will not take focus"). The container command
     * `workbench.view.extension.<id>` is used only when no view is in hand — it is a workbench
     * internal, and it opens the whole container, which is what we want then and nothing else.
     *
     * One log line per branch, with the trigger: a guard that skips and a command VS Code ignores
     * look identical from the pane, and the reason both panes are told apart here is that the
     * same branch can behave differently on the primary and the secondant.
     */
    revealRail(trigger: RevealTrigger): void {
        const where = `${identity().role}, ${trigger}`;
        if (this._view?.visible) {
            this._host.log(`Reveal rail: already visible (${where})`);
            return;
        }
        if (this._view) {
            this._host.log(`Reveal rail: show(preserveFocus) (${where})`);
            this._view.show(true);
            return;
        }
        this._host.log(`Reveal rail: open container (view not resolved) (${where})`);
        void vscode.commands.executeCommand(`workbench.view.extension.${identity().sidebarId}`);
    }

    /**
     * The tab commands, with one addition: picking a session tab shows the rail.
     *
     * The message arrives as a tab command, and what the rail lists is a fact about the surfaces,
     * so the wrapping lives here; the router host keeps one member, as it did (R2).
     */
    tabCommands<T extends { switchSession(sessionId: string, interrupt: boolean): void }>(commands: T): T {
        const wrapped: T = {
            ...commands,
            switchSession: (sessionId: string, interrupt: boolean) => {
                this.revealRail('switchSession');
                commands.switchSession(sessionId, interrupt);
            },
        };
        return wrapped;
    }
}
