import { describe, it } from 'mocha';
import assert from 'assert';
import { WorkspaceCwd } from '../../host/workspace/cwd';
import { RootPicker, type RootPickerHost } from '../../host/workspace/rootPicker';
import type { HostToPane } from '../../shared/webview';

/** A window whose folder list a test can change, and a record that keeps what it is told. */
function harness(folders: string[], roots = { primaryRoot: '', permissionRoot: '' }) {
    let list = folders.slice();
    const state = { ...roots };
    const handlers: Array<() => void> = [];
    const cwd = new WorkspaceCwd(
        {
            workspaceFile: () => '/w/space.code-workspace',
            folders: () => list.slice(),
            onFoldersChanged: (handler: () => void) => {
                handlers.push(handler);
                return () => undefined;
            },
        },
        {
            roots: () => ({ ...state }),
            setRoots: (_path: string, next: { primaryRoot: string; permissionRoot: string }) => {
                state.primaryRoot = next.primaryRoot;
                state.permissionRoot = next.permissionRoot;
            },
        },
    );
    const posts: HostToPane[] = [];
    const reloads: string[] = [];
    const ended: Array<() => void> = [];
    const rail: HostToPane[] = [];
    let railLive = true;
    let busy = false;
    const host: RootPickerHost = {
        post: (msg: HostToPane) => {
            posts.push(msg);
        },
        log: () => {},
        cwd,
        activeSessionBusy: () => busy,
        reloadActiveSession: async () => {
            reloads.push(cwd.forWindow());
        },
        profileLabel: () => 'dev-vsc',
        onRunEnded: (handler: () => void) => {
            ended.push(handler);
            return () => undefined;
        },
        postToRail: (msg: HostToPane) => {
            rail.push(msg);
            return railLive;
        },
    };
    const picker = new RootPicker(host);
    picker.start();
    return {
        picker,
        posts,
        reloads,
        state,
        setBusy: (value: boolean) => {
            busy = value;
        },
        endRun: () => ended.forEach(handler => handler()),
        setRailLive: (value: boolean) => {
            railLive = value;
        },
        rail: () => rail,
        lastOpen: () => rail[rail.length - 1] as Extract<HostToPane, { type: 'permissionRootState' }>,
        changeFolders: (next: string[]) => {
            list = next.slice();
            handlers.forEach(handler => handler());
        },
        last: () => posts[posts.length - 1] as Extract<HostToPane, { type: 'permissionRootState' }>,
    };
}

describe('permission root: the picker', () => {
    it('opens the dialog by itself when a folder change leaves two or more folders', () => {
        const h = harness(['/w/a']);
        h.changeFolders(['/w/a', '/w/b']);
        assert.strictEqual(h.lastOpen().type, 'permissionRootState');
        assert.strictEqual(h.lastOpen().open, true);
        assert.deepStrictEqual(h.last().offered, ['/w/a', '/w/b']);
        assert.strictEqual(h.last().root, '/w/a');
    });

    it('never opens the dialog for a workspace with one folder', () => {
        const h = harness(['/w/a', '/w/b']);
        h.changeFolders(['/w/a']);
        assert.strictEqual(h.last().open, false);
        assert.strictEqual(h.last().root, '/w/a');
    });

    it('warns when the last folder goes, and offers nothing', () => {
        const h = harness(['/w/a']);
        h.changeFolders([]);
        assert.strictEqual(h.last().notice, 'lastRootRemoved');
        assert.deepStrictEqual(h.last().offered, []);
        assert.strictEqual(h.last().root, '');
    });

    it('an idle session is reloaded with the new root, so Hermes moves it now', async () => {
        const h = harness(['/w/a', '/w/b']);
        await h.picker.setRoot('/w/b');
        assert.deepStrictEqual(h.reloads, ['/w/b']);
        assert.strictEqual(h.last().notice, undefined);
        assert.strictEqual(h.state.permissionRoot, '/w/b');
    });

    it('a busy session is told the pick applies from the next run, and is left alone', async () => {
        const h = harness(['/w/a', '/w/b']);
        h.setBusy(true);
        await h.picker.setRoot('/w/b');
        assert.deepStrictEqual(h.reloads, [], 'nothing is interrupted');
        assert.strictEqual(h.last().notice, 'appliesNextRun');
        assert.strictEqual(h.state.permissionRoot, '/w/b', 'the choice is still recorded');
    });

    it('a pick refused while busy is applied when that run ends', async () => {
        const h = harness(['/w/a', '/w/b']);
        h.setBusy(true);
        await h.picker.setRoot('/w/b');
        assert.deepStrictEqual(h.reloads, [], 'nothing is interrupted');

        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));

        assert.deepStrictEqual(h.reloads, ['/w/b'], 'the session moves once the run is over');
        assert.strictEqual(h.last().notice, undefined, 'and the notice goes away');
    });

    it('refuses a folder this window does not show', async () => {
        const h = harness(['/w/a', '/w/b']);
        await h.picker.setRoot('/elsewhere');
        assert.strictEqual(h.state.permissionRoot, '');
        assert.deepStrictEqual(h.reloads, []);
    });
});

/** At start the picker says where the window stands — and with 2+ folders it opens the dialog. */
describe('permission root: the start-up post', () => {
    it('opens the dialog with the active root marked when the window shows several folders', () => {
        const h = harness(['/w/a', '/w/b']);
        assert.strictEqual(h.lastOpen().type, 'permissionRootState');
        assert.strictEqual(h.lastOpen().open, true);
        assert.strictEqual(h.lastOpen().root, '/w/a', 'the first time, the active root is the primary');
        assert.deepStrictEqual(h.last().offered, ['/w/a', '/w/b']);
    });

    it('a stored choice is the one marked, not the primary', () => {
        const h = harness(['/w/a', '/w/b'], { primaryRoot: '/w/a', permissionRoot: '/w/b' });
        assert.strictEqual(h.lastOpen().root, '/w/b');
        assert.strictEqual(h.lastOpen().open, true);
    });

    it('one folder posts the state without a dialog, and offers nothing', () => {
        const h = harness(['/w/a']);
        assert.strictEqual(h.last().open, false);
        assert.strictEqual(h.last().root, '/w/a');
        assert.deepStrictEqual(h.last().offered, []);
    });

    it('no folder posts no root at all', () => {
        const h = harness([]);
        assert.strictEqual(h.last().root, '');
        assert.strictEqual(h.last().open, false);
    });

    it('a surface that appears later hears the same thing again', () => {
        const h = harness(['/w/a', '/w/b']);
        const before = h.posts.length;
        h.picker.republish();
        assert.strictEqual(h.posts.length, before + 1, 'the facts are said again');
        assert.strictEqual(h.lastOpen().open, true, 'and the rail is asked once more');
    });

    it('the automatic open is addressed to the rail, never fanned out', () => {
        const h = harness(['/w/a', '/w/b']);
        const facts = h.posts.filter(msg => msg.type === 'permissionRootState');
        assert.ok(facts.every(msg => (msg as { open: boolean }).open === false),
            'every surface hears the facts, none of them is told to open');
        const opened = h.rail().filter(msg => msg.type === 'permissionRootState');
        assert.strictEqual(opened.length, 1, 'the rail is told once');
        assert.strictEqual((opened[0] as { open: boolean }).open, true);
    });

    it('with no rail live the open is dropped, not sent somewhere else', () => {
        const h = harness(['/w/a', '/w/b']);
        h.setRailLive(false);
        h.picker.state({ open: true });
        assert.strictEqual(h.posts.filter(msg => (msg as { open?: boolean }).open === true).length, 0);
    });
});
