import type * as vscode from 'vscode';
import type { HostToPane } from '../../shared/webview';
import type { Project, SessionInfo } from '../../shared/chat';
import { WorkspaceIdentity, WorkspaceStore } from './workSpace';
import { ProjectStore } from './projectStore';
import {
    dropProjectFromTabs, moveTabIntoProject, moveTabToProject, moveTabToWorkspace,
    projectsInWorkspace, workspaceOwnsCwd,
} from './projectRules';

/**
 * The project group: the projects named against this window's workspace, and which tab sits in one.
 *
 * The tab is the unit — a tab carries `workspaceId` (where it was opened, the field a single-tab
 * move rewrites) and `project` (the group it was moved into). Nothing here knows about transcripts.
 *
 * A project belongs to a workspace *and* an agent: it groups tabs, the tab index is per profile, so
 * the projects are per profile while the workspace list stays shared.
 */

/** What the component needs from the app. */
export interface ProjectsHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    /** The tab index it edits. */
    tabs(): SessionInfo[];
    /** Write that index back: the catalog and the active id. */
    saveTabs(next: SessionInfo[], options?: { keepActive?: boolean }): void;
    /** Which tab the pane is on: only its move takes the window with it. */
    activeTabId(): string;
    /** Open another workspace in this window. A reload, and the only way to follow a tab. */
    openWorkspace(workspacePath: string): void;
}

/** What the router reaches: one member on `RouterHost`, not five. */
export interface ProjectCommands {
    createProject(name: string): void;
    renameProject(projectId: string, name: string): void;
    deleteProject(projectId: string): void;
    moveTabToProject(tabId: string, projectId: string): void;
    moveTabToWorkspace(tabId: string, workspace: string): void;
}

/**
 * The component: the workspace registry, the projects named against it, and the tab membership
 * that ties a tab to one.
 *
 * Construction takes the storage directory and one port; everything it does to the app goes
 * through that port, so nothing in here names `App`.
 */
export class Projects {
    private readonly _store: WorkspaceStore;
    private readonly _agentProjects: ProjectStore;
    private readonly _identity: WorkspaceIdentity;
    readonly commands: ProjectCommands;

    constructor(historyDir: string, scopeKey: string, private readonly _host: ProjectsHost) {
        this._store = new WorkspaceStore(historyDir);
        this._agentProjects = new ProjectStore(historyDir, scopeKey, this._store);
        // Adopt the shared file's list now: `start()` registers the workspace moments later, and
        // that write must never be the thing that decides whether the projects survive.
        this._agentProjects.projects();
        this._identity = new WorkspaceIdentity({
            log: line => this._host.log(line),
            onWorkspace: value => {
                this._store.register(value);
                this.postList();
            },
        });
        this.commands = {
            createProject: name => this._createProject(name),
            renameProject: (projectId, name) => this._renameProject(projectId, name),
            deleteProject: projectId => this._deleteProject(projectId),
            moveTabToProject: (tabId, projectId) => {
                const project = this._agentProjects.projects().find(entry => entry.id === projectId);
                const next = project
                    ? moveTabIntoProject(this._host.tabs(), tabId, project)
                    : moveTabToProject(this._host.tabs(), tabId, '');
                this._writeTabs(next, `Tab ${tabId} -> project ${projectId || '(plane)'}`);
            },
            moveTabToWorkspace: (tabId, workspaceId) => this._moveTabToWorkspace(tabId, workspaceId),
        };
    }

    /**
     * Record the window it opened in, then every change to its folders.
     *
     * Nothing is posted here: at activation no webview surface exists yet, so it belongs in the
     * pane's ready replay (`_onWebviewReady`).
     */
    start(): vscode.Disposable {
        return this._identity.start();
    }

    /** The workspace this window is, as the path VS Code gives us. */
    current(): string {
        return this._identity.current();
    }

    /** Which profile's projects file this component is writing to. */
    get scopeKey(): string {
        return this._agentProjects.scopeKey;
    }

    /** The window's workspace id: what a tab, a project and the pane refer to. */
    currentId(): string {
        return this._store.entryFor(this._identity.current())?.id || '';
    }

    /** Every workspace id this editor knows: a tab pointing anywhere else points nowhere. */
    knownWorkspaceIds(): string[] {
        return this._store.read().map(workspace => workspace.id);
    }

    /** The id of the workspace whose folder holds this cwd, if this editor has opened it. */
    workspaceIdForCwd(cwd: string | undefined): string {
        if (!cwd) {
            return '';
        }
        const entry = this._store.read().find(workspace => workspaceOwnsCwd(workspace.path, cwd));
        return entry ? entry.id : '';
    }

    /** The projects this window shows: the list the pane gets, for a reader that is not the pane. */
    projectsInWindow(): Project[] {
        return projectsInWorkspace(this._agentProjects.projects(), this.currentId());
    }

    /** The agent switched: its projects are a different file, beside that profile's tabs. */
    bindProfileScope(scopeKey: string): void {
        this._agentProjects.setScope(scopeKey);
        this.postList();
    }

    /**
     * Tell the pane what exists: the workspaces this editor opened, and this window's projects.
     *
     * The workspaces are shared, so all of them travel. The projects are not: only the ones named
     * against this window's workspace, or they would appear in every window of the agent.
     */
    postList(): void {
        this._host.post({
            type: 'projectList',
            workspaces: this._store.read(),
            projects: this.projectsInWindow(),
        });
    }

    /**
     * Make a project, but only from a window where the chain it needs actually exists.
     *
     * A project is a row that names a workspace id and lives in a profile's file. When any link in
     * that chain is missing — no workspace open, a workspace this window never registered, no
     * profile bound — the create used to write a record nothing could point at, or nothing at all,
     * and the pane showed the same nothing either way. Each precondition is named instead, and the
     * write is read back so a silent failure cannot pass as success.
     */
    private _createProject(name: string): void {
        const workspacePath = this._identity.current();
        if (!workspacePath) {
            this._refuse('No workspace is open in this window, so a project has nothing to belong to.');
            return;
        }
        const workspace = this._store.entryFor(workspacePath);
        if (!workspace || !workspace.id) {
            this._refuse('This window\'s workspace is not registered yet — reload the window.');
            return;
        }
        if (!this._agentProjects.scopeKey) {
            this._refuse('No agent profile is bound yet — reload the window.');
            return;
        }
        const project = this._agentProjects.create(name, workspace.id);
        if (!project) {
            this._refuse('A project needs a name.');
            return;
        }
        // Read back from the store the file was written to: a write that did not land is not a project.
        const stored = this._agentProjects.projects();
        if (!stored.some(entry => entry.id === project.id)) {
            this._refuse(`The project was not saved to ${this._agentProjects.path} — reload the window.`);
            return;
        }
        const listed = projectsInWorkspace(stored, workspace.id).some(entry => entry.id === project.id);
        this._host.log(`Project "${project.name}" in workspace ${workspace.id}`);
        this.postList();
        if (!listed) {
            this._refuse('The project was saved but this window does not list it — reload the window.');
        }
    }

    /** Say why a create did not happen: in the rail, where the button is, and in the log. */
    private _refuse(message: string): void {
        this._host.log(`Project: ${message}`);
        this._host.post({ type: 'projectNotice', level: 'error', message });
    }

    private _renameProject(projectId: string, name: string): void {
        const project = this._agentProjects.rename(projectId, name);
        this._host.log(project
            ? `Project ${projectId} is now "${project.name}"`
            : 'Project rename: blank name or no change');
        this.postList();
    }

    private _deleteProject(projectId: string): void {
        if (!this._agentProjects.delete(projectId)) {
            this._host.log(`Project ${projectId}: nothing to delete`);
            return;
        }
        // The project goes, its tabs stay: a group is a view, not an owner.
        this._writeTabs(dropProjectFromTabs(this._host.tabs(), projectId),
            `Project ${projectId} removed; its tabs are back on the plane`);
        this.postList();
    }

    /**
     * Move a tab to another workspace — and, when it is the tab on screen, take the window with it.
     *
     * A tab that is not the active one just changes its tag and leaves this window's slice. The
     * active one would leave the pane pointing at a tab this window no longer owns, so the window
     * follows it: VS Code has no way to move a window except by opening the other workspace in it,
     * which is a reload. Everything before that write is done first, so the tab is already in the
     * other window's slice when it comes back up.
     */
    private _moveTabToWorkspace(tabId: string, workspaceId: string): void {
        const wasActive = this._host.activeTabId() === tabId;
        const next = moveTabToWorkspace(this._host.tabs(), tabId, workspaceId);
        if (next === this._host.tabs()) {
            return;
        }
        this._host.saveTabs(next, { keepActive: wasActive });
        this._host.log(`Tab ${tabId} -> workspace ${workspaceId}${wasActive ? ' (following it)' : ''}`);
        if (!wasActive) {
            return;
        }
        const target = this._store.read().find(workspace => workspace.id === workspaceId);
        if (!target) {
            this._host.log(`Follow: no workspace with id ${workspaceId} is registered`);
            return;
        }
        this._host.openWorkspace(target.path);
    }

    private _writeTabs(next: SessionInfo[], message: string): void {
        if (next === this._host.tabs()) {
            return;
        }
        this._host.saveTabs(next);
        this._host.log(message);
    }
}
