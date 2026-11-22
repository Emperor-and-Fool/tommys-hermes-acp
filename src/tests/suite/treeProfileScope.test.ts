/**
 * Which folder the tree files land in.
 *
 * The tree is one object assembled from three owners: the agent's identity, this window's projects
 * and its tabs. `app.ts` composes it through one closure, and `Sessions`/`Projects` each re-bind
 * their own store when the agent changes — the connection re-binds them in turn, and each rebind
 * posts its list, which is what refreshes the tree.
 *
 * Found 2026-11-22: between those two rebinds the id and the tabs came from different holders, so
 * the refresh wrote one agent's tabs under the other agent's id. These tests hold the window to
 * the rule the folder is for (§7: `profiles/<sessionProfileId>/` holds that agent's rows).
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/workspace/sessions';
import type { SessionsHost } from '../../host/workspace/sessions';
import { ProjectStore, ProfileWorkspaceStore, TabStore, TreeStore, WorkspaceStore, treePathsFor } from '../../host/workspace/store';
import { Projects } from '../../host/workspace/projectGrouped';
import type { ProjectsHost } from '../../host/workspace/projectGrouped';
import { treeInputOf } from '../../host/workspace/workSpace';
import type { HostToPane } from '../../shared/webview';
import type { SessionInfo } from '../../shared/chat';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'tree-scope-'));

const tab = (id: string, workspaceId: string): SessionInfo => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    workspaceId,
});

/**
 * A window wired the way `app.ts` wires it: the tree input comes from `treeInputOf` over the real
 * features, and either list post refreshes the tree.
 *
 * `selectedAgent` stands for `resolveTarget().agentName`: the connection writes it after both
 * rebinds, so it is the third read and the last to know.
 */
const wiredWindow = (home: string, workspacePath: string, profileId: string) => {
    const workspaces = new WorkspaceStore(home);
    const workspace = workspaces.register(workspacePath)[0];
    const posted: HostToPane[] = [];
    const log: string[] = [];
    let session!: Sessions;
    let projects!: Projects;
    let trees!: TreeStore;
    let selectedAgent = 'default';
    const post = (msg: HostToPane) => {
        posted.push(msg);
        if (trees && (msg.type === 'sessionList' || msg.type === 'projectList')) {
            trees.refresh();
        }
    };
    const profileWorkspaces = new ProfileWorkspaceStore(home, () => session.sessionProfileId);
    projects = new Projects(workspaces, new ProjectStore(home, profileId, workspaces), {
        post,
        log: line => log.push(line),
        tabs: () => session.tabs,
        saveTabs: (next, options) => session.setTabs(next, options),
        activeTabId: () => session.activeId,
        openWorkspace: () => {},
        currentWorkspacePath: () => workspacePath,
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    } as ProjectsHost, profileWorkspaces);
    session = new Sessions(home, profileId, {
        post,
        log: line => log.push(line),
        updatePanelTitle: () => {},
        modelLabel: () => undefined,
        currentWorkspaceId: () => workspace.id,
        knownWorkspaceIds: () => [workspace.id],
        activeChanged: () => { projects.syncActiveProject(); },
    } as SessionsHost, new TabStore(home, profileId));
    trees = new TreeStore(home, line => log.push(line), () =>
        treeInputOf({ tabs: session, projects, agentName: () => selectedAgent }));
    return {
        home,
        workspace,
        profileWorkspaces,
        posted,
        log,
        get session() { return session; },
        get projects() { return projects; },
        /** What a start does: restore this profile's tab, then publish its projects. */
        start: () => { session.init(); projects.postList(); },
        /** What the connection does: the tab list first, then the projects, then the name. */
        rebind: (next: string) => {
            session.bindProfileScope(next);
            projects.bindProfileScope(next);
            selectedAgent = next;
        },
    };
};

const read = (file: string): { projects: Array<{ tabs: Array<{ id: string }> }>; plane: Array<{ id: string }> } =>
    JSON.parse(fs.readFileSync(file, 'utf-8'));

/** Every tab id a tree file names, in either place it can put one. */
const idsIn = (tree: ReturnType<typeof read>): string[] =>
    [...tree.projects.flatMap(project => project.tabs), ...tree.plane].map(entry => entry.id);

/** Two agents, each with one tab in the same workspace, and nothing switched yet. */
const twoAgents = () => {
    const home = dir();
    const w = wiredWindow(home, '/work/one', 'scope');
    const scopeTabs = new TabStore(home, 'scope');
    scopeTabs.writeCatalog([tab('s1', w.workspace.id)]);
    scopeTabs.writeActiveId(w.workspace.id, 's1');
    const otherTabs = new TabStore(home, 'other');
    otherTabs.writeCatalog([tab('o1', w.workspace.id)]);
    otherTabs.writeActiveId(w.workspace.id, 'o1');
    return { home, w };
};

describe('the tree files: one agent\'s tabs never land in another agent\'s folder', () => {
    it('the sessions rebind writes that agent\'s own folder, and leaves the other one alone', () => {
        const { home, w } = twoAgents();
        w.start();
        // The connection's first step. The project feature still names the profile it was on.
        w.session.bindProfileScope('other');

        const own = treePathsFor(home, 'other');
        assert.deepStrictEqual(idsIn(read(own.current)), ['o1'], 'the tabs go in the folder of the id they belong to');
        assert.ok(
            !idsIn(read(treePathsFor(home, 'scope').current)).includes('o1'),
            "the agent we left does not gain the new agent's tabs"
        );
    });

    it('a rebind in the connection\'s order leaves each folder holding its own tabs', () => {
        const { home, w } = twoAgents();
        w.start();
        w.rebind('other');

        assert.deepStrictEqual(idsIn(read(treePathsFor(home, 'other').current)), ['o1']);
        assert.deepStrictEqual(idsIn(read(treePathsFor(home, 'scope').current)), ['s1'], 'and only its own');
    });
});
