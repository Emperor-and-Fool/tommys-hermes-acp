/**
 * The message contract between the pane and the host.
 *
 * One list per direction, each a union keyed on `type`, so a reader can see every message the
 * extension speaks without opening either side. Derived from the code, not from a capture:
 * `media/chat.js` for what the pane actually sends, `webview/router.ts` for what the host
 * accepts. A capture only shows what happened while it ran.
 *
 * `PaneToHost` is what the pane sends; `HostToPane` is what the extension posts back. Both live
 * here on purpose: read together, they are the API this pane and this host share.
 *
 * LATER: `media/chat.js` can point at these shapes through JSDoc + `// @ts-check`, so the pane
 * side is checked as well without rewriting it in TypeScript.
 */
import type { ChatMessage, ContextAttachOption, SessionInfo } from './chat';
import type { CatalogSession, PermissionOption } from '../acp/AcpClient';
import type { ModelListItem, ModelProviderGroup } from '../models/modelConfig';
import type { LocaleStrings } from '../i18n/types';

/** Host → pane: every message the extension posts, in the same one place. */
export type HostToPane =
    // Chrome: which renderer, locale, settings, identity.
    | { type: 'surfaceRole'; role: 'chat' | 'rail'; hideTabs: boolean }
    | { type: 'setLocale'; locale: LocaleStrings }
    | { type: 'config'; showThoughts: boolean; showToolCalls: boolean }
    | { type: 'pluginInfo'; displayName: string; version: string; publisher: string; description?: string; repository?: string; iconUri?: string }
    | { type: 'activeAgent'; name: string }
    | { type: 'profileList'; profiles: Array<{ id: string; label: string }> }
    | { type: 'log'; line: string; level: string }
    | { type: 'openAbout' }
    | { type: 'openHelp' }
    | { type: 'openFaq' }
    | { type: 'openLogs' }

    // The conversation.
    | { type: 'status'; status: string; message?: string; sessionId?: string }
    | { type: 'newChat' }
    | { type: 'noActiveTab' }
    | { type: 'restoreHistory'; messages: ChatMessage[]; localHistoryOnly: boolean }
    | { type: 'addMessage'; role: string; text: string; toolCallId?: string; sessionId?: string }
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

    // Context attach picker.
    | { type: 'showContextAttach'; count: number }
    | { type: 'hideContextAttach' }

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

/** What "close" means for the tab strip: one tab, a group, or everything. */
export type SessionCloseMode = 'self' | 'others' | 'left' | 'right' | 'all';

/** The pane's export actions: download, or copy to the clipboard. */
export type SessionExportAction = 'export' | 'copy';

/** Host → pane is the other half; declared here next so the pair stays readable. */
export type PaneToHost =
    /** A composer send. `images` were pasted, never uploaded. */
    | { type: 'sendMessage'; text: string; contextAttach?: ContextAttachOption; images?: PaneImage[] }
    | { type: 'cancel' }
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
    /** Accepted by the host; nothing in media/chat.js sends it today. */
    | { type: 'getSessions' }
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
    | { type: 'openSettings' }

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

    /** Pane-side diagnostics, relayed to the extension's output channel. */
    | { type: 'webviewLog'; line: string };
