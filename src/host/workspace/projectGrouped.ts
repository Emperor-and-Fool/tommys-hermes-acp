import type { HostToPane } from '../../shared/webview';
import type { Project, SessionInfo } from '../../shared/chat';
import { moveTabToWorkspace, WorkspaceIdentity } from './workSpace';
import type { WorkspaceSubscription } from './workSpace';
import { ProjectStore, WorkspaceStore } from './store';

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
    /** Which window this is: the editor answers, and the feature never asks it directly (F6). */
    currentWorkspacePath(): string;
    /** Told when the window's folders change. */
    onDidChangeWorkspaceFolders(handler: () => void): WorkspaceSubscription;
}

/** What the router reaches: one member on `RouterHost`, not five. */
export interface ProjectCommands {
    createProject(name: string): void;
    renameProject(projectId: string, name: string): void;
    deleteProject(projectId: string): void;
    moveTabToProject(tabId: string, projectId: string): void;
    moveTabToWorkspace(tabId: string, workspace: string): void;
    /** The folder the pane is working in, or the plane with ''. A click, never a derivation. */
    setActiveProject(projectId: string): void;
}

/**
 * Put a tab in a project, or back on the plane when `projectId` is empty.
 *
 * The value is a project id, not a name: a rename must not move the tabs that belong to it.
 */
export function moveTabToProject(tabs: SessionInfo[], tabId: string, projectId: string): SessionInfo[] {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0 || (tabs[index].project || '') === projectId) {
        return tabs;
    }
    const next = tabs.slice();
    const record: SessionInfo = { ...tabs[index] };
    if (projectId) {
        record.project = projectId;
    } else {
        delete record.project;
    }
    next[index] = record;
    return next;
}

/**
 * A tab in a project belongs to that project's workspace: the project wins in every evaluation but
 * the explicit "move this tab to a workspace", so the two cannot disagree.
 */
export function moveTabIntoProject(tabs: SessionInfo[], tabId: string, project: Project): SessionInfo[] {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0) {
        return tabs;
    }
    const moved = moveTabToProject(tabs, tabId, project.id);
    const next = moved === tabs ? tabs.slice() : moved;
    const record: SessionInfo = { ...next[index] };
    if (project.workspaceId) {
        record.workspaceId = project.workspaceId;
    }
    if (!project.id) {
        delete record.project;
    }
    next[index] = record;
    return next;
}

/**
 * The projects of one window: a project belongs to a workspace *and* an agent, so this window is
 * handed only the projects named against its own workspace.
 *
 * A project made in a window with no folder or workspace file has no workspace either, and belongs
 * to that window — the empty string matches the empty string, exactly as `tabsInWorkspace` does.
 */
export function projectsInWorkspace(projects: Project[], workspaceId: string): Project[] {
    return projects.filter(project => (project.workspaceId || '') === (workspaceId || ''));
}

/** Every tab a project holds, back on the plane: a group is a view, not an owner. */
export function dropProjectFromTabs(tabs: SessionInfo[], projectId: string): SessionInfo[] {
    return tabs.map(tab => {
        if (tab.project !== projectId) {
            return tab;
        }
        const record: SessionInfo = { ...tab };
        delete record.project;
        return record;
    });
}

/**
 * The component: the workspace registry, the projects named against it, and the tab membership
 * that ties a tab to one.
 *
 * It receives its two stores from the composition root and one port; everything it does to the
 * app goes through that port, so nothing in here names `App` and nothing builds its own store.
 */
export class Projects {
    private readonly _identity: WorkspaceIdentity;
    readonly commands: ProjectCommands;
    /**
     * The project this window is working in, or '' for the plane.
     *
     * Null until something names it, and never persisted: a window starts on the active tab's
     * project, so opening a session opens its folder.
     */
    private _activeProject: string | null = null;

    constructor(
        private readonly _store: WorkspaceStore,
        private readonly _agentProjects: ProjectStore,
        private readonly _host: ProjectsHost,
    ) {
        // Adopt the shared file's list now: `start()` registers the workspace moments later, and
        // that write must never be the thing that decides whether the projects survive.
        this._agentProjects.projects();
        this._identity = new WorkspaceIdentity({
            log: line => this._host.log(line),
            onWorkspace: value => {
                this._store.register(value);
                this.postList();
            },
            currentPath: () => this._host.currentWorkspacePath(),
            onDidChangeFolders: handler => this._host.onDidChangeWorkspaceFolders(handler),
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
            setActiveProject: projectId => this.setActiveProject(projectId),
        };
    }

    /**
     * Record the window it opened in, then every change to its folders.
     *
     * Nothing is posted here: at activation no webview surface exists yet, so it belongs in the
     * pane's ready replay (`_onWebviewReady`).
     */
    start(): WorkspaceSubscription {
        return this._identity.start();
    }

    /** The workspace this window is, as the path VS Code gives us. */
    current(): string {
        return this._identity.current();
    }

    /** Which profile's projects file this component is writing to. */
    get sessionProfileId(): string {
        return this._agentProjects.sessionProfileId;
    }

    /** The window's workspace id: what a tab, a project and the pane refer to. */
    currentId(): string {
        return this._store.entryFor(this._identity.current())?.id || '';
    }

    /** Every workspace id this editor knows: a tab pointing anywhere else points nowhere. */
    knownWorkspaceIds(): string[] {
        return this._store.read().map(workspace => workspace.id);
    }

    /** The projects this window shows: the list the pane gets, for a reader that is not the pane. */
    projectsInWindow(): Project[] {
        return projectsInWorkspace(this._agentProjects.projects(), this.currentId());
    }

    /** The agent switched: its projects are a different file, beside that profile's tabs. */
    bindProfileScope(sessionProfileId: string): void {
        this._agentProjects.setProfile(sessionProfileId);
        // Another profile is another tab list: the active project it had names nothing here.
        this._activeProject = null;
        this.postList();
    }

    /**
     * The project this window is working in, or '' for the plane.
     *
     * The value a reader gets before anything set it is the active tab's project — the state a
     * window starts in, and the reason a click is not needed to begin with.
     */
    get activeProject(): string {
        if (this._activeProject !== null) {
            return this._activeProject;
        }
        return this._projectOfActiveTab();
    }

    /**
     * Set the active project, or the plane with an empty id.
     *
     * A value this window does not list clamps to the plane: a project deleted, or one of another
     * window's, must not leave the state pointing at something no header can show. Nothing is
     * posted for a value that did not change — a tab switch inside one project says nothing new.
     */
    setActiveProject(projectId: string): void {
        const next = this._clampActiveProject(projectId);
        // Compared against the value last posted, never against the derived start value: the
        // derivation reads the active tab, which is the very thing this call may be following.
        if (this._activeProject === next) {
            return;
        }
        this._activeProject = next;
        this._host.log(`Active project: ${next || '(root)'}`);
        this.postList();
    }

    /**
     * The active tab moved (a click, an adopt, a close): the project follows it.
     *
     * This is what makes a tab click behave like a click on a folder in an explorer, and it is
     * why the pane sends no project of its own when the tab is what changed.
     */
    syncActiveProject(): void {
        this.setActiveProject(this._projectOfActiveTab());
    }

    /** The project of the tab on screen: '' when there is no such tab, or it is on the plane. */
    private _projectOfActiveTab(): string {
        const activeId = this._host.activeTabId();
        return this._host.tabs().find(tab => tab.id === activeId)?.project || '';
    }

    private _clampActiveProject(projectId: string): string {
        if (!projectId) {
            return '';
        }
        return this.projectsInWindow().some(project => project.id === projectId) ? projectId : '';
    }

    /**
     * Tell the pane what exists: the workspaces this editor opened, this window's projects, and
     * the one the pane works in.
     *
     * The workspaces are shared, so all of them travel. The projects are not: only the ones named
     * against this window's workspace, or they would appear in every window of the agent. The
     * active project rides this message because it is a property of this list — the pane draws
     * the marker while it draws the groups, so a second message would be a second paint.
     */
    postList(): void {
        // Read once and pin it: the derived start value becomes the state the moment it is posted.
        this._activeProject = this._clampActiveProject(this.activeProject);
        this._host.post({
            type: 'projectList',
            workspaces: this._store.read(),
            projects: this.projectsInWindow(),
            activeProjectId: this.activeProject,
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
        if (!this._agentProjects.sessionProfileId) {
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
