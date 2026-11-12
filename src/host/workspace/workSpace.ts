import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Project, Workspace } from '../../shared/chat';

/**
 * The workspace: which one this window is, and the list of the ones this editor has opened.
 *
 * One subject, one file. The list is the one fact both agents share — a workspace is independent
 * of which profile runs in it — so it lives above the profiles. Projects do not: they group tabs,
 * and the tab index is per profile. They are in `projectGrouped.ts`, beside the tabs they group.
 */

/** An id for a thing this file owns: the time it was made, plus four characters against a tie. */
export function mintId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * The id of a workspace: derived from its path, so it cannot change.
 *
 * Everything a tab and a project point at hangs off this. A minted id looked equivalent until a
 * registry rewrite re-minted it: every tab then carried a reference to an id that no longer
 * existed, so every tab and every project disappeared from the window at once. A hash of the path
 * is the same id forever — a lost, truncated or rewritten registry re-creates it identically.
 *
 * "No workspace" (`''`) has no id: it is the absence of one, not a workspace.
 */
export function workspaceIdFor(workspacePath: string): string {
    if (!workspacePath) {
        return '';
    }
    return createHash('sha256').update(workspacePath).digest('hex').slice(0, 12);
}

/** The workspace list's file, above the profiles: a workspace is not a profile. */
/**
 * THE SHAPE THIS FILE IS WRITTEN FOR, so a move to SQLite is a schema, not a rewrite.
 *
 * Every record here is a row of one table, and every cross-record value is a key, never a copy of
 * another row's content. Keep it that way when this file grows:
 *
 *   workspaces(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, last_seen INTEGER NOT NULL)
 *   projects(id TEXT PRIMARY KEY, profile TEXT NOT NULL, name TEXT NOT NULL,
 *            workspace_id TEXT NOT NULL REFERENCES workspaces(id))
 *   tabs(id TEXT PRIMARY KEY, profile TEXT NOT NULL, title TEXT, created_at INTEGER,
 *        updated_at INTEGER, sticky INTEGER, workspace_id TEXT REFERENCES workspaces(id),
 *        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, cwd TEXT,
 *        hermes_session_id TEXT, model_id TEXT, model_label TEXT)
 *
 * The rules that make that schema honest, and that this code already follows:
 * - `workspaces` is global (an editor fact); `projects` and `tabs` are partitioned by `profile`,
 *   the scope key, exactly as `profiles/<scope>/` partitions them on disk today.
 * - `workspace_id` and `project_id` are ids, never paths or names. A path or a name that changes
 *   must not move a reference.
 * - Deleting a project sets its tabs' `project_id` to NULL: the group is a view, and the tabs
 *   outlive it. No cascade delete, ever.
 * - A tab's `workspace_id` is written when the tab is created and rewritten only by an explicit
 *   single-tab move. Nothing derives it from `cwd` afterwards except the one adoption pass.
 * - Ids are minted once and kept, by `mintId()` for workspaces, projects and tabs alike. It is
 *   base36 time plus four characters, so two records made in one millisecond stay distinct; a
 *   UUID is a drop-in replacement if that ever proves too weak.
 * - `tree-current.json` and `tree-passive.json` are projections WRITTEN from these rows, never
 *   read back by the extension. They are not tables and hold no truth: nothing may be stored
 *   there that is not already derivable from the three records.
 * - Both files are read as unknown-tolerant: an unknown key is carried through a write, never
 *   dropped, which is the same courtesy a migration backfill needs.
 */

export function workspacesPathFor(historyDir: string): string {
    return path.join(historyDir, 'workspaces.json');
}

/** The file's shape: the workspaces only. `projects` lived here until they moved per profile. */
interface WorkspaceFile {
    workspaces: Workspace[];
}

/**
 * The workspaces this editor has opened.
 *
 * This class reads and writes a file and nothing else — no window, no listener, no decision about
 * what belongs in it.
 */
export class WorkspaceStore {
    constructor(private readonly _historyDir: string) {}

    get path(): string {
        return workspacesPathFor(this._historyDir);
    }

    read(): Workspace[] {
        return this._read().workspaces;
    }

    /** The entry for a path, without recording it. What a tab needs when it is tagged. */
    entryFor(workspacePath: string): Workspace | undefined {
        return this._read().workspaces.find(entry => entry.path === workspacePath);
    }

    /** The entry for a path, made if this is the first reference to it. For reading old files. */
    ensure(workspacePath: string): Workspace {
        const file = this._read();
        const existing = file.workspaces.find(entry => entry.path === workspacePath);
        if (existing) {
            return existing;
        }
        const entry = { id: workspaceIdFor(workspacePath), path: workspacePath, lastSeen: Date.now() };
        file.workspaces.push(entry);
        this._write(file);
        return entry;
    }

    /** Record that this workspace was opened now. An empty string is not a workspace. */
    register(workspacePath: string): Workspace[] {
        const file = this._read();
        if (!workspacePath) {
            return file.workspaces;
        }
        const existing = file.workspaces.find(entry => entry.path === workspacePath);
        if (existing) {
            existing.lastSeen = Date.now();
        } else {
            file.workspaces.push({ id: workspaceIdFor(workspacePath), path: workspacePath, lastSeen: Date.now() });
        }
        this._write(file);
        return file.workspaces;
    }

    /**
     * Take the projects this file still carries, and drop them from it.
     *
     * Projects moved to `profiles/<scope>/projects.json`, because they group one agent's tabs. The
     * first project read adopts this list and rewrites the file without it, so nothing has to be
     * created again after the move.
     */
    takeProjects(): Project[] {
        let projects: Project[] = [];
        try {
            const parsed = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
            if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.projects) || !parsed.projects.length) {
                return [];
            }
            projects = parsed.projects as Project[];
            // Written deliberately without them: this is the one writer that removes the list.
            writeAtomic(this.path, { workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [] });
        } catch {
            return [];
        }
        return projects;
    }

    private _read(): WorkspaceFile {
        let list: Workspace[] = [];
        try {
            const parsed = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
            const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.workspaces) ? parsed.workspaces : []);
            list = raw.filter((entry: Workspace) => !!entry && typeof entry.path === 'string');
        } catch {
            return { workspaces: [] };
        }
        // Every entry's id is the one its path derives, so a registry that was lost, truncated or
        // re-written cannot change any of them. An old minted id is replaced here, once.
        let moved = false;
        for (const entry of list) {
            const derived = workspaceIdFor(entry.path);
            if (entry.id !== derived) {
                entry.id = derived;
                moved = true;
            }
        }
        if (moved) {
            this._write({ workspaces: list });
        }
        return { workspaces: list };
    }

    /**
     * Write the workspaces, carrying along a `projects` list that has not been taken yet.
     *
     * Until `takeProjects()` runs, a projects list in this file belongs to nobody else, and a
     * registration at activation used to drop it. Keeping what we do not own is the rule; taking
     * the list is what removes it.
     */
    private _write(file: WorkspaceFile): void {
        let carried: unknown;
        try {
            const raw = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
            if (raw && !Array.isArray(raw) && Array.isArray(raw.projects) && raw.projects.length) {
                carried = raw.projects;
            }
        } catch { /* no file, or nothing readable: there is nothing to carry */ }
        writeAtomic(this.path, carried ? { ...file, projects: carried } : file);
    }
}

/**
 * Write JSON through a temp file and a rename, so a failed write cannot truncate the target.
 *
 * `writeFileSync` straight onto the target leaves a truncated file if the write dies halfway, and
 * these files hold the only copy of what he made. A rename is the filesystem's one atomic step:
 * the target is the old file or the new one, never a half of either.
 */
export function writeAtomic(target: string, value: unknown): void {
    const temp = target + '.tmp';
    try {
        fs.writeFileSync(temp, JSON.stringify(value, null, 2));
        fs.renameSync(temp, target);
    } catch {
        try {
            fs.rmSync(temp, { force: true });
        } catch { /* the next write overwrites it */ }
    }
}

/** What the identity needs from the extension: a log line, and where a new value is recorded. */
export interface WorkspaceIdentityHost {
    log(line: string): void;
    /** The window opened, or its folders changed: the registry records what it now is. */
    onWorkspace(value: string): void;
}

/**
 * The workspace this window is, as one string.
 *
 * VS Code is the authority for *which* window this is: `workspaceFile` for a saved workspace,
 * otherwise the window's first root folder. It is not the authority for names — it has no project
 * name and hands out no id — so naming stays ours.
 *
 * Empty means a window with no folder and no workspace file: a place of its own, with its own tabs.
 */
export function currentWorkspace(): string {
    const file = vscode.workspace.workspaceFile;
    if (file && file.scheme === 'file') {
        return file.fsPath;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return '';
}

/**
 * The window's workspace, plus the one subscription that follows it.
 *
 * A tab is tagged with `current()` at the moment it is registered, so a folder added after the
 * window opened is picked up by the next tab; `start()` keeps the registry in step in between.
 */
export class WorkspaceIdentity {
    constructor(private readonly _host: WorkspaceIdentityHost) {}

    current(): string {
        return currentWorkspace();
    }

    /** Record the window it opened in, then every change to its folders. */
    start(): vscode.Disposable {
        this._record('opened');
        return vscode.workspace.onDidChangeWorkspaceFolders(() => this._record('changed'));
    }

    private _record(reason: string): void {
        const value = this.current();
        if (!value) {
            return;
        }
        this._host.onWorkspace(value);
        this._host.log(`Workspace ${reason}: ${value}`);
    }
}
