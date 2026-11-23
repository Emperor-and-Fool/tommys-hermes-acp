import { createHash } from 'crypto';
import type { Project, SessionInfo } from '../../shared/chat';

/**
 * The workspace: which one this window is.
 *
 * The registry that persists workspaces is `WorkspaceStore` in `store.ts`, beside the projects and
 * tabs that point at it. What is left here is the identity: the path VS Code says this window is,
 * and the one subscription that records it. A workspace is the same fact for every profile in the
 * window; projects and tabs are per profile, so they are not here.
 *
 * The tab rules that only need a workspace are here too — array in, array out, no file and no
 * editor, so the component, the pane's filters and the tests share one definition of them.
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

/**
 * Move a tab to another workspace.
 *
 * `workspace` is where the tab was opened; ours to rewrite, where `cwd` is Hermes' to report and is
 * overwritten on every catalog read.
 */
export function moveTabToWorkspace(tabs: SessionInfo[], tabId: string, workspaceId: string): SessionInfo[] {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0 || !workspaceId || tabs[index].workspaceId === workspaceId) {
        return tabs;
    }
    const next = tabs.slice();
    next[index] = { ...tabs[index], workspaceId };
    return next;
}

/**
 * This window's slice of the tab index.
 *
 * Ownership is a filter, not a second store: one record set, and a window draws the records whose
 * workspace is its own. A tab with no workspace belongs to a window that has none — a window with
 * no folder and no workspace file — so an empty string matches an untagged tab and nothing else.
 */
export function tabsInWorkspace(tabs: SessionInfo[], workspaceId: string): SessionInfo[] {
    return tabs.filter(tab => (tab.workspaceId || '') === (workspaceId || ''));
}

/**
 * The tree: this window's workspace seen whole — the projects, their tabs in order, the plane
 * underneath and the active session named.
 *
 * Built here, written by `TreeStore` in `store.ts`: the shape is a workspace fact and stays pure,
 * so it can be tested without a file, and only the store touches the data home (ST1).
 */

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
    /** A folder id to its path: the tree says where a tab's root is, and agents read paths. */
    folderPath?: (folderId: string) => string;
    /** Our id for the agent: the folder these files live in, beside that agent's tabs. */
    sessionProfileId: string;
    /** Hermes' name for the agent today. Written into the file: the readers are agents. */
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

/** The snapshot itself. Pure, so the shape can be tested without a workspace or a file. */
export function buildTreeSnapshot(input: TreeInput): TreeSnapshot {
    const row = (tab: SessionInfo): TreeTab => ({
        id: tab.id,
        title: tab.title,
        ...(tab.hermesSessionId ? { hermesSessionId: tab.hermesSessionId } : {}),
        sticky: tab.sticky === true,
        ...(tab.permissionRootFolderId && input.folderPath && input.folderPath(tab.permissionRootFolderId)
            ? { cwd: input.folderPath(tab.permissionRootFolderId) }
            : {}),
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

/**
 * The tree as this window sees it, read at the moment of the write.
 *
 * The id and the tabs are read from the same owner, together. A refresh is fired by a
 * `sessionList` post as often as by a `projectList` one, and on a profile change the two features
 * re-bind their stores one after the other — an id read from the other holder names the wrong
 * folder for the length of one write, which is how one agent's tabs came to sit under another
 * agent's id (found 2026-11-22).
 */
export function treeInputOf(owners: {
    /** The tabs, and the agent whose tabs they are — one owner, so the two cannot disagree. */
    tabs: { sessionProfileId: string; activeId: string; tabsInWindow(): SessionInfo[] };
    /** This window's folders: where it is and what it has open there. */
    projects: { current(): string; currentId(): string; projectsInWindow(): Project[] };
    /**
     * Hermes' name for a profile id, for the readers of the file.
     *
     * Asked with the id the file is written under, not with this window's selection: the selection
     * is moved after the two rebinds, so it still names the previous agent while the first write
     * goes out (2026-11-22, the same moment that put the tabs in the wrong folder).
     */
    agentName(sessionProfileId: string): string;
}): TreeInput {
    const sessionProfileId = owners.tabs.sessionProfileId;
    return {
        sessionProfileId,
        profile: owners.agentName(sessionProfileId),
        workspacePath: owners.projects.current(),
        workspaceId: owners.projects.currentId(),
        activeSessionId: owners.tabs.activeId,
        projects: owners.projects.projectsInWindow(),
        tabs: owners.tabs.tabsInWindow(),
    };
}

/** The two files: `current` is where the window is, `passive` where it was. */
export interface TreePaths {
    current: string;
    passive: string;
}

/**
 * The block that names the two files, for the first turn of a session in a clientworkspace.
 *
 * It rides in front of the user's own text as a separate prompt block, so the transcript shows
 * only what the user typed. Pure: the store that owns the files hands it the paths.
 *
 * It says *clientworkspace*, never *workspace*: Hermes uses that word for the folder it works in,
 * and this block describes the editor window — its projects and tabs — which is a different thing
 * and one the agent must not mistake for its cwd.
 */
export function treeNoticeBlock(paths: TreePaths, notes = ''): string {
    const lines = [
        '<clientworkspace-tree>',
        'The editor extension keeps this window\'s session tree on disk. Read it before asking which',
        'session lives where, and to see the projects, their tabs and the active session:',
        `current (this clientworkspace: projects and tabs, not your working folder): ${paths.current}`,
        `previous clientworkspace: ${paths.passive}`,
        '</clientworkspace-tree>',
    ];
    // Where this agent's own notes are comes from the notes feature; this function only places it.
    // One notice, one "once per session and workspace": two blocks would say the same thing twice,
    // at two different moments.
    if (notes) {
        // The last line closes the whole notice — the tree and the notes — outside both tags: it is
        // about the notice itself, which the agent is told to read and not to remember.
        lines.push('', notes, '', "Repeats each session; don't save to memory.");
    }
    return lines.join('\n');
}

/** All the feature needs from a subscription the editor hands it: drop it again. */
export interface WorkspaceSubscription {
    dispose(): void;
}

/**
 * What the identity needs from the extension (F4, F6).
 *
 * The feature asks the editor which window this is and when that changes; it never reaches into
 * `vscode` itself, so the same feature can run where there is no editor (C2, §12).
 */
export interface WorkspaceIdentityHost {
    log(line: string): void;
    /** The window opened, or its folders changed: the registry records what it now is. */
    onWorkspace(value: string): void;
    /** The path this window is: its workspace file if it has one, else its first root folder. */
    currentPath(): string;
    /** Told when the window's folders change, for as long as the subscription is kept. */
    onDidChangeFolders(handler: () => void): WorkspaceSubscription;
}

/**
 * The window's workspace, plus the one subscription that follows it.
 *
 * A tab is tagged with `current()` at the moment it is registered, so a folder added after the
 * window opened is picked up by the next tab; `start()` keeps the registry in step in between.
 */
export class WorkspaceIdentity {
    constructor(private readonly _host: WorkspaceIdentityHost) {}

    /**
     * The window this is, as one string.
     *
     * The editor is the authority for *which* window this is and answers through the port. It is
     * not the authority for names — it has no project name and hands out no id — so naming stays
     * ours. Empty means a window with no folder and no workspace file: a place of its own.
     */
    current(): string {
        return this._host.currentPath();
    }

    /** Record the window it opened in, then every change to its folders. */
    start(): WorkspaceSubscription {
        this._record('opened');
        return this._host.onDidChangeFolders(() => this._record('changed'));
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
