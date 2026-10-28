/**
 * The message contract between the pane and the host.
 *
 * One list per direction, each a union keyed on `type`, so a reader can see every message the
 * extension speaks without opening either side. Derived from the code, not from a capture:
 * the `post()` calls in `pane/` for what the pane sends, `pane/router.ts` for what it accepts,
 * `host/webview/router.ts` for what the host accepts. A capture only shows what happened while it ran.
 *
 * `PaneToHost` is what the pane sends; `HostToPane` is what the extension posts back. Both live
 * here on purpose: read together, they are the API this pane and this host share.
 */
import type { ChatMessage, HistoryRef, PeerRef, PeerState, SessionInfo } from './chat';
import type { CatalogSession, PermissionOption } from './acp';
import type { ModelListItem, ModelProviderGroup } from './models';
import type { LocaleStrings } from './i18n';

/** Host → pane: every message the extension posts, in the same one place. */
export type HostToPane =
    // Chrome: which renderer, locale, settings, identity.
    | { type: 'surfaceRole'; role: 'chat' | 'rail' | 'viewer'; hideTabs: boolean; bodyRole?: 'primary' | 'secondant' }
    | { type: 'setLocale'; locale: LocaleStrings }
    | { type: 'config'; showThoughts: boolean; showToolCalls: boolean }
    | { type: 'pluginInfo'; displayName: string; version: string; publisher: string; description?: string; repository?: string; iconUri?: string }
    | { type: 'activeAgent'; name: string }
    | { type: 'profileList'; profiles: Array<{ id: string; label: string }> }
    /** The other pane's presence changed: its profile, or nothing when it is gone. */
    | { type: 'setOtherPaneLive'; live: boolean; profile: string }
    /** The answer to Deliver or Dismiss: the card settles into this state. */
    | { type: 'peerActionResult'; envelopeId: string; state: 'delivered' | 'dismissed' }
    /** The profile this pane had is gone: open the dropdown so another can be picked. */
    | { type: 'openProfilePicker' }
    | { type: 'log'; line: string; level: string }
    | { type: 'openAbout' }
    | { type: 'openHelp' }
    | { type: 'openFaq' }
    | { type: 'openLogs' }
    | { type: 'focusComposer' }

    // The conversation.
    | { type: 'status'; status: string; message?: string; sessionId?: string }
    | { type: 'newChat' }
    | { type: 'noActiveTab' }
    | { type: 'restoreHistory'; messages: ChatMessage[]; localHistoryOnly: boolean; sessionId?: string }
    | { type: 'addMessage'; role: string; text: string; toolCallId?: string; sessionId?: string; history?: HistoryRef; steer?: boolean; peer?: PeerRef; peerState?: PeerState }
    | { type: 'finishAssistantBubble'; sessionId?: string }
    | { type: 'undeliveredMessage'; text: string }
    | { type: 'insertInput'; text: string }
    | { type: 'tokenUsage'; used: number; size: number }

    // Tabs and models.
    | { type: 'sessionList'; sessions: SessionInfo[]; activeSessionId: string }
    | { type: 'hiddenSessions'; sessions: CatalogSession[] }
    | { type: 'sessionExport'; action: SessionExportAction; sessionId: string; title: string; markdown: string; filename: string }
    | { type: 'modelList'; configId: string; currentValueId: string; currentLabel: string; models: ModelListItem[]; groups?: ModelProviderGroup[]; fromAgent: boolean }

    // Files.
    | { type: 'fileList'; requestId: string; files: string[] }
    | { type: 'filePreview'; requestId: string; path: string; content?: string; language?: string; error?: string }

    // Permissions.
    | { type: 'permissionRequest'; id: string; title: string; detail?: string; options: PermissionOption[] }
    | { type: 'permissionDismiss'; id: string }
    /** The approval mode the pending cards offer, and why a change did not take. */
    | { type: 'approvalMode'; mode: ApprovalMode; error?: string }

    // Session memory: the staged pick, and its disappearance after a send.
    | { type: 'historyStaged'; ref: HistoryRef; pending: boolean }
    | { type: 'historyCleared' }

    // Environment detection and the configure panel.
    | { type: 'detectEnvironmentStart'; mode: 'connect' | 'manual' | 'configure' }
    | { type: 'detectEnvironmentProgress'; step: string; status: string; brief: string; detail?: string; paths?: string[]; count?: number; verifiedCount?: number; totalCount?: number; reportStatus?: string }
    | { type: 'detectEnvironmentEnd'; status: string; mode: string; brief: string; summaryStatus: string }
    | { type: 'configureEnvironmentOpen'; currentPath: string; systemEnvVar: string; systemEnvTarget: string }
    | { type: 'configureEnvironmentDetectStart' }
    | { type: 'configureEnvironmentDetectProgress'; step: string; status: string; brief: string; detail?: string; paths?: string[]; count?: number; verifiedCount?: number; totalCount?: number; reportStatus?: string }
    | { type: 'configureEnvironmentDetectEnd'; status: string; summary?: string; executables?: Array<{ path: string; source: string; verified: boolean; version?: string }> }
    | { type: 'configureEnvironmentDetectClosed' }
    | { type: 'configureEnvironmentBrowseResult'; path?: string; error?: string }
    | { type: 'configureEnvironmentSaveResult'; ok: boolean; path?: string; error?: string };

/** One pasted image, as the pane hands it over: base64, no bytes stored by Hermes. */
export interface PaneImage {
    mimeType: string;
    data: string;
}

/**
 * Hermes' `approvals.mode`, as a permission card offers it. `unknown` means the CLI could not be
 * read (no executable, or a value this pane does not know): nothing is pressed then.
 */
export type ApprovalMode = 'manual' | 'smart' | 'off' | 'unknown';

/** What "close" means for the tab strip: one tab, a group, or everything. */
export type SessionCloseMode = 'self' | 'others' | 'left' | 'right' | 'all';

/** The pane's export actions: download, or copy to the clipboard. */
export type SessionExportAction = 'export' | 'copy';

/** Host → pane is the other half; declared here next so the pair stays readable. */
export type PaneToHost =
    /** A composer send. `images` were pasted, never uploaded. */
    | { type: 'sendMessage'; text: string; images?: PaneImage[] }
    | { type: 'cancel' }
    /** Guidance for the running turn: Hermes takes it as `/steer <text>`. */
    | { type: 'steer'; text: string }
    | { type: 'retry' }

    // Files the pane can reach: @-mentions, previews, and opening one in the editor.
    | { type: 'openFile'; path: string }
    | { type: 'listFiles'; query: string; requestId: string }
    | { type: 'previewFile'; path: string; requestId: string }
    | { type: 'openExternal'; url: string }
    | { type: 'insertEditor'; text: string }

    // First paint. The pane knows nothing; the host replays state and connects.
    | { type: 'ready' }

    // Tabs. `openTab` with no id opens a blank tab.
    | { type: 'getHiddenSessions' }
    | { type: 'openTab'; sessionId?: string }
    | { type: 'reorderSessions'; sessionIds: string[] }
    | { type: 'closeSessions'; sessionId: string; mode: SessionCloseMode }
    | { type: 'renameSession'; sessionId: string; title: string }
    | { type: 'togglePinSession'; sessionId: string }
    | { type: 'sessionExport'; sessionId: string; action: SessionExportAction; indices?: number[] }
    /** `interrupt` is set when the user confirms switching away from a running turn. */
    | { type: 'switchSession'; sessionId: string; interrupt?: boolean }

    // Profiles and models.
    | { type: 'switchAgent'; agentName: string }
    | { type: 'switchModel'; configId: string; valueId: string }
    | { type: 'getModels' }
    | { type: 'getProfiles' }
    /** Forward this message to the other pane; the host decides who that is. */
    | { type: 'forwardMessage'; text: string; sourceMessageId?: string }
    /** Deliver a peer card to the agent as a real user turn. */
    | { type: 'deliverPeer'; envelopeId: string }
    /** Throw a peer card away: no turn, nothing sent. */
    | { type: 'dismissPeer'; envelopeId: string }

    // Environment detection and the configure panel.
    | { type: 'detectEnvironment' }
    | { type: 'detectEnvironmentDismiss' }
    | { type: 'configureEnvironmentBrowse' }
    | { type: 'configureEnvironmentDetect'; currentPath?: string }
    | { type: 'configureEnvironmentSave'; path?: string }
    | { type: 'configureEnvironmentSystem'; path?: string }
    | { type: 'configureEnvironmentOpenDirectory'; path: string }
    | { type: 'configureEnvironmentDetectClose' }

    // Turn-level answers and transcript surgery.
    | { type: 'permissionResponse'; id: string; optionId: string | null }
    | { type: 'deleteMessages'; indices: number[] }

    /** The approval switch on a pending card: one value, written to Hermes' profile config. */
    | { type: 'setApprovalMode'; mode: ApprovalMode }

    // The read-only history viewer: ticks from another session's transcript, or a cancel.
    // `indices` are the pane's `dataset.sessionIndex` of the ticked groups.
    | { type: 'historyPicked'; sessionId: string; indices: number[] }
    | { type: 'historyViewerCancel' }
    /** Re-send the transcript: the viewer's own re-render, after its role filter changed. */
    | { type: 'reloadHistoryViewer' }

    // Session memory: open the viewer on one session, or drop the staged pick.
    | { type: 'openHistoryViewer'; sessionId: string; title: string }
    | { type: 'clearHistoryStaged' }

    /** Pane-side diagnostics, relayed to the extension's output channel. */
    | { type: 'webviewLog'; line: string };
