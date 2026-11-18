import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Profiles } from '../../host/environment/profiles';
import { ProfilesStore } from '../../host/store/profiles';

function setup(settings: Record<string, unknown> = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-target-'));
    const store = new ProfilesStore(home);
    const profiles = new Profiles({
        log: () => undefined,
        post: () => undefined,
        globalState: {
            get: <T>(key: string) => (key === 'activeSelectionId' ? undefined as T | undefined : undefined as T | undefined),
            update: () => Promise.resolve(),
        },
        settings: { get: <T>(key: string) => settings[key] as T | undefined },
        store,
    });
    return { home, store, profiles };
}

describe('the profile target', () => {
    it('translates the name to our id once, and keeps the name beside it', () => {
        const { home, store, profiles } = setup({ profile: 'kitt' });
        try {
            const target = profiles.resolveTarget();
            assert.strictEqual(target.agentName, 'kitt');
            assert.strictEqual(target.cliProfile, 'kitt');
            assert.strictEqual(target.sessionProfileId, store.idFor('kitt'));
            // A uuid, not the name: that is what keeps a rename from moving the folder.
            assert.match(target.sessionProfileId, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
            assert.strictEqual(profiles.resolveTarget().sessionProfileId, target.sessionProfileId);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('gives the default profile an id of its own, and the default name', () => {
        const { home, store, profiles } = setup();
        try {
            const target = profiles.resolveTarget();
            assert.strictEqual(target.agentName, 'default');
            assert.strictEqual(target.sessionProfileId, store.idFor('default'));
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('keeps a configured agent on its display-name key, with the profile it runs on', () => {
        const { home, profiles } = setup({ agents: [{ name: 'My Agent', profile: 'kitt' }] });
        try {
            const target = profiles.resolveTarget();
            assert.strictEqual(target.sessionProfileId, 'My Agent');
            assert.strictEqual(target.agentName, 'My Agent');
            assert.strictEqual(target.cliProfile, 'kitt');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
