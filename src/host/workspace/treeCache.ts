/**
 * The tree, mirrored into two files an agent can read: the workspace this window is in now, and
 * the one it was in before.
 *
 * The records (workspaces.json, projects.json, sessions.json) are the truth and they are spread
 * over three files, one of them shared by every window. Reading a tree out of them means filtering
 * by a workspace id you have to know first. These two files are the answer to "where are we, and
 * where were we": one object, projects with their tabs in order, the plane underneath, the active
 * session named.
 *
 * Written whole, one direction — nothing reads them back except a person or an agent. `current` is
 * rewritten on every change to the tree; when the window lands in a different workspace, the file
 * it is about to replace is copied to `passive` first, so `passive` is the previous workspace
 * frozen at the moment it was left.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Project, SessionInfo } from '../../shared/chat';
import { profileDir } from '../cache/profileStorage';
import { writeAtomic } from './workSpace';

/** One tab, as the tree file shows it: enough to name a session and find its way back. */
export interface TreeTab {
    id: string;
    title: string;
    hermesSessionId?: string;
    sticky: boolean;
    cwd?: string;
    updatedAt: number;
}

export interface TreeProject {
    id: string;
    name: string;
    tabs: TreeTab[];
}

export interface TreeSnapshot {
    generatedAt: string;
    profile: string;
    workspace: { id: string; path: string };
    activeSessionId: string;
    projects: TreeProject[];
    /** Tabs that belong to no project of this workspace: the plane. */
    plane: TreeTab[];
}

export interface TreeInput {
    /** The profile scope key: these files are per profile, beside that profile's tabs. */
    profile: string;
    workspacePath: string;
    workspaceId: string;
    activeSessionId: string;
    /** This window's projects, in the order the pane shows them. */
    projects: Project[];
    /** This window's tabs: already filtered to this workspace. */
    tabs: SessionInfo[];
    now?: number;
}

/** The two files. `current` is where the window is, `passive` where it was. */
export function treePathsFor(historyDir: string, scopeKey: string): { current: string; passive: string } {
    const dir = profileDir(historyDir, scopeKey);
    return {
        current: path.join(dir, 'tree-current.json'),
        passive: path.join(dir, 'tree-passive.json'),
    };
}

/** The snapshot itself. Pure, so the shape can be tested without a workspace or a file. */
export function buildTreeSnapshot(input: TreeInput): TreeSnapshot {
    const row = (tab: SessionInfo): TreeTab => ({
        id: tab.id,
        title: tab.title,
        ...(tab.hermesSessionId ? { hermesSessionId: tab.hermesSessionId } : {}),
        sticky: tab.sticky === true,
        ...(tab.cwd ? { cwd: tab.cwd } : {}),
        updatedAt: tab.updatedAt || 0,
    });
    const owned = input.projects.map(project => project.id);
    return {
        generatedAt: new Date(input.now === undefined ? Date.now() : input.now).toISOString(),
        profile: input.profile,
        workspace: { id: input.workspaceId, path: input.workspacePath },
        activeSessionId: input.activeSessionId,
        projects: input.projects.map(project => ({
            id: project.id,
            name: project.name,
            tabs: input.tabs.filter(tab => tab.project === project.id).map(row),
        })),
        // A tab naming a project that is not in this workspace's list is drawn on the plane, which
        // is where the pane draws it too: one rule, two readers.
        plane: input.tabs.filter(tab => !tab.project || owned.indexOf(tab.project) < 0).map(row),
    };
}

/** Writes the two files. Called after every change that can move a tab or a project. */
export class TreeCache {
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
     * The block that names the two files, for the first turn of a session in a workspace.
     *
     * It rides in front of the user's own text as a separate prompt block, so the transcript shows
     * only what the user typed. Once per session and workspace: a reload empties the set, a session
     * switch or a workspace switch changes the key, so each of those is told again.
     */
    noticeBlock(scopeKey: string, workspaceId: string, sessionId: string): string {
        if (!scopeKey || !workspaceId || !sessionId) {
            return '';
        }
        const key = `${sessionId}|${workspaceId}`;
        if (this._announced.has(key)) {
            return '';
        }
        this._announced.add(key);
        const paths = treePathsFor(this._historyDir, scopeKey);
        return [
            '<workspace-tree>',
            'The editor extension keeps this window\'s session tree on disk. Read it before asking which',
            'session lives where, and to see the projects, their tabs and the active session:',
            `current (this workspace): ${paths.current}`,
            `previous workspace: ${paths.passive}`,
            '</workspace-tree>',
        ].join('\n');
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
        if (!input.profile) {
            this._log('Tree cache: no profile bound, nothing written');
            return;
        }
        if (!input.workspaceId) {
            this._log('Tree cache: this window has no workspace, nothing written');
            return;
        }
        const paths = treePathsFor(this._historyDir, input.profile);
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
