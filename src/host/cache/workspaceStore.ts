import * as fs from 'fs';
import { workspacesPathFor } from './profileStorage';
import type { ProjectFolder, WorkspaceEntry } from '../../shared/chat';

/** The registry's file: the workspaces this editor has opened, and the folders he named. */
interface RegistryFile {
    workspaces: WorkspaceEntry[];
    folders: ProjectFolder[];
}

/**
 * The workspaces this editor has opened, and the project folders that group their tabs.
 *
 * One file above the profiles: a workspace is not a profile — the primary and the secondant run
 * different profiles in the same window — so a registry inside `sessions.json` would hold two
 * copies of one fact and run every sweep twice.
 *
 * The file used to be a bare array of workspaces; that shape is still read, so an install from
 * before folders existed keeps its entries.
 *
 * This class reads and writes a file and nothing else — no window, no listener, no decision about
 * what belongs in it.
 */
export class WorkspaceStore {
    constructor(private readonly _historyDir: string) {}

    get path(): string {
        return workspacesPathFor(this._historyDir);
    }

    read(): WorkspaceEntry[] {
        return this._read().workspaces;
    }

    folders(): ProjectFolder[] {
        return this._read().folders;
    }

    /** Record that this workspace was opened now. An empty string is not a workspace. */
    register(path: string): WorkspaceEntry[] {
        const file = this._read();
        if (!path) {
            return file.workspaces;
        }
        const now = Date.now();
        const existing = file.workspaces.find(entry => entry.path === path);
        if (existing) {
            existing.lastSeen = now;
        } else {
            file.workspaces.push({ path, lastSeen: now });
        }
        this._write(file);
        return file.workspaces;
    }

    /** Name a group of tabs and connect it to a workspace. A blank name is not a folder. */
    createFolder(name: string, workspace: string): ProjectFolder | undefined {
        const trimmed = (name || '').replace(/\s+/g, ' ').trim();
        if (!trimmed) {
            return undefined;
        }
        const file = this._read();
        const folder: ProjectFolder = {
            // A timestamp alone collides: two folders made in one millisecond would share an id,
            // and deleting one would take both. The suffix is what keeps the id a folder's own.
            id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            name: trimmed,
            workspace,
        };
        file.folders.push(folder);
        this._write(file);
        return folder;
    }

    /** Give a folder another name. A blank name changes nothing, like a blank create. */
    renameFolder(id: string, name: string): ProjectFolder | undefined {
        const trimmed = (name || '').replace(/\s+/g, ' ').trim();
        if (!trimmed) {
            return undefined;
        }
        const file = this._read();
        const folder = file.folders.find(entry => entry.id === id);
        if (!folder || folder.name === trimmed) {
            return undefined;
        }
        folder.name = trimmed;
        this._write(file);
        return folder;
    }

    /** Drop a folder. Its tabs are not this file's business: they outlive the group. */
    deleteFolder(id: string): boolean {
        const file = this._read();
        const kept = file.folders.filter(entry => entry.id !== id);
        if (kept.length === file.folders.length) {
            return false;
        }
        file.folders = kept;
        this._write(file);
        return true;
    }

    private _read(): RegistryFile {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
            if (Array.isArray(parsed)) {
                return { workspaces: parsed, folders: [] };
            }
            return {
                workspaces: Array.isArray(parsed && parsed.workspaces) ? parsed.workspaces : [],
                folders: Array.isArray(parsed && parsed.folders) ? parsed.folders : [],
            };
        } catch {
            return { workspaces: [], folders: [] };
        }
    }

    private _write(file: RegistryFile): void {
        try {
            fs.writeFileSync(this.path, JSON.stringify(file, null, 2));
        } catch { /* non-critical: a tab's tag does not depend on this file */ }
    }
}
