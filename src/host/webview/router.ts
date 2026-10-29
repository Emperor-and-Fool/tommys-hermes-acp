/**
 * The webview → host message contract, in one place.
 *
 * One switch, the same for the side bar view and the editor panel. Every branch is a named
 * call on the host, so the message names read as a list of capabilities and nothing in this
 * file knows how any of them is carried out.
 *
 * The messages are still `any`-shaped: the pane is plain JS and nothing here validates it.
 * Typing the contract is its own piece of work — this file is where that type will land.
 */
import type { EnvironmentDetection } from '../environment/detection';
import type { PaneToHost, ApprovalMode } from '../../shared/webview';
import type { HistoryRef } from '../../shared/chat';

/** What the router may call. One function per capability the pane can ask for. */
export interface RouterHost {
    log(line: string): void;
    openExternal(url: string): void;

    /** The pane is brand new (container move, view re-show): replay the live state. */
    ready(): void;

    enqueueChatOp(op: () => Promise<void>): void;
    handleUserMessage(text: string, images: unknown): Promise<void>;
    handleCancel(): void;
    /** Text aimed at the running turn instead of at a new one. */
    handleSteer(text: string): void;
    handleOpenFile(path: string): Promise<void>;
    handleListFiles(query: string, requestId: string): Promise<void>;
    handlePreviewFile(path: string, requestId: string): Promise<void>;

    postHiddenSessions(): void;
    handleOpenTab(sessionId?: string): Promise<void>;
    handleReorderSessions(ids: unknown): void;
    handleCloseSessions(sessionId: string, mode: unknown): Promise<void>;
    handleRenameSession(sessionId: unknown, title: unknown): Promise<void>;
    handleTogglePinSession(sessionId: string): void;
    handleSessionExport(sessionId: string, action: unknown, indices?: unknown): void;
    handleSwitchAgent(name: string): void;
    handleSwitchSession(sessionId: string, interrupt: boolean): void;

    switchModel(configId: string, valueId: string): Promise<void>;
    syncModels(): Promise<void>;
    postProfileList(): void;
    /** Trade a message with the sibling pane through the shared mailbox. */
    forwardMessage(text: string, sourceMessageId?: string, history?: HistoryRef): void;
    /** The two decisions a peer card offers. */
    deliverPeer(envelopeId: string): void;
    dismissPeer(envelopeId: string): void;
    /** The same pair for every pending peer card in the tab, as one action. */
    deliverAllPeers(): void;
    dismissAllPeers(): void;

    retry(): Promise<void>;
    handlePermissionResponse(id: string, optionId: string | null): void;
    /** Write Hermes' approvals.mode for the active profile. */
    setApprovalMode(mode: ApprovalMode): Promise<void>;
    handleInsertEditor(text: string): Promise<void>;
    handleDeleteMessages(indices: unknown): void;
    /** The session-memory dropdown: the viewer tab, and the chip's X. */
    openHistoryViewer(sessionId: string, title: string): void;
    clearHistoryStaged(): void;

    /** The environment-detection surface, addressed directly: it is its own module. */
    detection(): EnvironmentDetection;
}

/** Dispatch one message from the pane. Unknown types are ignored, as they always were. */
export function handleWebviewMessage(message: PaneToHost, host: RouterHost): void {
    switch (message?.type) {
        case 'sendMessage':
            host.enqueueChatOp(() => host.handleUserMessage(message.text, message.images));
            break;
        case 'cancel':
            // Cancel must not wait behind an in-flight sendMessage; AcpClient
            // handles send/cancel races via _activePromptId.
            host.handleCancel();
            break;
        case 'steer':
            host.handleSteer(message.text || '');
            break;
        case 'openFile':
            void host.handleOpenFile(message.path);
            break;
        case 'listFiles':
            void host.handleListFiles(message.query || '', message.requestId);
            break;
        case 'previewFile':
            void host.handlePreviewFile(message.path, message.requestId);
            break;
        case 'ready':
            host.ready();
            break;
        case 'getHiddenSessions':
            host.postHiddenSessions();
            break;
        case 'openTab':
            host.enqueueChatOp(() => host.handleOpenTab(message.sessionId));
            break;
        case 'reorderSessions':
            host.handleReorderSessions(message.sessionIds);
            break;
        case 'closeSessions':
            void host.handleCloseSessions(message.sessionId, message.mode);
            break;
        case 'renameSession':
            void host.handleRenameSession(message.sessionId, message.title);
            break;
        case 'togglePinSession':
            host.handleTogglePinSession(message.sessionId);
            break;
        case 'sessionExport':
            host.handleSessionExport(message.sessionId, message.action, message.indices);
            break;
        case 'switchAgent':
            host.handleSwitchAgent(message.agentName);
            break;
        case 'switchSession':
            host.handleSwitchSession(message.sessionId, message.interrupt === true);
            break;
        case 'switchModel':
            void host.switchModel(message.configId, message.valueId);
            break;
        case 'getModels':
            void host.syncModels();
            break;
        case 'getProfiles':
            host.postProfileList();
            break;
        case 'webviewLog':
            // Pane-side diagnostics, so paste/render behaviour is observable
            // from the extension output channel instead of the webview devtools.
            host.log(`[webview] ${String(message.line ?? '')}`.slice(0, 400));
            break;
        case 'openExternal':
            host.openExternal(message.url);
            break;
        case 'retry':
            void host.retry();
            break;
        case 'detectEnvironment':
            void host.detection().detectEnvironment();
            break;
        case 'detectEnvironmentDismiss':
            host.detection().dismiss();
            break;
        case 'configureEnvironmentBrowse':
            void host.detection().browse();
            break;
        case 'configureEnvironmentDetect':
            void host.detection().detectInConfigure(message.currentPath);
            break;
        case 'configureEnvironmentSave':
            void host.detection().save(message.path);
            break;
        case 'configureEnvironmentSystem':
            void host.detection().configureSystem(message.path);
            break;
        case 'configureEnvironmentOpenDirectory':
            void host.detection().openDirectory(message.path);
            break;
        case 'configureEnvironmentDetectClose':
            host.detection().closeConfigure();
            break;
        case 'permissionResponse':
            host.handlePermissionResponse(message.id, message.optionId ?? null);
            break;
        case 'forwardMessage':
            host.forwardMessage(message.text, message.sourceMessageId, message.history);
            break;
        case 'deliverPeer':
            host.deliverPeer(message.envelopeId);
            break;
        case 'dismissPeer':
            host.dismissPeer(message.envelopeId);
            break;
        case 'deliverAllPeers':
            host.deliverAllPeers();
            break;
        case 'dismissAllPeers':
            host.dismissAllPeers();
            break;
        case 'setApprovalMode':
            void host.setApprovalMode(message.mode);
            break;
        case 'insertEditor':
            void host.handleInsertEditor(message.text || '');
            break;
        case 'deleteMessages':
            host.handleDeleteMessages(message.indices);
            break;
        case 'openHistoryViewer':
            host.openHistoryViewer(message.sessionId, message.title);
            break;
        case 'clearHistoryStaged':
            host.clearHistoryStaged();
            break;
    }
}
