/**
 * The message contract between the pane and the host.
 *
 * One list per direction, each a union keyed on `type`, so a reader can see every message the
 * extension speaks without opening either side. Derived from the code, not from a capture:
 * `media/chat.js` for what the pane actually sends, `webview/router.ts` for what the host
 * accepts. A capture only shows what happened while it ran.
 *
 * `HostToPane` (the replies, and every post()) is the next commit; both directions are meant to
 * be read together, which is why they share this file.
 *
 * LATER: `media/chat.js` can point at these shapes through JSDoc + `// @ts-check`, so the pane
 * side is checked as well without rewriting it in TypeScript.
 */
import type { ContextAttachOption } from './chat';

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
