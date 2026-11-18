import * as fs from 'fs';
import * as path from 'path';
import type { Project, SessionInfo, Workspace } from '../../shared/chat';
import { activeSessionPathFor, profileDir, sessionsPathFor, workspacesPathFor } from '../store/paths';
import { writeAtomic, writeAtomicText } from '../store/connection';
import { NO_ROOTS } from './cwd';
import type { RootState, RootsSource } from './cwd';
import type { TreeInput, TreePaths, TreeSnapshot } from './workSpace';
import { buildTreeSnapshot, mintId, treeNoticeBlock, workspaceIdFor } from './workSpace';

/**
 * The workspace feature's one door to its data: workspaces, the projects named against them, and
 * the tabs. Three stores, one file, because they are one subject's records and they reference each
 * other (ST1, ST2).
 *
 * Wired once, in the composition root (`app.ts`), and handed to `Projects` and `Sessions` — no
 * store is built inside a feature's constructor (C2). Every write goes through `store/connection`,
 * which owns the temp-file-and-rename discipline; a unit of work that writes two of these files
 * belongs in one `transaction()` once its callers are moved (ST3).
 *
 * `Sessions` still owns the transcript side and its pending-user store: those are Hermes' data and
 * chat's own, not this file's.
 */

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
        //
        // A root recorded here by an older build is dropped in the same pass: the roots are per
        // agent now (ProfileRootsStore) and the migration has already moved them out.
        let moved = false;
        list = list.map((entry: Workspace & { primaryRoot?: string; permissionRoot?: string }) => {
            const derived = workspaceIdFor(entry.path);
            const { primaryRoot: _primary, permissionRoot: _permission, ...row } = entry;
            if (entry.id !== derived || _primary !== undefined || _permission !== undefined) {
                moved = true;
            }
            return { ...row, id: derived };
        });
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

/** Where one agent's workspace roots live: beside its projects and tabs. */
export function workspaceRootsPathFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'workspace-roots.json');
}

/**
 * The permission roots, per agent and per workspace.
 *
 * They used to sit inside `workspaces.json` — one editor fact shared by every profile — so one
 * agent's pick was another's. A workspace keeps its identity in that registry; the roots belong to
 * the agent, are keyed by workspace id, and are read by whichever extension is on that agent.
 *
 * The key is a function: a profile switch changes which folder is meant, without rebuilding stores.
 */
export class ProfileRootsStore implements RootsSource {
    constructor(
        private readonly _historyDir: string,
        private readonly _sessionProfileId: () => string,
    ) {}

    get path(): string {
        return workspaceRootsPathFor(this._historyDir, this._sessionProfileId());
    }

    roots(workspaceId: string): RootState {
        if (!workspaceId) {
            return { ...NO_ROOTS };
        }
        return this._read()[workspaceId] || { ...NO_ROOTS };
    }

    /** Write them. Absent roots are written as an empty string, never left stale (ST2). */
    setRoots(workspaceId: string, roots: RootState): void {
        if (!workspaceId) {
            return;
        }
        const all = this._read();
        all[workspaceId] = { primaryRoot: roots.primaryRoot || '', permissionRoot: roots.permissionRoot || '' };
        writeAtomic(this.path, all);
    }

    private _read(): Record<string, RootState> {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
}

export function projectsPathFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'projects.json');
}

/**
 * The projects of one agent.
 *
 * It adopts the list the shared file used to hold on its first read, so the projects made before
 * the split are not lost — and then the shared file carries workspaces only.
 */
export class ProjectStore {
    constructor(
        private readonly _historyDir: string,
        private _sessionProfileId: string,
        private readonly _workspaces: WorkspaceStore,
    ) {}

    get path(): string {
        return projectsPathFor(this._historyDir, this._sessionProfileId);
    }

    setProfile(sessionProfileId: string): void {
        this._sessionProfileId = sessionProfileId;
    }

    /** Which agent's file this store reads: empty until a profile is bound. */
    get sessionProfileId(): string {
        return this._sessionProfileId;
    }

    projects(): Project[] {
        return this._read();
    }

    /** Name a project against the workspace it belongs to. A blank name is not a project. */
    create(name: string, workspaceId: string): Project | undefined {
        const trimmed = (name || '').replace(/\s+/g, ' ').trim();
        if (!trimmed) {
            return undefined;
        }
        const projects = this._read();
        const project: Project = {
            id: mintId(),
            name: trimmed,
            workspaceId,
        };
        projects.push(project);
        this._write(projects);
        return project;
    }

    /** Give a project another name. A blank name changes nothing, like a blank create. */
    rename(id: string, name: string): Project | undefined {
        const trimmed = (name || '').replace(/\s+/g, ' ').trim();
        const projects = this._read();
        const project = projects.find(entry => entry.id === id);
        if (!trimmed || !project || project.name === trimmed) {
            return undefined;
        }
        project.name = trimmed;
        this._write(projects);
        return project;
    }

    /** Drop a project. Its tabs are not this file's business: they outlive the group. */
    delete(id: string): boolean {
        const projects = this._read();
        const kept = projects.filter(entry => entry.id !== id);
        if (kept.length === projects.length) {
            return false;
        }
        this._write(kept);
        return true;
    }

    private _read(): Project[] {
        const raw: Array<Project & { workspace?: string }> = !fs.existsSync(this.path)
            ? this._workspaces.takeProjects() as Array<Project & { workspace?: string }>
            : (() => {
                try {
                    const parsed = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            })();
        // A project written before workspaces had ids names its workspace by path: read it as a
        // reference to that workspace's id, and keep the id from here on.
        let migrated = false;
        const projects: Project[] = raw.map(entry => {
            if (!entry || typeof entry.id !== 'string') {
                return entry as Project;
            }
            if (entry.workspaceId) {
                return entry as Project;
            }
            migrated = true;
            const workspaceId = entry.workspace ? this._workspaces.ensure(entry.workspace).id : '';
            const { workspace: _legacy, ...rest } = entry;
            return { ...rest, workspaceId };
        });
        if (migrated || !fs.existsSync(this.path)) {
            this._write(projects);
        }
        return projects;
    }

    private _write(projects: Project[]): void {
        writeAtomic(this.path, projects);
    }
}

/**
 * Everything the extension keeps on disk about sessions: an index of which tab belongs to which
 * Hermes session, and which session was last active. Transcripts are Hermes'.
 *
 * This class reads and writes files and does nothing else. It holds no session state, knows
 * nothing about the webview, and keeps no cap of its own: what it is handed is what it writes.
 * A tab the user stopped using leaves the catalog when the caller drops it, not at a count.
 */
export class TabStore {
    constructor(private _historyDir: string, private _sessionProfileId: string) {}

    /** The catalog is per agent; the transcripts are not. */
    setProfile(sessionProfileId: string): void {
        this._sessionProfileId = sessionProfileId;
    }

    get catalogPath(): string {
        return sessionsPathFor(this._historyDir, this._sessionProfileId);
    }

    get activeIdPath(): string {
        return activeSessionPathFor(this._historyDir, this._sessionProfileId);
    }

    readCatalog(): SessionInfo[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.catalogPath, 'utf-8'));
            if (!Array.isArray(parsed)) {
                return [];
            }
            // `workspace` held a path before workspaces had ids; the record's field is
            // `workspaceId` now, and the stale key is dropped here rather than carried forever.
            // Only a record that still carries it is rebuilt: the file is read on every catalog
            // refresh, and an array that needs nothing costs nothing.
            if (!parsed.some(record => record && record.workspace !== undefined)) {
                return parsed;
            }
            return parsed.map(record => {
                if (record && record.workspace !== undefined) {
                    const { workspace, ...rest } = record;
                    return rest;
                }
                return record;
            });
        } catch {
            return [];
        }
    }

    /** Returns whether the write happened, for a caller that does more on success. */
    writeCatalog(records: SessionInfo[]): boolean {
        try {
            writeAtomic(this.catalogPath, records);
            return true;
        } catch {
            return false;
        }
    }

    readActiveId(): string | null {
        try {
            const id = fs.readFileSync(this.activeIdPath, 'utf-8').trim();
            return id || null;
        } catch {
            return null;
        }
    }

    writeActiveId(sessionId: string): boolean {
        try {
            writeAtomicText(this.activeIdPath, sessionId);
            return true;
        } catch {
            return false;
        }
    }
}

/** Where the two tree files live: beside the agent's tabs, in its id folder. */
export function treePathsFor(historyDir: string, sessionProfileId: string): TreePaths {
    const dir = profileDir(historyDir, sessionProfileId);
    return {
        current: path.join(dir, 'tree-current.json'),
        passive: path.join(dir, 'tree-passive.json'),
    };
}

/**
 * Writes the two tree files. Called after every change that can move a tab or a project.
 *
 * The tree is built in `workSpace.ts`; this is the half that knows the data home, so a refresh is
 * temp-file-and-rename like every other write of ours (ST1). It also remembers which sessions were
 * told the files exist, because that is a fact about what was written, not about the tree.
 */
export class TreeStore {
    /** Sessions already told which files hold their tree, per session and workspace. */
    private readonly _announced = new Set<string>();

    /**
     * @param _input What to write, read at the moment of the write — the tree is assembled from
     * three owners (identity, projects, tabs) and this is the one place that asks all of them.
     */
    constructor(
        private readonly _historyDir: string,
        private readonly _log: (line: string) => void,
        private readonly _input: () => TreeInput,
    ) {}

    /**
     * The block that names the two files, once per session and workspace.
     *
     * A reload empties the set, a session switch or a workspace switch changes the key, so each of
     * those is told again. Nothing to point at means no block — and no introduction burned.
     */
    noticeBlock(sessionProfileId: string, workspaceId: string, sessionId: string): string {
        if (!sessionProfileId || !workspaceId || !sessionId) {
            return '';
        }
        const key = `${sessionId}|${workspaceId}`;
        if (this._announced.has(key)) {
            return '';
        }
        this._announced.add(key);
        return treeNoticeBlock(treePathsFor(this._historyDir, sessionProfileId));
    }

    /**
     * Refresh `current`, and rotate the old one into `passive` when the window changed workspace.
     *
     * No profile or no workspace means there is nothing to name a tree after; say so rather than
     * writing a file that claims an empty workspace. A tree that has not changed is not rewritten:
     * a catalog refresh fires this often, and a file that keeps its bytes keeps its mtime.
     */
    refresh(): void {
        const input = this._input();
        if (!input.sessionProfileId) {
            this._log('Tree cache: no profile bound, nothing written');
            return;
        }
        if (!input.workspaceId) {
            this._log('Tree cache: this window has no workspace, nothing written');
            return;
        }
        const paths = treePathsFor(this._historyDir, input.sessionProfileId);
        const snapshot = buildTreeSnapshot(input);
        const previous = this._previous(paths.current);
        const before = previous && previous.workspace ? previous.workspace.id : '';
        if (before && before !== input.workspaceId) {
            // The window moved: what it had in the other workspace is the reference from here on.
            try {
                fs.copyFileSync(paths.current, paths.passive);
                this._log(`Tree cache: ${before} -> passive, ${input.workspaceId} -> current`);
            } catch (error) {
                this._log(`Tree cache: could not keep the previous tree: ${String(error)}`);
            }
        } else if (previous && sameTree(previous, snapshot)) {
            return;
        }
        writeAtomic(paths.current, snapshot);
    }

    private _previous(file: string): TreeSnapshot | undefined {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as TreeSnapshot;
            return parsed && parsed.workspace ? parsed : undefined;
        } catch {
            return undefined;
        }
    }
}

/** Same tree, ignoring when it was written: the only field that changes on every refresh. */
function sameTree(a: TreeSnapshot, b: TreeSnapshot): boolean {
    const strip = (value: TreeSnapshot) => JSON.stringify({ ...value, generatedAt: '' });
    return strip(a) === strip(b);
}
