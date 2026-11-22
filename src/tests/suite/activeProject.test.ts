import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/workspace/sessions';
import type { SessionsHost } from '../../host/workspace/sessions';
import { ProjectStore, ProfileWorkspaceStore, TabStore, WorkspaceStore } from '../../host/workspace/store';
import { Projects } from '../../host/workspace/projectGrouped';
import type { ProjectsHost } from '../../host/workspace/projectGrouped';
import { TabLifecycle } from '../../host/workspace/lifecycle';
import type { TabLifecycleHost } from '../../host/workspace/lifecycle';
import type { HostToPane } from '../../shared/webview';
import type { SessionInfo } from '../../shared/chat';

/**
 * The active project: the folder the pane is working in, the way a file explorer has a current
 * folder. It is what `+` opens a new chat in, and what the folding rule keeps open.
 *
 * Two bugs came from its absence: a blank chat could not be sent from (the send check asked for a
 * tab record that only the first turn writes), and `+` could only ever land in the project of the
 * tab it replaced.
 */

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'active-project-'));

const tab = (id: string, project?: string, boundTo?: string, workspaceId?: string): SessionInfo => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...(project ? { project } : {}),
    ...(boundTo ? { hermesSessionId: boundTo } : {}),
    ...(workspaceId ? { workspaceId } : {}),
});

/** The sessions port, with the one member this feature adds to it recorded rather than acted on. */
const sessionsHost = (posted: HostToPane[] = [], changed: string[] = []): SessionsHost => ({
    post: (msg: HostToPane) => { posted.push(msg); },
    log: () => {},
    updatePanelTitle: () => {},
    modelLabel: () => undefined,
    currentWorkspaceId: () => '',
    knownWorkspaceIds: () => [],
    activeChanged: () => { changed.push('active'); },
});

/** A window's project feature over real stores: the lists are files, the port is a fake. */
const projectFeature = (
    store: ProjectStore,
    workspaces: WorkspaceStore,
    tabs: SessionInfo[],
    home: string,
    workspacePath = '',
) => {
    const posted: HostToPane[] = [];
    const host = {
        active: tabs[0]?.id || '',
        path: workspacePath,
        post: (msg: HostToPane) => { posted.push(msg); },
        log: () => {},
        tabs: () => tabs,
        saveTabs: () => {},
        activeTabId: () => host.active,
        openWorkspace: () => {},
        currentWorkspacePath: () => host.path,
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    } as ProjectsHost & { active: string; path: string };
    // The pair is saved per workspace in this profile's row table, exactly as the active tab is.
    const profileWorkspaces = new ProfileWorkspaceStore(home, () => 'scope');
    return { projects: new Projects(workspaces, store, host, profileWorkspaces), host, posted, profileWorkspaces };
};

const lifecycleHost = (
    session: Sessions,
    activeProject: () => string,
    posted: HostToPane[] = [],
): TabLifecycleHost => ({
    acp: () => undefined,
    session,
    post: (msg: HostToPane) => { posted.push(msg); },
    postTo: (_surface: unknown, msg: HostToPane) => { posted.push(msg); },
    log: () => {},
    resolveCwd: () => '',
    resolveCwdFor: () => '',
    activeProject,
    sessionProfileId: () => 'scope',
    attachments: { hydrateImages: () => [] } as unknown as TabLifecycleHost['attachments'],
    promptSessionId: () => undefined,
    detachActivePrompt: async () => {},
    otherSessionIsPrompting: () => false,
    syncModelStateForCurrentSession: async () => {},
    syncPromptUiIfReturningToOwner: () => {},
    snapshotModelFromProfile: () => {},
    saveCatalog: () => true,
    saveCurrent: () => {},
    ensureRegistered: () => {},
    postSessionList: () => {},
    postHistoryState: () => {},
    dropHistoryStage: () => {},
    activate: () => {},
    enqueueChatOp: () => {},
    openSessionSurface: () => {},
    workspaceState: { get: () => undefined, update: () => Promise.resolve() },
    debugTabSwitch: () => false,
} as unknown as TabLifecycleHost);

describe('the active project: what a new chat opens in', () => {
    it('a window with no tab has no chat to send in, and `+` mints one in the active project', async () => {
        const home = dir();
        const session = new Sessions(home, 'scope', sessionsHost(), new TabStore(home, 'scope'));
        session.activeId = '';
        session.tabs = [];
        assert.strictEqual(session.hasOpenChat(), false, 'an empty window has nothing open');

        // The folder the pane is working in — a project header was clicked before `+`.
        const lifecycle = new TabLifecycle(lifecycleHost(session, () => 'p1'));
        await lifecycle.createBlankTab();
        assert.strictEqual(session.hasOpenChat(), true, 'the blank chat `+` minted is a chat');
        assert.strictEqual(session.tabs.length, 0, 'and it is not a record yet');

        // The first turn is what writes the record; it is born in the project the chat opened in.
        session.saveMessage('user', 'hello');
        session.ensureRegistered();
        assert.strictEqual(session.tabs.length, 1);
        assert.strictEqual(session.tabs[0].project, 'p1', 'the tab lands in the folder `+` was pressed in');
    });

    it('with the root active, `+` opens a chat in no project at all', async () => {
        const home = dir();
        const session = new Sessions(home, 'scope', sessionsHost(), new TabStore(home, 'scope'));
        session.activeId = '';
        session.tabs = [];
        const lifecycle = new TabLifecycle(lifecycleHost(session, () => ''));
        await lifecycle.createBlankTab();
        session.saveMessage('user', 'hello');
        session.ensureRegistered();
        assert.strictEqual(session.tabs.length, 1);
        assert.strictEqual(session.tabs[0].project, undefined, 'the plane is a place, not a project');
    });

    it('closing the last tab leaves no chat to send in', () => {
        const home = dir();
        const session = new Sessions(home, 'scope', sessionsHost(), new TabStore(home, 'scope'));
        session.activeId = 'the-tab-that-left';
        session.tabs = [];
        assert.strictEqual(session.hasOpenChat(), false, 'the id still names the tab that left');
    });
});

describe('the active project: one setter, so no move can go unreported', () => {
    const setup = () => {
        const home = dir();
        const changed: string[] = [];
        const session = new Sessions(home, 'scope', sessionsHost([], changed), new TabStore(home, 'scope'));
        session.tabs = [tab('a', 'p1'), tab('b', 'p2')];
        session.setActiveId('a');
        changed.length = 0;
        return { session, changed };
    };

    it('a tab click and a tab that leaves this window report the move; a rebind restores instead', () => {
        const { session, changed } = setup();
        session.activate('b');
        assert.strictEqual(changed.length, 1, 'a click on another tab');
        session.setTabs([tab('a')]);
        assert.strictEqual(changed.length, 2, 'the active tab moved to another window');
        // A profile rebind restores a tab the same way init does: the saved pair of that profile
        // is the truth, so the restored tab must not announce itself as a change.
        session.bindProfileScope('another-scope');
        assert.strictEqual(changed.length, 2, 'a restored tab is not a tab change');
    });

    it('`+` is the exception: it moves the id and says nothing, because the folder stays', () => {
        const { session, changed } = setup();
        session.setActiveId('a-brand-new-chat', { keepActiveProject: true });
        assert.strictEqual(changed.length, 0);
    });
});

describe('the active project: it follows the tab, and never the old one', () => {
    const setup = () => {
        const home = dir();
        const workspaces = new WorkspaceStore(home);
        const store = new ProjectStore(home, 'scope', workspaces);
        const alpha = store.create('Alpha', '') as { id: string };
        const beta = store.create('Beta', '') as { id: string };
        const tabs = [tab('a', alpha.id), tab('b', beta.id), tab('c')];
        const feature = projectFeature(store, workspaces, tabs, home);
        return { alpha, beta, tabs, ...feature };
    };

    it('starts on the active tab\'s project', () => {
        const { alpha, projects } = setup();
        assert.strictEqual(projects.activeProject, alpha.id);
    });

    it('moves with the tab: another project, then the plane', () => {
        const { alpha, beta, host, projects, posted } = setup();
        // A window publishes its start value first, as the ready replay does.
        projects.postList();
        posted.length = 0;

        host.active = 'b';
        projects.syncActiveProject();
        assert.strictEqual(projects.activeProject, beta.id, 'the new tab\'s folder');
        assert.strictEqual(projects.otherOpenProject, alpha.id, 'and the folder it left stays open');

        host.active = 'c';
        projects.syncActiveProject();
        assert.strictEqual(projects.activeProject, '', 'a tab on the plane is the root');
        assert.strictEqual(projects.otherOpenProject, beta.id, 'the folder before the root keeps its slot');

        // The pane is told with the list it draws, in the order the moves happened, and the
        // folder the window started in is never announced — it was the start value, not a move.
        assert.deepStrictEqual(pairOf(posted), [beta.id, alpha.id, '', beta.id]);
        const told = posted.filter(msg => msg.type === 'projectList').map(msg => (msg as { activeProjectId: string }).activeProjectId);
        assert.deepStrictEqual(told, [beta.id, '']);
    });

    it('a value this window does not list is the root', () => {
        const { alpha, projects } = setup();
        projects.setActiveProject(alpha.id);
        projects.setActiveProject('a-project-from-another-window');
        assert.strictEqual(projects.activeProject, '');
    });

    it('a click on a header is what a header click sets, and it is announced once', () => {
        const { beta, projects, posted } = setup();
        posted.length = 0;
        projects.setActiveProject(beta.id);
        assert.strictEqual(projects.activeProject, beta.id);
        projects.setActiveProject(beta.id);
        assert.strictEqual(posted.length, 1, 'the same value again says nothing new');
    });

    it('the folder that was working becomes the other one open, and the root counts as one', () => {
        const { alpha, beta, projects, posted } = setup();
        posted.length = 0;

        // X active → click the root: the pair is the root, then X.
        projects.setActiveProject('');
        assert.deepStrictEqual(pairOf(posted), ['', alpha.id]);

        // → click Y: the pair is Y, then the root it just left — X is not kept.
        projects.setActiveProject(beta.id);
        assert.deepStrictEqual(pairOf(posted), ['', alpha.id, beta.id, '']);
        assert.strictEqual(projects.otherOpenProject, '', 'only Y is open beside the root');
    });
});

/** The pair as the pane was told it, per projectList post: active then other. */
const pairOf = (posted: HostToPane[]): string[] =>
    posted
        .filter(msg => msg.type === 'projectList')
        .flatMap(msg => {
            const list = msg as { activeProjectId: string; otherOpenProjectId: string };
            return [list.activeProjectId, list.otherOpenProjectId];
        });

describe('the pair is saved per workspace', () => {
    const windowOn = (home: string, workspacePath: string) => {
        const workspaces = new WorkspaceStore(home);
        const workspace = workspaces.register(workspacePath)[0];
        const store = new ProjectStore(home, 'scope', workspaces);
        return { workspaces, workspace, store };
    };

    it('a saved pair is restored as it was, even when the active tab sits in another folder', () => {
        const home = dir();
        const first = windowOn(home, '/work/one');
        const x = first.store.create('X', first.workspace.id) as { id: string };
        const y = first.store.create('Y', first.workspace.id) as { id: string };
        const z = first.store.create('Z', first.workspace.id) as { id: string };

        // One window works in X, then in Y: that pair is what it saves.
        const before = projectFeature(first.store, first.workspaces, [tab('a', z.id)], home, '/work/one');
        before.projects.postList();
        before.projects.setActiveProject(x.id);
        before.projects.setActiveProject(y.id);
        assert.deepStrictEqual(before.profileWorkspaces.openProjects(first.workspace.id), [y.id, x.id]);

        // A reload: the tab on screen is in Z, and the saved pair still wins.
        const after = projectFeature(first.store, first.workspaces, [tab('a', z.id)], home, '/work/one');
        after.projects.postList();
        assert.strictEqual(after.projects.activeProject, y.id, 'the folder the user was working in');
        assert.strictEqual(after.projects.otherOpenProject, x.id, 'and the one before it');
    });

    it('a workspace with no saved pair falls back to the active tab, and the other slot is the root', () => {
        const home = dir();
        const { workspaces, workspace, store } = windowOn(home, '/work/two');
        const alpha = store.create('Alpha', workspace.id) as { id: string };
        const feature = projectFeature(store, workspaces, [tab('a', alpha.id)], home, '/work/two');
        feature.projects.postList();
        assert.strictEqual(feature.projects.activeProject, alpha.id);
        assert.strictEqual(feature.projects.otherOpenProject, '');
        assert.deepStrictEqual(pairOf(feature.posted), [alpha.id, '']);
    });

    it('a project deleted while it was in the pair clamps to the root', () => {
        const home = dir();
        const { workspaces, workspace, store } = windowOn(home, '/work/three');
        const x = store.create('X', workspace.id) as { id: string };
        const y = store.create('Y', workspace.id) as { id: string };
        const before = projectFeature(store, workspaces, [tab('a', y.id)], home, '/work/three');
        before.projects.postList();
        before.projects.setActiveProject(x.id);
        before.projects.setActiveProject(y.id);

        // X is gone by the time the window comes back.
        store.delete(x.id);
        const after = projectFeature(store, workspaces, [tab('a', y.id)], home, '/work/three');
        after.projects.postList();
        assert.strictEqual(after.projects.activeProject, y.id);
        assert.strictEqual(after.projects.otherOpenProject, '', 'the deleted folder is the root');
    });
});

/**
 * A window wired the way `app.ts` wires it: every change of the active tab reaches the project
 * feature (`activeChanged` → `syncActiveProject`), and both features read their per-workspace
 * rows from the same store.
 */
const wiredWindow = (home: string, workspacePath: string) => {
    const workspaces = new WorkspaceStore(home);
    const workspace = workspaces.register(workspacePath)[0];
    const store = new ProjectStore(home, 'scope', workspaces);
    const posted: HostToPane[] = [];
    let session!: Sessions;
    const profileWorkspaces = new ProfileWorkspaceStore(home, () => session.sessionProfileId);
    const projects = new Projects(workspaces, store, {
        post: (msg: HostToPane) => { posted.push(msg); },
        log: () => {},
        tabs: () => session.tabs,
        saveTabs: (next, options) => session.setTabs(next, options),
        activeTabId: () => session.activeId,
        openWorkspace: () => {},
        currentWorkspacePath: () => workspacePath,
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    }, profileWorkspaces);
    session = new Sessions(home, 'scope', {
        post: (msg: HostToPane) => { posted.push(msg); },
        log: () => {},
        updatePanelTitle: () => {},
        modelLabel: () => undefined,
        currentWorkspaceId: () => workspace.id,
        knownWorkspaceIds: () => [workspace.id],
        activeChanged: () => projects.syncActiveProject(),
    }, new TabStore(home, 'scope'));
    // The order `app.ts` uses: init restores the tab, and the first post reads the saved pair.
    return {
        home, workspaces, workspace, store, profileWorkspaces, projects, session, posted,
        start: () => { session.init(); projects.postList(); },
    };
};

describe('a real start: restoring a tab is not choosing a folder', () => {
    const withSavedPair = (workspacePath: string) => {
        const home = dir();
        const w = wiredWindow(home, workspacePath);
        const x = w.store.create('X', w.workspace.id) as { id: string };
        const y = w.store.create('Y', w.workspace.id) as { id: string };
        const z = w.store.create('Z', w.workspace.id) as { id: string };
        // What the last window left behind: the pair it worked in, and a tab in Z.
        const tabs = new TabStore(home, 'scope');
        tabs.writeCatalog([tab('z1', z.id, undefined, w.workspace.id)]);
        tabs.writeActiveId(w.workspace.id, 'z1');
        w.profileWorkspaces.setOpenProjects(w.workspace.id, y.id, x.id);
        return { home, w, x, y, z };
    };

    it('a saved pair is restored, and the restored tab does not overwrite it', () => {
        const { w, x, y } = withSavedPair('/work/start');
        w.start();
        assert.strictEqual(w.session.activeId, 'z1', 'the tab the window was on');
        assert.strictEqual(w.projects.activeProject, y.id, 'the folder the pair names');
        assert.strictEqual(w.projects.otherOpenProject, x.id);
        assert.deepStrictEqual(w.profileWorkspaces.openProjects(w.workspace.id), [y.id, x.id], 'and the file still says so');
        assert.deepStrictEqual(pairOf(w.posted), [y.id, x.id], 'nothing named Z on the way');
    });

    it('a profile rebind restores that profile\'s pair, not the tab it restored', () => {
        const { home, w } = withSavedPair('/work/rebind');
        const other = new ProjectStore(home, 'other', w.workspaces);
        const x2 = other.create('X2', w.workspace.id) as { id: string };
        const y2 = other.create('Y2', w.workspace.id) as { id: string };
        const z2 = other.create('Z2', w.workspace.id) as { id: string };
        const otherTabs = new TabStore(home, 'other');
        otherTabs.writeCatalog([tab('o1', z2.id, undefined, w.workspace.id)]);
        otherTabs.writeActiveId(w.workspace.id, 'o1');
        new ProfileWorkspaceStore(home, () => 'other').setOpenProjects(w.workspace.id, y2.id, x2.id);

        w.start();
        // The rebind, in the order the connection does it: the tab first, then the projects.
        w.session.bindProfileScope('other');
        w.projects.bindProfileScope('other');

        assert.strictEqual(w.session.activeId, 'o1', 'the restored tab of that profile');
        assert.strictEqual(w.projects.activeProject, y2.id, 'the pair that profile saved');
        assert.strictEqual(w.projects.otherOpenProject, x2.id);
        assert.deepStrictEqual(w.profileWorkspaces.openProjects(w.workspace.id), [y2.id, x2.id]);
    });

    it('with nothing saved, the start takes the restored tab\'s folder and writes no pair', () => {
        const home = dir();
        const w = wiredWindow(home, '/work/fresh');
        const z = w.store.create('Z', w.workspace.id) as { id: string };
        const tabs = new TabStore(home, 'scope');
        tabs.writeCatalog([tab('z1', z.id, undefined, w.workspace.id)]);
        tabs.writeActiveId(w.workspace.id, 'z1');

        w.start();
        assert.strictEqual(w.projects.activeProject, z.id);
        assert.strictEqual(w.projects.otherOpenProject, '');
        assert.strictEqual(w.profileWorkspaces.openProjects(w.workspace.id), undefined, 'nothing was written');
    });
});

/**
 * The contract is what the host and the pane exchange. A row the host keeps for itself — the two
 * profile picks are the first — must not ride along because it happens to be in the same object.
 */
describe('the project list: the pane is told the workspace, not the host\'s row', () => {
    it('carries exactly id, path and lastSeen, even when the stored row holds both picks', () => {
        const home = dir();
        const w = wiredWindow(home, '/work/public');
        w.workspaces.setSelection('/work/public', 'primary', 'kitt');
        w.workspaces.setSelection('/work/public', 'secondant', 'dev');
        assert.deepStrictEqual(w.workspaces.entryFor('/work/public')?.primarySelection, 'kitt', 'the row does hold them');

        w.posted.length = 0;
        w.projects.postList();

        const list = w.posted.find(msg => msg.type === 'projectList') as Extract<HostToPane, { type: 'projectList' }>;
        assert.strictEqual(list.workspaces.length, 1);
        assert.deepStrictEqual(Object.keys(list.workspaces[0]).sort(), ['id', 'lastSeen', 'path']);
    });
});

