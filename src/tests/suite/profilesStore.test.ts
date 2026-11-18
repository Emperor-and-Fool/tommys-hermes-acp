import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfilesStore, profilesPathFor } from '../../host/store/profiles';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-'));
}

describe('profiles store', () => {
    it('mints an id on first sight and keeps it', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const first = store.idFor('kitt');
            assert.ok(first.length > 0);
            assert.strictEqual(store.idFor('kitt'), first);
            assert.deepStrictEqual(store.all(), [{ sessionProfileId: first, agentName: 'kitt' }]);
            assert.strictEqual(fs.existsSync(profilesPathFor(home)), true);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('writes the table at the root of the data home, above the profile folders', () => {
        const home = tempHome();
        try {
            new ProfilesStore(home).idFor('default');
            assert.strictEqual(profilesPathFor(home), path.join(home, 'profiles.json'));
            assert.strictEqual(fs.existsSync(path.join(home, 'profiles', 'profiles.json')), false);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('answers the name for an id, and nothing for an id it does not hold', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const id = store.idFor('iris');
            assert.strictEqual(store.nameFor(id), 'iris');
            assert.strictEqual(store.nameFor('no-such-id'), undefined);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('renames a profile without moving its id', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const id = store.idFor('pa');
            store.rename(id, 'kitt');
            assert.strictEqual(store.nameFor(id), 'kitt');
            assert.strictEqual(store.idFor('kitt'), id);
            assert.strictEqual(store.all().length, 1);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('seeds only the names it does not have, and changes no existing row', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const defaultId = store.idFor('default');
            assert.strictEqual(store.seed(['default', 'kitt', 'iris']), 2);
            assert.strictEqual(store.seed(['default', 'kitt', 'iris']), 0);
            assert.strictEqual(store.seed(['m365-clippy']), 1);
            assert.strictEqual(store.idFor('default'), defaultId);
            assert.deepStrictEqual(store.all().map(row => row.agentName), [
                'default',
                'kitt',
                'iris',
                'm365-clippy',
            ]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('skips a blank name while seeding, and refuses one when asked for an id', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            assert.strictEqual(store.seed(['', '  ', 'default']), 1);
            assert.throws(() => store.idFor('   '), /a profile name is required/);
            assert.throws(() => store.rename('any-id', ''), /a profile name is required/);
            assert.strictEqual(store.all().length, 1);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('carries a key it does not know through a write', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const id = store.idFor('kitt');
            fs.writeFileSync(
                profilesPathFor(home),
                JSON.stringify({ profiles: [{ sessionProfileId: id, agentName: 'kitt', note: 'kept' }] })
            );
            store.seed(['iris']);
            const written = JSON.parse(fs.readFileSync(profilesPathFor(home), 'utf-8'));
            assert.strictEqual(written.profiles[0].note, 'kept');
            assert.strictEqual(written.profiles[0].agentName, 'kitt');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('reads the folders the data home already holds', () => {
        const home = tempHome();
        try {
            fs.mkdirSync(path.join(home, 'profiles', 'dev'), { recursive: true });
            fs.mkdirSync(path.join(home, 'profiles', '__default__'), { recursive: true });
            fs.writeFileSync(path.join(home, 'profiles', 'notes.txt'), 'not a profile');
            assert.deepStrictEqual(new ProfilesStore(home).localScopes(), ['__default__', 'dev']);
            assert.deepStrictEqual(new ProfilesStore(path.join(home, 'nowhere')).localScopes(), []);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
