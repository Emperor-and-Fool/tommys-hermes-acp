/**
 * Which folder the tree files land in, and whose name they carry.
 *
 * The tree is one object assembled from three owners: the agent's identity, this window's projects
 * and its tabs. `app.ts` composes it through `treeInputOf`, and `Sessions`/`Projects` each re-bind
 * their own store when the agent changes — the connection re-binds them in turn, and each rebind
 * posts its list, which is what refreshes the tree.
 *
 * Found 2026-11-22: between those two rebinds the id and the tabs came from different holders, so
 * the refresh wrote one agent's tabs under the other agent's id. The name had the same fault one
 * step later: it was read from the window's selection, which the connection moves after both
 * rebinds. These tests hold the window to the rule the folder is for (§7: `profiles/<id>/` holds
 * that agent's rows, and the file names that agent).
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
import { Profiles } from '../../host/environment/profiles';
import type { ProfilesHost } from '../../host/environment/profiles';
import { ProfilesStore } from '../../host/store/profiles';
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

/** The window's profile feature over a real table: what `app.ts` hands `treeInputOf` by name. */
const profilesFeature = (home: string) => {
    const table = new ProfilesStore(home);
    const profiles = new Profiles({
        log: () => undefined,
        post: () => undefined,
        settings: { get: (_key: string, fallback?: unknown) => fallback },
        store: table,
        workspaceSelection: () => '',
        saveWorkspaceSelection: () => undefined,
        heldElsewhere: () => [],
    } as unknown as ProfilesHost);
    return { table, profiles };
};

/**
 * A window wired the way `app.ts` wires it: the tree input comes from `treeInputOf` over the real
 * features, and either list post refreshes the tree.
 */
const wiredWindow = (
    home: string,
    workspacePath: string,
    profileId: string,
    feature: ReturnType<typeof profilesFeature>,
) => {
    const { table, profiles } = feature;
    const workspaces = new WorkspaceStore(home);
    const workspace = workspaces.register(workspacePath)[0];
    const posted: HostToPane[] = [];
    const log: string[] = [];
    let session!: Sessions;
    let projects!: Projects;
    let trees!: TreeStore;
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
        treeInputOf({ tabs: session, projects, agentName: id => profiles.agentNameFor(id) }));
    return {
        home,
        workspace,
        profileWorkspaces,
        posted,
        log,
        profiles,
        get session() { return session; },
        get projects() { return projects; },
        /** What a start does: restore this profile's tab, then publish its projects. */
        start: () => { session.init(); projects.postList(); },
        /** What the connection does: the tab list first, then the projects, then the selection. */
        rebind: (next: string) => {
            session.bindProfileScope(next);
            projects.bindProfileScope(next);
            profiles.selectionId = table.nameFor(next) || '';
        },
    };
};

const read = (file: string): {
    profile: string;
    projects: Array<{ tabs: Array<{ id: string }> }>;
    plane: Array<{ id: string }>;
} => JSON.parse(fs.readFileSync(file, 'utf-8'));

/** Every tab id a tree file names, in either place it can put one. */
const idsIn = (tree: ReturnType<typeof read>): string[] =>
    [...tree.projects.flatMap(project => project.tabs), ...tree.plane].map(entry => entry.id);

/** Two agents, each with one tab in the same workspace, and the window still on the first one. */
const twoAgents = () => {
    const home = dir();
    const feature = profilesFeature(home);
    // One id per agent, minted the way a connect mints it: the folder is the id from here on.
    const mine = feature.table.idFor('default');
    const theirs = feature.table.idFor('kitt');
    const w = wiredWindow(home, '/work/one', mine, feature);
    // What a landed connect leaves behind.
    feature.profiles.selectionId = 'default';
    const mineTabs = new TabStore(home, mine);
    mineTabs.writeCatalog([tab('s1', w.workspace.id)]);
    mineTabs.writeActiveId(w.workspace.id, 's1');
    const theirTabs = new TabStore(home, theirs);
    theirTabs.writeCatalog([tab('o1', w.workspace.id)]);
    theirTabs.writeActiveId(w.workspace.id, 'o1');
    return { home, w, mine, theirs, profiles: feature.profiles };
};

describe('the tree files: one agent\'s tabs never land in another agent\'s folder', () => {
    it('the sessions rebind writes that agent\'s own folder, and leaves the other one alone', () => {
        const { home, w, mine, theirs } = twoAgents();
        w.start();
        // The connection's first step. The project feature still names the profile it was on.
        w.session.bindProfileScope(theirs);

        const own = treePathsFor(home, theirs);
        assert.deepStrictEqual(idsIn(read(own.current)), ['o1'], 'the tabs go in the folder of the id they belong to');
        assert.ok(
            !idsIn(read(treePathsFor(home, mine).current)).includes('o1'),
            "the agent we left does not gain the new agent's tabs"
        );
    });

    it('a rebind in the connection\'s order leaves each folder holding its own tabs', () => {
        const { home, w, mine, theirs } = twoAgents();
        w.start();
        w.rebind(theirs);

        assert.deepStrictEqual(idsIn(read(treePathsFor(home, theirs).current)), ['o1']);
        assert.deepStrictEqual(idsIn(read(treePathsFor(home, mine).current)), ['s1'], 'and only its own');
    });
});

describe('the tree files: the name in a file is the name of that file\'s agent', () => {
    it('the sessions rebind names the folder\'s agent while the window still selects the old one', () => {
        const { home, w, mine, theirs, profiles } = twoAgents();
        w.start();
        // The connection's first step, with the selection still on the agent the window was on.
        w.session.bindProfileScope(theirs);

        assert.strictEqual(read(treePathsFor(home, theirs).current).profile, 'kitt');
        assert.strictEqual(read(treePathsFor(home, mine).current).profile, 'default');
        assert.strictEqual(profiles.selectionId, 'default', 'and the selection has not moved yet');
    });

    it('the name and the tabs of a folder come from that folder, never from the selection', () => {
        const { home, w, mine, theirs } = twoAgents();
        w.start();
        w.rebind(theirs);

        const after = read(treePathsFor(home, theirs).current);
        assert.strictEqual(after.profile, 'kitt', 'the agent whose tabs these are');
        assert.deepStrictEqual(idsIn(after), ['o1']);
        assert.strictEqual(read(treePathsFor(home, mine).current).profile, 'default', 'the folder we left still names itself');
    });
});
