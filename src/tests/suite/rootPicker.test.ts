import { afterEach, describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceCwd } from '../../host/workspace/cwd';
import { RootPicker, type RootPickerHost } from '../../host/workspace/rootPicker';
import type { HostToPane } from '../../shared/webview';

/** One second of the host's clock, plus a little: the countdown ticks once a second. */
const TICK = 1100;

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Pickers whose countdown a test may have started, and the folders it made, cleaned after it. */
const running: Array<() => void> = [];
const temps: string[] = [];

afterEach(function () {
    while (running.length) {
        running.pop()!();
    }
    while (temps.length) {
        fs.rmSync(temps.pop()!, { recursive: true, force: true });
    }
});

/**
 * A window whose folders are real directories, so the picker's "is it on disk" check is exercised
 * rather than mocked.
 *
 * Folders are named (`a`, `b`); the harness makes one directory per name under a temp root unless
 * the name is listed in `missing`. Everything a test reads back — `offered`, `newFolders`,
 * `missingFolders`, the notice's names — is a real path.
 */
function harness(
    names: string[],
    options: {
        chosenRoot?: string;
        ages?: Record<string, number>;
        missing?: string[];
        moved?: boolean;
    } = {}
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-rootpicker-'));
    temps.push(root);
    const pathOfName = (name: string): string => path.join(root, name);
    const idOfName = (name: string): string => `f-${name}`;
    names.forEach(name => {
        if (!(options.missing || []).includes(name)) {
            fs.mkdirSync(pathOfName(name), { recursive: true });
        }
    });

    let list = names.map(pathOfName);
    let sessionRoot = options.chosenRoot ? idOfName(options.chosenRoot) : '';
    const ages: Record<string, number> = {};
    for (const [name, seconds] of Object.entries(options.ages || {})) {
        ages[pathOfName(name)] = seconds;
    }
    const handlers: Array<() => void> = [];
    const pathOf = (folderId: string): string => (folderId.startsWith('f-') ? pathOfName(folderId.slice(2)) : '');

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
            offered: () => list.map(folderPath => ({
                folderId: `f-${path.basename(folderPath)}`,
                path: folderPath,
                addedAt: 0,
                removed: false,
                newSecondsLeft: ages[folderPath] || 0,
            })),
            defaultFolderId: () => idOfName(path.basename(list[0] || '')),
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
    let moved = options.moved !== false;

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
            return moved;
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
        paths: list.slice(),
        pathOf: pathOfName,
        idOf: idOfName,
        setBusy: (value: boolean) => {
            busy = value;
        },
        setMoved: (value: boolean) => {
            moved = value;
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
            list = next.map(pathOfName);
            handlers.forEach(handler => handler());
        },
        last: () => posts[posts.length - 1] as Extract<HostToPane, { type: 'permissionRootState' }>,
        root: () => sessionRoot,
        rootPath: () => cwd.forSession(sessionRoot),
    };
}

describe('permission root: the picker', () => {
    it('warns when the last folder goes, and offers nothing', () => {
        const h = harness(['a']);
        h.changeFolders([]);
        assert.strictEqual(h.last().notice, 'lastRootRemoved');
        assert.deepStrictEqual(h.last().offered, []);
        assert.strictEqual(h.last().root, '');
    });

    it('an idle session is reloaded with the new root, so Hermes moves it now', async () => {
        const h = harness(['a', 'b']);
        await h.picker.setRoot(h.pathOf('b'));
        assert.deepStrictEqual(h.reloads, [h.pathOf('b')]);
        assert.strictEqual(h.last().notice, undefined);
        assert.strictEqual(h.rootPath(), h.pathOf('b'));
    });

    it('a busy session is told the pick applies from the next run, and is left alone', async () => {
        const h = harness(['a', 'b']);
        h.setBusy(true);
        await h.picker.setRoot(h.pathOf('b'));
        assert.deepStrictEqual(h.reloads, [], 'nothing is interrupted');
        assert.strictEqual(h.last().notice, 'appliesNextRun');
        assert.strictEqual(h.rootPath(), h.pathOf('b'), 'the choice is still recorded');
    });

    it('a pick refused while busy is applied when that run ends', async () => {
        const h = harness(['a', 'b']);
        h.setBusy(true);
        await h.picker.setRoot(h.pathOf('b'));
        assert.deepStrictEqual(h.reloads, [], 'nothing is interrupted');

        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));

        assert.deepStrictEqual(h.reloads, [h.pathOf('b')], 'the session moves once the run is over');
        assert.strictEqual(h.last().notice, undefined, 'and the notice goes away');
    });

    it('refuses a folder this window does not show', async () => {
        const h = harness(['a', 'b']);
        await h.picker.setRoot(path.join(os.tmpdir(), 'elsewhere'));
        assert.strictEqual(h.root(), '', 'no root was put on the session');
        assert.deepStrictEqual(h.reloads, []);
    });
});

/** The window starts with the facts and a closed row; the moments that open it. */
describe('permission root: when the row opens by itself', () => {
    it('the start posts the state and opens nothing', () => {
        const h = harness(['a', 'b']);
        assert.strictEqual(h.rail().length, 0, 'no automatic open at the start');
        assert.strictEqual(h.last().open, false);
        assert.deepStrictEqual(h.last().offered, h.paths);
        assert.strictEqual(h.last().root, h.pathOf('a'), 'the first time, the active root is the primary');
    });

    it('a stored choice is the one marked, not the primary', () => {
        const h = harness(['a', 'b'], { chosenRoot: 'b' });
        assert.strictEqual(h.last().root, h.pathOf('b'));
    });

    it('one folder posts the state without a dialog, and offers nothing', () => {
        const h = harness(['a']);
        assert.strictEqual(h.last().open, false);
        assert.strictEqual(h.last().root, h.pathOf('a'));
        assert.deepStrictEqual(h.last().offered, []);
    });

    it('no folder posts no root at all', () => {
        const h = harness([]);
        assert.strictEqual(h.last().root, '');
        assert.strictEqual(h.last().open, false);
    });

    it('a pane that appears later hears the facts again, without being told to open', () => {
        const h = harness(['a', 'b']);
        const before = h.posts.length;
        h.picker.republish();
        assert.strictEqual(h.posts.length, before + 1, 'the facts are said again');
        assert.strictEqual((h.last() as { open?: boolean }).open, false);
        assert.strictEqual(h.rail().length, 0, 'and the rail is not asked to open');
    });

    it('moment A: a profile becoming active opens the row when there is a choice', () => {
        const h = harness(['a', 'b']);
        h.profileActive();
        assert.strictEqual(h.openedInRail(), 1);
        assert.strictEqual(h.lastOpen().open, true);
        assert.strictEqual(h.lastOpen().root, h.pathOf('a'));
    });

    it('moment A does not open a row with nothing to choose between', () => {
        const h = harness(['a']);
        h.profileActive();
        assert.strictEqual(h.openedInRail(), 0);
    });

    it('a folder change opens nothing when no folder is new', () => {
        const h = harness(['a']);
        h.changeFolders(['a', 'b']);
        assert.strictEqual(h.openedInRail(), 0, 'no welcome left, no reason to open');
        assert.deepStrictEqual(h.last().offered, [h.pathOf('a'), h.pathOf('b')], 'the facts are still said');
        assert.deepStrictEqual(h.last().newFolders, [], 'and no folder is reported as new');
    });

    it('moment B: a folder that joined while the rail was hidden opens when the rail appears', () => {
        const h = harness(['a'], { ages: { b: 30 } });
        h.setRailVisible(false);
        h.changeFolders(['a', 'b']);
        assert.strictEqual(h.openedInRail(), 0, 'the rail is not in view: nothing opens');

        h.setRailVisible(true);
        h.picker.railShown();
        assert.strictEqual(h.openedInRail(), 1);
        assert.deepStrictEqual(h.lastOpen().newFolders, [h.pathOf('b')]);
        h.picker.close();
    });

    it('moment B: the rail appearing opens nothing when no folder is new', () => {
        const h = harness(['a', 'b']);
        h.picker.railShown();
        assert.strictEqual(h.openedInRail(), 0, 'a row with nothing new to point at stays closed');
    });

    it('a folder joining while the rail is in view opens the row then', () => {
        const h = harness(['a'], { ages: { b: 30 } });
        h.changeFolders(['a', 'b']);
        assert.strictEqual(h.openedInRail(), 1);
        assert.deepStrictEqual(h.lastOpen().newFolders, [h.pathOf('b')]);
        h.picker.close();
    });

    it('the automatic open is addressed to the rail, never fanned out', () => {
        const h = harness(['a', 'b']);
        h.profileActive();
        const facts = h.posts.filter(msg => msg.type === 'permissionRootState');
        assert.ok(facts.every(msg => (msg as { open: boolean }).open === false),
            'every surface hears the facts, none of them is told to open');
        assert.strictEqual(h.rail().length, 1, 'the rail is told once');
    });

    it('with no rail live the open is dropped, not sent somewhere else', () => {
        const h = harness(['a', 'b']);
        h.setRailLive(false);
        h.profileActive();
        assert.strictEqual(h.posts.filter(msg => (msg as { open?: boolean }).open === true).length, 0);
        assert.ok(h.logs.some(line => line.includes('no rail surface')), 'and it says so');
    });
});

/** The three failure cases the row now speaks about. */
describe('permission root: the notices', () => {
    it('8a: a refused move puts the previous root back and says why', async () => {
        const h = harness(['a', 'b'], { chosenRoot: 'a', moved: false });
        await h.picker.setRoot(h.pathOf('b'));

        assert.strictEqual(h.root(), h.idOf('a'), 'the stored root is the one Hermes is still using');
        assert.strictEqual(h.rootPath(), h.pathOf('a'));
        assert.strictEqual(h.last().notice, 'moveRefused');
        assert.strictEqual(h.last().noticeFolder, h.pathOf('b'));
        assert.strictEqual(h.last().noticePrevious, h.pathOf('a'));
        assert.strictEqual(h.openedInRail(), 1, 'and the rail is told, because a notice is a reason');
    });

    it('8a: a refusal after a busy run puts the root back too', async () => {
        const h = harness(['a', 'b'], { chosenRoot: 'a', moved: false });
        h.setBusy(true);
        await h.picker.setRoot(h.pathOf('b'));
        assert.strictEqual(h.last().notice, 'appliesNextRun', 'nothing is attempted mid-run');

        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));

        assert.strictEqual(h.root(), h.idOf('a'), 'the root goes back');
        assert.strictEqual(h.last().notice, 'moveRefused');
        assert.strictEqual(h.last().noticePrevious, h.pathOf('a'));
    });

    it('8b: a folder whose path is gone is marked, and cannot be picked', async () => {
        const h = harness(['a', 'b'], { missing: ['b'], chosenRoot: 'a' });
        assert.deepStrictEqual(h.last().missingFolders, [h.pathOf('b')]);
        assert.ok(h.logs.some(line => line.includes('not on disk')), 'the path is logged');

        await h.picker.setRoot(h.pathOf('b'));
        assert.strictEqual(h.root(), h.idOf('a'), 'the pick was refused');
        assert.deepStrictEqual(h.reloads, [], 'and nothing was reloaded');
        assert.ok(h.logs.some(line => line.includes('refused')), 'the refusal is logged');
    });

    it('8c: removing the root the session works in says so, and reloads nothing', () => {
        const h = harness(['a', 'b'], { chosenRoot: 'b' });
        h.changeFolders(['a']);

        assert.strictEqual(h.last().notice, 'rootRemoved');
        assert.strictEqual(h.last().noticeFolder, h.pathOf('b'));
        assert.deepStrictEqual(h.reloads, [], 'a removal is a notice, not a move');
        assert.strictEqual(h.lastOpen().open, true, 'the row opens even with one folder left');
    });

    it('8c is said once, not on every folder change', () => {
        const h = harness(['a', 'b'], { chosenRoot: 'b' });
        h.changeFolders(['a']);
        const afterFirst = h.logs.filter(line => line.includes('notice rootRemoved')).length;
        h.changeFolders(['a']);
        assert.strictEqual(h.logs.filter(line => line.includes('notice rootRemoved')).length, afterFirst);
    });

    it('a notice is spent when the row is closed', () => {
        const h = harness(['a', 'b'], { chosenRoot: 'b' });
        h.changeFolders(['a']);
        assert.strictEqual(h.last().notice, 'rootRemoved');

        h.picker.close();
        h.picker.republish();
        assert.strictEqual(h.last().notice, undefined, 'closing the row spends it');
    });

    it('a notice is spent when a root is picked', async () => {
        const h = harness(['a', 'b'], { chosenRoot: 'a', moved: false });
        await h.picker.setRoot(h.pathOf('b'));
        assert.strictEqual(h.last().notice, 'moveRefused');

        h.setMoved(true);
        await h.picker.setRoot(h.pathOf('b'));
        assert.strictEqual(h.last().notice, undefined, 'the pick that worked clears it');
    });
});

/** The welcome: counted down only while the rail shows it, and kept when it stops early. */
describe('permission root: the new folder countdown', () => {
    it('counts down while the row is open, and keeps what is left when it is closed', async function () {
        this.timeout(8000);
        const h = harness(['a', 'b'], { ages: { b: 30 } });
        h.picker.railShown();
        assert.strictEqual(h.openedInRail(), 1);

        await wait(TICK);
        h.picker.close();

        const left = h.ages[h.pathOf('b')];
        assert.ok(left !== undefined && left < 30 && left >= 28, `about 29 s are kept, saw ${left}`);
        assert.ok(h.logs.some(line => line.includes('countdown stopped (closed)')), 'the stop is logged');
        assert.ok(h.logs.some(line => line.includes('opened by itself (rail in view)')), 'so is the open');
    });

    it('stops when the rail goes away, and keeps what is left', async function () {
        this.timeout(8000);
        const h = harness(['a', 'b'], { ages: { b: 30 } });
        h.picker.railShown();
        await wait(TICK);
        h.setRailVisible(false);
        await wait(TICK);

        assert.ok(h.logs.some(line => line.includes('countdown stopped (rail hidden)')));
        assert.strictEqual(h.ages[h.pathOf('b')], 29, 'one tick was counted before the rail left');
    });

    it('at zero the row is said again without the new folder', async function () {
        this.timeout(8000);
        const h = harness(['a', 'b'], { ages: { b: 1 } });
        h.picker.railShown();
        assert.deepStrictEqual(h.lastOpen().newFolders, [h.pathOf('b')]);

        await wait(TICK);
        assert.strictEqual(h.ages[h.pathOf('b')], 0);
        assert.deepStrictEqual(h.last().newFolders, [], '"New" is gone from the state');
        assert.ok(h.logs.some(line => line.includes('countdown stopped (zero)')));
    });

    it('the editor panel spends nothing: no rail in view, nothing is counted', () => {
        const h = harness(['a', 'b'], { ages: { b: 30 } });
        h.setRailVisible(false);
        h.profileActive();
        h.picker.close();
        assert.strictEqual(h.ages[h.pathOf('b')], 30, 'the welcome was not spent');
    });
});
