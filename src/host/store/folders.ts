import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeAtomic } from './connection';
import { sameFolderPath } from './paths';

/**
 * The folders a window shows, and which of them each workspace had.
 *
 * VS Code and the filesystem own folders; their path is the key we keep as a value, and the id is
 * ours (00.02 §1). That is what lets a session point at a folder — `permissionRootFolderId` — and
 * survive the folder being renamed or moved: one value changes, every reference stays.
 *
 * Two tables, shaped as they will be in SQLite:
 *
 *   folders(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL)
 *   workspace_folders(workspace_id TEXT NOT NULL, folder_id TEXT NOT NULL, position INTEGER,
 *                     added_at INTEGER, removed_at INTEGER)
 *
 * `folders` is shared: the same path in two workspaces is one row. `workspace_folders` is what VS
 * Code reported, in its order, and keeps a folder after it leaves a workspace — `added_at` answers
 * "the most recently added folder", which is the fallback a default root needs, and `removed_at`
 * keeps the history honest instead of deleting it.
 *
 * Nothing here decides anything: the caller says what the editor reports, and asks what it said.
 * Rows are read as unknown-tolerant, so a later backfill can add a column without losing a row.
 */

/** One folder, wherever it is shown. */
export interface FolderRow {
    id: string;
    path: string;
    [key: string]: unknown;
}

/**
 * How long a folder that joins a workspace is announced as new. Kept here because the row is what
 * remembers it: a window closed mid-way resumes from the seconds this store holds, not from 30.
 */
export const NEW_FOLDER_SECONDS = 30;

/** One folder of one workspace, as reported by the editor. */
export interface WorkspaceFolderRow {
    workspaceId: string;
    folderId: string;
    /** VS Code's order in the workspace. */
    position: number;
    /** When it appeared in this workspace. `removed_at` absent means it is still there. */
    addedAt: number;
    removedAt?: number;
    /**
     * Seconds left of the "new folder" welcome, counted down only while the rail shows it.
     * Absent means 0, which is what every row written before this column existed means.
     */
    newSecondsLeft?: number;
    [key: string]: unknown;
}

/** A folder of a workspace, resolved for a reader: its path, and whether it is still a member. */
export interface OfferedFolder {
    folderId: string;
    path: string;
    position: number;
    addedAt: number;
    /** Gone from the workspace: the row is kept, but nothing new may be put in it. */
    removed: boolean;
    /** Seconds left of the welcome; 0 for a folder that is not new. */
    newSecondsLeft?: number;
}

export function foldersPathFor(dataHome: string): string {
    return path.join(dataHome, 'folders.json');
}

export function workspaceFoldersPathFor(dataHome: string): string {
    return path.join(dataHome, 'workspace-folders.json');
}

interface FoldersFile {
    folders: FolderRow[];
}

interface WorkspaceFoldersFile {
    links: WorkspaceFolderRow[];
}

/**
 * The folder table and the workspace membership table.
 *
 * Synchronous (ST4), domain-shaped (ST2), one file each, one write per call through `writeAtomic`,
 * and a write only when the value actually changed — a window start says the same thing it said
 * last time, and should not touch the disk for it.
 */
export class FoldersStore {
    /**
     * `platform` decides how two paths are compared, never how they are stored: on Windows the same
     * folder arrives as `C:\Repo` and `c:\repo\`, and one of them must not mint a second row.
     */
    constructor(
        private readonly _dataHome: string,
        private readonly _platform: NodeJS.Platform = process.platform,
    ) {}

    get foldersPath(): string {
        return foldersPathFor(this._dataHome);
    }

    get linksPath(): string {
        return workspaceFoldersPathFor(this._dataHome);
    }

    /** The row for a path, minted the first time that path is seen anywhere. */
    folderFor(folderPath: string): FolderRow | undefined {
        const wanted = (folderPath || '').trim();
        if (!wanted) {
            return undefined;
        }
        const rows = this._readFolders();
        const known = rows.find(row => sameFolderPath(row.path, wanted, this._platform));
        if (known) {
            return known;
        }
        const row: FolderRow = { id: randomUUID(), path: wanted };
        this._writeFolders(rows.concat(row));
        return row;
    }

    /** An existing row for a path, without minting one. */
    rowFor(folderPath: string): FolderRow | undefined {
        const wanted = (folderPath || '').trim();
        return wanted ? this._readFolders().find(row => sameFolderPath(row.path, wanted, this._platform)) : undefined;
    }

    /** A folder's path. '' when the id is not one of ours (or its row was lost). */
    pathFor(folderId: string): string {
        if (!folderId) {
            return '';
        }
        return this._readFolders().find(row => row.id === folderId)?.path || '';
    }

    /**
     * Record what the editor reports for a workspace: add, move, keep or retire each folder.
     *
     * A folder that appears gets `addedAt`; one that is gone gets `removedAt` and keeps its row; one
     * that comes back is live again with a fresh `addedAt`, because that is when it joined this
     * workspace. Positions are VS Code's order. A folder that joins — or rejoins — also gets the
     * welcome, so the rail can say which one is new.
     */
    record(workspaceId: string, paths: string[], now = Date.now()): WorkspaceFolderRow[] {
        if (!workspaceId) {
            return this._readLinks();
        }
        const links = this._readLinks();
        const folderIds = paths
            .map(item => (item || '').trim())
            .filter(Boolean)
            .map(item => this.folderFor(item)!.id);
        const before = JSON.stringify(links);
        folderIds.forEach((folderId, position) => {
            const link = links.find(row => row.workspaceId === workspaceId && row.folderId === folderId);
            if (!link) {
                links.push({ workspaceId, folderId, position, addedAt: now, newSecondsLeft: NEW_FOLDER_SECONDS });
                return;
            }
            link.position = position;
            if (link.removedAt !== undefined) {
                delete link.removedAt;
                link.addedAt = now;
                link.newSecondsLeft = NEW_FOLDER_SECONDS;
            }
        });
        for (const link of links) {
            if (link.workspaceId === workspaceId && !folderIds.includes(link.folderId) && link.removedAt === undefined) {
                link.removedAt = now;
            }
        }
        if (JSON.stringify(links) !== before) {
            this._writeLinks(links);
        }
        return links.filter(link => link.workspaceId === workspaceId);
    }

    /**
     * How much of a folder's welcome is left.
     *
     * One row, one write, and only when the value actually changed — a clock that is stopped after
     * one tick writes once, and a clock stopped at the value it already had writes nothing.
     * Returns whether anything was written.
     */
    setNewSecondsLeft(workspaceId: string, folderId: string, seconds: number): boolean {
        if (!workspaceId || !folderId) {
            return false;
        }
        const links = this._readLinks();
        const link = links.find(row => row.workspaceId === workspaceId && row.folderId === folderId);
        const next = Math.max(0, Math.round(seconds));
        if (!link || (link.newSecondsLeft || 0) === next) {
            return false;
        }
        link.newSecondsLeft = next;
        this._writeLinks(links);
        return true;
    }

    /**
     * A workspace's folders, in the editor's last order, with their paths.
     *
     * `removed` marks a row the editor no longer reports: kept, shown, and not choosable.
     */
    foldersOf(workspaceId: string): OfferedFolder[] {
        const paths = new Map(this._readFolders().map(row => [row.id, row.path]));
        return this._readLinks()
            .filter(link => link.workspaceId === workspaceId)
            .sort((left, right) => left.position - right.position)
            .map(link => ({
                folderId: link.folderId,
                path: paths.get(link.folderId) || '',
                position: link.position,
                addedAt: link.addedAt,
                removed: link.removedAt !== undefined,
                newSecondsLeft: link.newSecondsLeft || 0,
            }));
    }

    /** The workspace's live folders, which is what a choice may be made among. */
    liveFoldersOf(workspaceId: string): OfferedFolder[] {
        return this.foldersOf(workspaceId).filter(folder => !folder.removed && folder.path);
    }

    private _readFolders(): FolderRow[] {
        return readRows<FolderRow>(this.foldersPath, row => typeof row.path === 'string' && typeof row.id === 'string');
    }

    private _writeFolders(rows: FolderRow[]): void {
        writeAtomic(this.foldersPath, { folders: rows } as FoldersFile);
    }

    private _readLinks(): WorkspaceFolderRow[] {
        return readRows<WorkspaceFolderRow>(
            this.linksPath,
            row => typeof row.workspaceId === 'string' && typeof row.folderId === 'string',
        );
    }

    private _writeLinks(rows: WorkspaceFolderRow[]): void {
        writeAtomic(this.linksPath, { links: rows } as WorkspaceFoldersFile);
    }
}

/** The rows of one table file: `{ <key>: rows }`, an unknown key carried through. */
function readRows<T>(target: string, isRow: (row: T) => boolean): T[] {
    try {
        const parsed = JSON.parse(fs.readFileSync(target, 'utf-8')) as Record<string, unknown>;
        const rows = Object.values(parsed || {}).find(value => Array.isArray(value));
        return Array.isArray(rows) ? rows.filter(isRow) : [];
    } catch {
        return [];
    }
}
