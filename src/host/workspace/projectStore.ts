import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '../../shared/chat';
import { profileDir } from '../cache/profileStorage';
import { mintId, writeAtomic, WorkspaceStore } from './workSpace';

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
 * - Ids are minted once and kept. `mintId()` is base36 time plus four characters; a UUID is a
 *   drop-in replacement if two processes ever mint in the same millisecond.
 * - Both files are read as unknown-tolerant: an unknown key is carried through a write, never
 *   dropped, which is the same courtesy a migration backfill needs.
 */

export function projectsPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'projects.json');
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
        private _scopeKey: string,
        private readonly _workspaces: WorkspaceStore,
    ) {}

    get path(): string {
        return projectsPathFor(this._historyDir, this._scopeKey);
    }

    setScope(scopeKey: string): void {
        this._scopeKey = scopeKey;
    }

    /** Which profile's file this store reads: empty until a profile is bound. */
    get scopeKey(): string {
        return this._scopeKey;
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
            ? new WorkspaceStore(this._historyDir).takeProjects() as Array<Project & { workspace?: string }>
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
