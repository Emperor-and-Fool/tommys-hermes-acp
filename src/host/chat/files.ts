import * as fs from 'fs';
import * as path from 'path';
import { t } from '../i18n';
import { pathWithin } from '../workspace/cwd';
import type { EditorFiles } from '../../shared/editor';
import type { HostToPane } from '../../shared/webview';

/** What the chat feature needs from the panel: the posts, the log, and the editor behind its port. */
export interface ChatFilesHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    editor: EditorFiles;
}

/** How many files the '@' list may show, and how many the search gathers first. */
const LIST_LIMIT = 30;

/** The head a preview shows before it says there is more. */
const PREVIEW_LINES = 24;

/**
 * The pane's file actions: the '@' picker, a preview, opening a file, inserting text.
 *
 * One rule governs the lot — nothing outside the folders this window opened is readable, and a
 * window with no folder reads nothing. Containment is decided here, not by the editor, so a path
 * that leaves the folders is refused whatever the editor would have allowed.
 */
export class ChatFiles {
    constructor(private readonly _host: ChatFilesHost) {}

    private _allowed(filePath: string): boolean {
        const target = realPath(filePath);
        return this._host.editor.folders().some(folder => pathWithin(realPath(folder), target));
    }

    /** A path as the pane wrote it: '@'-prefixed and padded is the pane's habit, not ours. */
    private _normalize(filePath: string): string {
        return (filePath || '').replace(/^@/, '').trim();
    }

    /** An absolute path, or a relative one resolved against a folder that contains it. */
    private _resolve(filePath: string): string {
        const normalized = this._normalize(filePath);
        if (!normalized) {
            return '';
        }
        if (path.isAbsolute(normalized)) {
            return normalized;
        }
        const folders = this._host.editor.folders();
        for (const folder of folders) {
            const candidate = path.join(folder, normalized);
            if (this._allowed(candidate)) {
                return candidate;
            }
        }
        return folders.length > 0 ? path.join(folders[0], normalized) : '';
    }

    async listFiles(query: string, requestId: string): Promise<void> {
        const needle = (query || '').trim().toLowerCase();
        try {
            const files = (await this._host.editor.list(LIST_LIMIT))
                .filter(file => !needle || file.toLowerCase().includes(needle))
                .slice(0, LIST_LIMIT);
            this._host.post({ type: 'fileList', requestId, files });
        } catch {
            this._host.post({ type: 'fileList', requestId, files: [] });
        }
    }

    async previewFile(filePath: string, requestId: string): Promise<void> {
        const normalized = this._normalize(filePath);
        const resolved = this._resolve(normalized);
        if (!resolved || !this._allowed(resolved)) {
            this._host.post({ type: 'filePreview', requestId, path: normalized, error: t('fileAccessDenied') });
            return;
        }
        try {
            const head = await this._host.editor.readHead(resolved, PREVIEW_LINES);
            const content = head.total > head.lines.length
                ? head.lines.join('\n') + '\n…'
                : head.lines.join('\n');
            this._host.post({
                type: 'filePreview',
                requestId,
                path: this._host.editor.display(resolved),
                content,
                language: head.language,
            });
        } catch {
            this._host.post({ type: 'filePreview', requestId, path: normalized, error: t('fileReadError') });
        }
    }

    async openFile(filePath: string): Promise<void> {
        const resolved = this._resolve(filePath);
        this._host.log(`Open file: ${filePath}`);
        if (!resolved) {
            this._host.editor.notify(t('couldNotOpenFile', filePath), 'warn');
            return;
        }
        try {
            await this._host.editor.open(resolved);
        } catch {
            this._host.editor.notify(t('couldNotOpenFile', filePath), 'warn');
        }
    }

    async insertEditor(text: string): Promise<void> {
        const inserted = await this._host.editor.insertAtCursor(text);
        if (!inserted) {
            this._host.editor.notify(t('noActiveEditor'), 'info');
        }
    }
}

/** Symlinks followed where the file exists, the parent resolved where it does not. */
function realPath(filePath: string): string {
    const resolved = path.resolve(filePath);
    try {
        return fs.realpathSync(resolved);
    } catch {
        try {
            return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
        } catch {
            return resolved;
        }
    }
}
