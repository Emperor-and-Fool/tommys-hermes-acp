import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PresenceStore, PRESENCE_STALE_MS, presenceDirFor } from '../../host/store/presence';
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
        const presence = new ProfilePresence({
            store,
            role: 'primary',
            profile: () => current,
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
            h.presence.beat();
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

    it('has nothing to announce without a profile, so the row goes', () => {
        const h = harness('default');
        try {
            h.presence.start();
            h.presence.connected();
            h.setProfile('');
            h.presence.beat();
            assert.strictEqual(fs.existsSync(h.file()), false);
            assert.ok(h.logs.some(line => line.includes('row removed (no profile)')));
            h.presence.dispose();
        } finally {
            fs.rmSync(h.home, { recursive: true, force: true });
        }
    });
});
