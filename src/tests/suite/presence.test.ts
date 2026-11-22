import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { presenceInstanceId, PresenceStore, PRESENCE_STALE_MS, presenceDirFor } from '../../host/store/presence';
import { ProfilePresence } from '../../host/environment/presence';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-presence-'));
}

describe('the presence table', () => {
    it('is one file per instance, and a reader sees the others, not its own', () => {
        const home = tempHome();
        try {
            const first = new PresenceStore(home);
            const second = new PresenceStore(home);
            assert.notStrictEqual(first.instanceId, second.instanceId, 'one id per instance');

            first.write({ role: 'primary', cliProfile: 'dev', liveAt: 1000 });
            second.write({ role: 'secondant', cliProfile: 'kitt', liveAt: 1000 });

            assert.ok(fs.existsSync(path.join(presenceDirFor(home), `${first.instanceId}.json`)));
            assert.deepStrictEqual(
                first.live(1000).map(row => [row.role, row.cliProfile]),
                [['secondant', 'kitt']],
                'its own row is skipped'
            );
            const row = second.live(1000)[0];
            assert.deepStrictEqual(
                [row.instanceId, row.role, row.cliProfile, row.liveAt],
                [first.instanceId, 'primary', 'dev', 1000]
            );
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('drops a row that went stale, and skips a file it cannot read', () => {
        const home = tempHome();
        try {
            const mine = new PresenceStore(home);
            const other = new PresenceStore(home);
            other.write({ role: 'primary', cliProfile: 'dev', liveAt: 1000 });

            assert.strictEqual(mine.live(1000 + PRESENCE_STALE_MS).length, 1, 'fresh at the limit');
            assert.strictEqual(mine.live(1000 + PRESENCE_STALE_MS + 1).length, 0, 'stale past it');

            fs.writeFileSync(path.join(presenceDirFor(home), 'half-written.json'), '{"instanceId":');
            assert.strictEqual(mine.live(1000).length, 1, 'the unreadable row is skipped, not thrown');

            fs.writeFileSync(path.join(presenceDirFor(home), 'notes.txt'), 'not a row');
            assert.strictEqual(mine.live(1000).length, 1, 'and a file that is not a row is ignored');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('removes its own file and leaves the others', () => {
        const home = tempHome();
        try {
            const first = new PresenceStore(home);
            const second = new PresenceStore(home);
            first.write({ role: 'primary', cliProfile: 'dev', liveAt: 1000 });
            second.write({ role: 'secondant', cliProfile: 'kitt', liveAt: 1000 });

            first.remove();
            assert.deepStrictEqual(second.live(1000), [], 'the first instance is gone from the table');
            assert.strictEqual(fs.existsSync(path.join(presenceDirFor(home), `${second.instanceId}.json`)), true);
            first.remove();     // twice is not an error
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('says nothing about an instance that never wrote, and about a home with no folder', () => {
        const home = tempHome();
        try {
            const mine = new PresenceStore(home);
            assert.deepStrictEqual(mine.live(), [], 'no presence folder yet');
            assert.deepStrictEqual(new PresenceStore(path.join(home, 'nope')).live(), []);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('the heartbeat', () => {
    function harness(profile = 'dev-vsc') {
        const home = tempHome();
        const store = new PresenceStore(home);
        const logs: string[] = [];
        let current = profile;
        let live = true;
        const presence = new ProfilePresence({
            store,
            role: 'primary',
            profile: () => current,
            live: () => live,
            log: (line: string) => {
                logs.push(line);
            },
        });
        return {
            home,
            store,
            logs,
            presence,
            setProfile: (value: string) => {
                current = value;
            },
            setLive: (value: boolean) => {
                live = value;
            },
            rows: () => store.live(Date.now(), Number.MAX_SAFE_INTEGER),
            file: () => path.join(presenceDirFor(home), `${store.instanceId}.json`),
        };
    }

    it('claims no profile until a connect has landed, then writes it', () => {
        const h = harness();
        try {
            h.presence.start();
            assert.strictEqual(fs.existsSync(h.file()), false, 'a window that has not connected claims nothing');
            assert.strictEqual(h.logs.filter(line => line.includes('this instance runs')).length, 0);

            h.presence.connected();
            assert.ok(fs.existsSync(h.file()), 'the row is written once it is on a profile');
            assert.strictEqual(h.logs.filter(line => line.includes('this instance runs')).length, 1);

            h.presence.beat();
            assert.strictEqual(h.logs.filter(line => line.includes('this instance runs')).length, 1,
                'the same profile is not announced twice');

            h.setProfile('kitt');
            h.presence.connected();
            assert.ok(h.logs.some(line => line.includes('this instance runs "kitt"')));
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(h.file(), 'utf-8')).cliProfile, 'kitt');
            h.presence.dispose();
        } finally {
            fs.rmSync(h.home, { recursive: true, force: true });
        }
    });

    it('removes the row when the window closes, and says so once', () => {
        const h = harness();
        try {
            h.presence.start();
            h.presence.connected();
            h.presence.dispose();
            assert.strictEqual(fs.existsSync(h.file()), false, 'a closed window keeps no row');
            assert.strictEqual(h.logs.filter(line => line.includes('row removed')).length, 1);

            h.presence.dispose();
            assert.strictEqual(h.logs.filter(line => line.includes('row removed')).length, 1, 'and not twice');
        } finally {
            fs.rmSync(h.home, { recursive: true, force: true });
        }
    });

    it('a selection that never connects is not announced: the row keeps the profile it landed on', () => {
        const h = harness('dev-vsc');
        try {
            h.presence.start();
            h.presence.connected();

            // The picker now points at a profile another window runs; no connect lands on it.
            h.setProfile('kitt');
            h.presence.beat();
            h.presence.beat();

            assert.strictEqual(JSON.parse(fs.readFileSync(h.file(), 'utf-8')).cliProfile, 'dev-vsc',
                'the selection is not the truth; the connect is');
            assert.ok(!h.logs.some(line => line.includes('this instance runs "kitt"')),
                'and it is not announced either');
            h.presence.dispose();
        } finally {
            fs.rmSync(h.home, { recursive: true, force: true });
        }
    });

    it('a dropped connection takes the row away', () => {
        const h = harness();
        try {
            h.presence.start();
            h.presence.connected();
            assert.ok(fs.existsSync(h.file()));

            h.setLive(false);
            h.presence.beat();
            assert.strictEqual(fs.existsSync(h.file()), false, 'no live client, no row');
            assert.ok(h.logs.some(line => line.includes('row removed (disconnected)')));
            h.presence.dispose();
        } finally {
            fs.rmSync(h.home, { recursive: true, force: true });
        }
    });

    it('has nothing to announce without a profile, so the row goes', () => {
        const h = harness('default');
        try {
            h.presence.start();
            h.presence.connected();
            h.setProfile('');
            h.presence.connected();
            assert.strictEqual(fs.existsSync(h.file()), false);
            assert.ok(h.logs.some(line => line.includes('row removed (no profile)')));
            h.presence.dispose();
        } finally {
            fs.rmSync(h.home, { recursive: true, force: true });
        }
    });
});

/**
 * A row's identity: (workspace + role) when the window has a workspace, a random id otherwise.
 *
 * A random id per start left the previous row behind, and for 45 s it read as *another* window —
 * which made a window's own profile look taken and skipped it on the next start.
 */
describe('the presence identity', () => {
    it('is the workspace and the role, so a reload lands on the same row', () => {
        const a = presenceInstanceId('/w/one.code-workspace', 'primary');
        assert.strictEqual(a, presenceInstanceId('/w/one.code-workspace', 'primary'), 'the same pane of the same window');
        assert.match(a, /^[0-9a-f]{12}$/);
        assert.notStrictEqual(a, presenceInstanceId('/w/two.code-workspace', 'primary'), 'two workspaces, two ids');
        assert.notStrictEqual(a, presenceInstanceId('/w/one.code-workspace', 'secondant'), 'two panes, two ids');
    });

    it('is random for a window with no workspace', () => {
        assert.notStrictEqual(presenceInstanceId('', 'primary'), presenceInstanceId('', 'primary'));
        assert.notStrictEqual(presenceInstanceId(presenceInstanceId('', 'primary'), 'primary'), presenceInstanceId('', 'primary'));
    });

    it('a reload inside the stale window does not read as another window', () => {
        const home = tempHome();
        try {
            const id = presenceInstanceId('/w/one', 'primary');
            new PresenceStore(home, id).write({ role: 'primary', cliProfile: 'kitt', liveAt: 1000 });

            const reloaded = new PresenceStore(home, id);
            assert.deepStrictEqual(reloaded.live(1000 + 60_000), [], 'its own previous row is skipped, not "elsewhere"');
            assert.ok(fs.existsSync(path.join(presenceDirFor(home), `${id}.json`)), 'and the file is the one it writes');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('two workspaces keep two rows, side by side', () => {
        const home = tempHome();
        try {
            const one = new PresenceStore(home, presenceInstanceId('/w/one', 'primary'));
            const two = new PresenceStore(home, presenceInstanceId('/w/two', 'primary'));
            one.write({ role: 'primary', cliProfile: 'kitt', liveAt: 1000 });
            two.write({ role: 'primary', cliProfile: 'dev', liveAt: 1000 });
            assert.deepStrictEqual(one.live(1000).map(row => row.cliProfile), ['dev']);
            assert.deepStrictEqual(two.live(1000).map(row => row.cliProfile), ['kitt']);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('the sweep at start', () => {
    it('removes rows windows that are gone left behind, and leaves fresh ones alone', () => {
        const home = tempHome();
        try {
            const dir = presenceDirFor(home);
            const mine = new PresenceStore(home, presenceInstanceId('/w/one', 'primary'));
            const now = 1000 + PRESENCE_STALE_MS + 1;
            new PresenceStore(home, 'id-of-a-window-that-died').write({ role: 'primary', cliProfile: 'iris', liveAt: 1000 });
            new PresenceStore(home, 'id-of-a-live-window').write({ role: 'secondant', cliProfile: 'kitt', liveAt: now - 1000 });
            fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a row');

            assert.deepStrictEqual(mine.sweep(now), ['id-of-a-window-that-died']);
            assert.strictEqual(fs.existsSync(path.join(dir, 'id-of-a-window-that-died.json')), false);
            assert.strictEqual(fs.existsSync(path.join(dir, 'id-of-a-live-window.json')), true, 'a fresh row stays');
            assert.strictEqual(fs.existsSync(path.join(dir, 'notes.txt')), true, 'and a file that is not a row');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('has nothing to do on a home with no presence folder', () => {
        assert.deepStrictEqual(new PresenceStore(path.join(tempHome(), 'nope')).sweep(), []);
    });
});
