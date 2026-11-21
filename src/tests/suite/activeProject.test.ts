import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/workspace/sessions';
import type { SessionsHost } from '../../host/workspace/sessions';
import { ProjectStore, TabStore, WorkspaceStore } from '../../host/workspace/store';
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

const tab = (id: string, project?: string, boundTo?: string): SessionInfo => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...(project ? { project } : {}),
    ...(boundTo ? { hermesSessionId: boundTo } : {}),
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
const projectFeature = (store: ProjectStore, workspaces: WorkspaceStore, tabs: SessionInfo[]) => {
    const posted: HostToPane[] = [];
    const host = {
        active: tabs[0]?.id || '',
        post: (msg: HostToPane) => { posted.push(msg); },
        log: () => {},
        tabs: () => tabs,
        saveTabs: () => {},
        activeTabId: () => host.active,
        openWorkspace: () => {},
        currentWorkspacePath: () => '',
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    } as ProjectsHost & { active: string };
    return { projects: new Projects(workspaces, store, host), host, posted };
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

    it('a tab click, a tab that leaves this window and a profile rebind all report the move', () => {
        const { session, changed } = setup();
        session.activate('b');
        assert.strictEqual(changed.length, 1, 'a click on another tab');
        session.setTabs([tab('a')]);
        assert.strictEqual(changed.length, 2, 'the active tab moved to another window');
        session.bindProfileScope('another-scope');
        assert.strictEqual(changed.length, 3, 'another profile is another tab list');
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
        const feature = projectFeature(store, workspaces, tabs);
        return { alpha, beta, tabs, ...feature };
    };

    it('starts on the active tab\'s project', () => {
        const { alpha, projects } = setup();
        assert.strictEqual(projects.activeProject, alpha.id);
    });

    it('moves with the tab: another project, then the plane', () => {
        const { alpha, beta, host, projects, posted } = setup();
        host.active = 'b';
        projects.syncActiveProject();
        assert.strictEqual(projects.activeProject, beta.id, 'the new tab\'s folder');

        host.active = 'c';
        projects.syncActiveProject();
        assert.strictEqual(projects.activeProject, '', 'a tab on the plane is the root');

        // The pane is told with the list it draws, in the order the moves happened, and the
        // folder the window started in is never announced — it was the start value, not a move.
        const told = posted.filter(msg => msg.type === 'projectList').map(msg => (msg as { activeProjectId: string }).activeProjectId);
        assert.deepStrictEqual(told, [beta.id, '']);
        assert.ok(!told.includes(alpha.id), 'never the folder it left');
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
});
