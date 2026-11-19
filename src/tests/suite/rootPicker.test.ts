import { afterEach, describe, it } from 'mocha';
import assert from 'assert';
import { WorkspaceCwd } from '../../host/workspace/cwd';
import { RootPicker, type RootPickerHost } from '../../host/workspace/rootPicker';
import type { HostToPane } from '../../shared/webview';

/** One second of the host's clock, plus a little: the countdown ticks once a second. */
const TICK = 1100;

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Pickers whose countdown a test may have started, stopped after every test. */
const running: Array<() => void> = [];

afterEach(function () {
    while (running.length) {
        running.pop()!();
    }
});

/**
 * A window whose folder list, rail visibility and folder ages a test can change.
 *
 * The store behind the cwd owner is where the picker writes what is left of a welcome, so `ages`
 * is what a test reads to see what the countdown kept.
 */
function harness(
    folders: string[],
    options: { chosenRoot?: string; ages?: Record<string, number> } = {}
) {
    let list = folders.slice();
    let sessionRoot = options.chosenRoot || '';
    const ages: Record<string, number> = { ...(options.ages || {}) };
    const handlers: Array<() => void> = [];
    const pathOf = (folderId: string): string => list[Number(folderId.replace('f', ''))] || '';

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
            offered: () => list.map((folderPath, index) => ({
                folderId: `f${index}`,
                path: folderPath,
                addedAt: index,
                removed: false,
                newSecondsLeft: ages[folderPath] || 0,
            })),
            defaultFolderId: () => 'f0',
            setDefaultFolderId: () => undefined,
            record: () => undefined,
            pathFor: pathOf,
            setNewSecondsLeft: (_workspaceId: string, folderId: string, seconds: number) => {
                ages[pathOf(folderId)] = seconds;
            },
            workspaceId: () => 'w-1',
        },
    );

    const posts: HostToPane[] = [];
    const rail: HostToPane[] = [];
    const logs: string[] = [];
    const reloads: string[] = [];
    const ended: Array<() => void> = [];
    const activated: Array<() => void> = [];
    let railLive = true;
    let railVisible = true;
    let busy = false;

    const host: RootPickerHost = {
        post: (msg: HostToPane) => {
            posts.push(msg);
        },
        log: (line: string) => {
            logs.push(line);
        },
        cwd,
        activeSessionBusy: () => busy,
        reloadActiveSession: async () => {
            reloads.push(cwd.forSession(sessionRoot));
        },
        sessionRootId: () => sessionRoot,
        setSessionRoot: (folderId: string) => {
            sessionRoot = folderId;
            return true;
        },
        profileLabel: () => 'dev-vsc',
        onRunEnded: (handler: () => void) => {
            ended.push(handler);
            return () => undefined;
        },
        onProfileActive: (handler: () => void) => {
            activated.push(handler);
            return () => undefined;
        },
        railInView: () => railVisible,
        postToRail: (msg: HostToPane) => {
            rail.push(msg);
            return railLive;
        },
    };
    const picker = new RootPicker(host);
    const stop = picker.start();
    running.push(stop);

    return {
        picker,
        posts,
        logs,
        reloads,
        ages,
        setBusy: (value: boolean) => {
            busy = value;
        },
        endRun: () => ended.forEach(handler => handler()),
        /** Say that a profile became active: the connection's signal, without a connection. */
        profileActive: () => activated.forEach(handler => handler()),
        setRailLive: (value: boolean) => {
            railLive = value;
        },
        setRailVisible: (value: boolean) => {
            railVisible = value;
        },
        rail: () => rail,
        lastOpen: () => rail[rail.length - 1] as Extract<HostToPane, { type: 'permissionRootState' }>,
        openedInRail: () => rail.filter(msg => (msg as { open?: boolean }).open === true).length,
        changeFolders: (next: string[]) => {
            list = next.slice();
            handlers.forEach(handler => handler());
        },
        last: () => posts[posts.length - 1] as Extract<HostToPane, { type: 'permissionRootState' }>,
        root: () => sessionRoot,
        rootPath: () => cwd.forSession(sessionRoot),
    };
}

describe('permission root: the picker', () => {
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
        assert.strictEqual(h.rootPath(), '/w/b');
    });

    it('a busy session is told the pick applies from the next run, and is left alone', async () => {
        const h = harness(['/w/a', '/w/b']);
        h.setBusy(true);
        await h.picker.setRoot('/w/b');
        assert.deepStrictEqual(h.reloads, [], 'nothing is interrupted');
        assert.strictEqual(h.last().notice, 'appliesNextRun');
        assert.strictEqual(h.rootPath(), '/w/b', 'the choice is still recorded');
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
        assert.strictEqual(h.root(), '', 'no root was put on the session');
        assert.deepStrictEqual(h.reloads, []);
    });
});

/** The window starts with the facts and a closed row; the two moments open it. */
describe('permission root: when the row opens by itself', () => {
    it('the start posts the state and opens nothing', () => {
        const h = harness(['/w/a', '/w/b']);
        assert.strictEqual(h.rail().length, 0, 'no automatic open at the start');
        assert.strictEqual(h.last().open, false);
        assert.deepStrictEqual(h.last().offered, ['/w/a', '/w/b']);
        assert.strictEqual(h.last().root, '/w/a', 'the first time, the active root is the primary');
    });

    it('a stored choice is the one marked, not the primary', () => {
        const h = harness(['/w/a', '/w/b'], { chosenRoot: 'f1' });
        assert.strictEqual(h.last().root, '/w/b');
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

    it('a pane that appears later hears the facts again, without being told to open', () => {
        const h = harness(['/w/a', '/w/b']);
        const before = h.posts.length;
        h.picker.republish();
        assert.strictEqual(h.posts.length, before + 1, 'the facts are said again');
        assert.strictEqual((h.last() as { open?: boolean }).open, false);
        assert.strictEqual(h.rail().length, 0, 'and the rail is not asked to open');
    });

    it('moment A: a profile becoming active opens the row when there is a choice', () => {
        const h = harness(['/w/a', '/w/b']);
        h.profileActive();
        assert.strictEqual(h.openedInRail(), 1);
        assert.strictEqual(h.lastOpen().open, true);
        assert.strictEqual(h.lastOpen().root, '/w/a');
    });

    it('moment A does not open a row with nothing to choose between', () => {
        const h = harness(['/w/a']);
        h.profileActive();
        assert.strictEqual(h.openedInRail(), 0);
    });

    it('a folder change opens nothing when no folder is new', () => {
        const h = harness(['/w/a']);
        h.changeFolders(['/w/a', '/w/b']);
        assert.strictEqual(h.openedInRail(), 0, 'no welcome left, no reason to open');
        assert.deepStrictEqual(h.last().offered, ['/w/a', '/w/b'], 'the facts are still said');
        assert.deepStrictEqual(h.last().newFolders, [], 'and no folder is reported as new');
    });

    it('moment B: a folder that joined while the rail was hidden opens when the rail appears', () => {
        const h = harness(['/w/a'], { ages: { '/w/b': 30 } });
        h.setRailVisible(false);
        h.changeFolders(['/w/a', '/w/b']);
        assert.strictEqual(h.openedInRail(), 0, 'the rail is not in view: nothing opens');

        h.setRailVisible(true);
        h.picker.railShown();
        assert.strictEqual(h.openedInRail(), 1);
        assert.deepStrictEqual(h.lastOpen().newFolders, ['/w/b']);
        h.picker.close();
    });

    it('moment B: the rail appearing opens nothing when no folder is new', () => {
        const h = harness(['/w/a', '/w/b']);
        h.picker.railShown();
        assert.strictEqual(h.openedInRail(), 0, 'a row with nothing new to point at stays closed');
    });

    it('a folder joining while the rail is in view opens the row then', () => {
        const h = harness(['/w/a'], { ages: { '/w/b': 30 } });
        h.changeFolders(['/w/a', '/w/b']);
        assert.strictEqual(h.openedInRail(), 1);
        assert.deepStrictEqual(h.lastOpen().newFolders, ['/w/b']);
        h.picker.close();
    });

    it('the automatic open is addressed to the rail, never fanned out', () => {
        const h = harness(['/w/a', '/w/b']);
        h.profileActive();
        const facts = h.posts.filter(msg => msg.type === 'permissionRootState');
        assert.ok(facts.every(msg => (msg as { open: boolean }).open === false),
            'every surface hears the facts, none of them is told to open');
        assert.strictEqual(h.rail().length, 1, 'the rail is told once');
    });

    it('with no rail live the open is dropped, not sent somewhere else', () => {
        const h = harness(['/w/a', '/w/b']);
        h.setRailLive(false);
        h.profileActive();
        assert.strictEqual(h.posts.filter(msg => (msg as { open?: boolean }).open === true).length, 0);
        assert.ok(h.logs.some(line => line.includes('no rail surface')), 'and it says so');
    });
});

/** The welcome: counted down only while the rail shows it, and kept when it stops early. */
describe('permission root: the new folder countdown', () => {
    it('counts down while the row is open, and keeps what is left when it is closed', async function () {
        this.timeout(8000);
        const h = harness(['/w/a', '/w/b'], { ages: { '/w/b': 30 } });
        h.picker.railShown();
        assert.strictEqual(h.openedInRail(), 1);

        await wait(TICK);
        h.picker.close();

        const left = h.ages['/w/b'];
        assert.ok(left !== undefined && left < 30 && left >= 28, `about 29 s are kept, saw ${left}`);
        assert.ok(h.logs.some(line => line.includes('countdown stopped (closed)')), 'the stop is logged');
        assert.ok(h.logs.some(line => line.includes('opened by itself (rail in view)')), 'so is the open');
    });

    it('stops when the rail goes away, and keeps what is left', async function () {
        this.timeout(8000);
        const h = harness(['/w/a', '/w/b'], { ages: { '/w/b': 30 } });
        h.picker.railShown();
        await wait(TICK);
        h.setRailVisible(false);
        await wait(TICK);

        assert.ok(h.logs.some(line => line.includes('countdown stopped (rail hidden)')));
        assert.strictEqual(h.ages['/w/b'], 29, 'one tick was counted before the rail left');
    });

    it('at zero the row is said again without the new folder', async function () {
        this.timeout(8000);
        const h = harness(['/w/a', '/w/b'], { ages: { '/w/b': 1 } });
        h.picker.railShown();
        assert.deepStrictEqual(h.lastOpen().newFolders, ['/w/b']);

        await wait(TICK);
        assert.strictEqual(h.ages['/w/b'], 0);
        assert.deepStrictEqual(h.last().newFolders, [], '"New" is gone from the state');
        assert.ok(h.logs.some(line => line.includes('countdown stopped (zero)')));
    });

    it('the editor panel spends nothing: no rail in view, nothing is counted', () => {
        const h = harness(['/w/a', '/w/b'], { ages: { '/w/b': 30 } });
        h.setRailVisible(false);
        h.profileActive();
        h.picker.close();
        assert.strictEqual(h.ages['/w/b'], 30, 'the welcome was not spent');
    });
});
