/**
 * The window's folders and its workspace file: what the editor has open.
 *
 * Two features ask this: the cwd owner (`workspace/cwd.ts`, which only knows the first three
 * members) and the project group (`workspace/projectGrouped.ts`). One adapter answers both, so
 * "which workspace am I in" has one source (F6).
 */
export interface EditorFolders {
    /** The window's `.code-workspace` file, or '' when it opened plain folders. */
    workspaceFile(): string;
    /** The folders the window opened, in the editor's order. */
    folders(): string[];
    /** Told when that list changes; returns the unsubscribe. */
    onFoldersChanged(handler: () => void): () => void;
}

/**
 * What the chat feature asks of the editor: the folders it may read, a file list, a file's head, a
 * file opened, text inserted at the cursor.
 *
 * Declared in `shared/` because two sides need this shape — the feature that asks (`chat/files.ts`)
 * and the adapter that answers (`editor/files.ts`) — and the architecture lets both import
 * `shared/` while a feature may not be imported by infrastructure (F5).
 */
export interface EditorFiles {
    /** The folders this window opened. The pane may read nothing outside them. */
    folders(): string[];
    /** Paths under those folders, relative to them, at most `limit`. */
    list(limit: number): Promise<string[]>;
    /** The head of a file and how long it is: the pane formats, the editor reads. */
    readHead(filePath: string, maxLines: number): Promise<{ lines: string[]; total: number; language: string }>;
    /** Show a file in an editor. */
    open(filePath: string): Promise<void>;
    /** Insert text at the cursor of the active editor; false when there is no active editor. */
    insertAtCursor(text: string): Promise<boolean>;
    /** How a path is shown to the pane: relative to its folder when it has one. */
    display(filePath: string): string;
    /** Say something to the user in the editor's own voice, as these actions always did. */
    notify(message: string, level: 'warn' | 'info'): void;
}
