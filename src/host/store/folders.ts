import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeAtomic } from './connection';

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

/** One folder of one workspace, as reported by the editor. */
export interface WorkspaceFolderRow {
    workspaceId: string;
    folderId: string;
    /** VS Code's order in the workspace. */
    position: number;
    /** When it appeared in this workspace. `removed_at` absent means it is still there. */
    addedAt: number;
    removedAt?: number;
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
    constructor(private readonly _dataHome: string) {}

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
        const known = rows.find(row => row.path === wanted);
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
        return wanted ? this._readFolders().find(row => row.path === wanted) : undefined;
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
     * workspace. Positions are VS Code's order.
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
                links.push({ workspaceId, folderId, position, addedAt: now });
                return;
            }
            link.position = position;
            if (link.removedAt !== undefined) {
                delete link.removedAt;
                link.addedAt = now;
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
