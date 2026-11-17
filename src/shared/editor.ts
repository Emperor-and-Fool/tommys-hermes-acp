/**
 * What the chat feature asks of the editor: the folders it may read, a file list, a file's head, a
 * file opened, text inserted at the cursor.
 *
 * Declared in `shared/` because two sides need this shape — the feature that asks (`chat/files.ts`)
 * and the adapter that answers (`environment/editor.ts`) — and the architecture lets both import
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
