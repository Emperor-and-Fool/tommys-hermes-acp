import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Profiles, excludedProfiles } from '../../host/environment/profiles';
import { ProfilesStore } from '../../host/store/profiles';

function createStateDb(dbPath: string, sessionIds: string[]): void {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = require('node:sqlite') as typeof import('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath);
    try {
        db.exec('create table sessions (id text primary key)');
        const insert = db.prepare('insert into sessions (id) values (?)');
        for (const id of sessionIds) {
            insert.run(id);
        }
    } finally {
        db.close();
    }
}

function setup(
    settings: Record<string, unknown> = {},
    hermesHome?: string,
    excluded: Array<{ cliProfile: string }> = [],
    logs: string[] = [],
    start: { persisted?: string; workspace?: string; held?: string[] } = {},
) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-target-'));
    const store = new ProfilesStore(home);
    const profiles = new Profiles({
        log: (line: string) => {
            logs.push(line);
        },
        post: () => undefined,
        globalState: {
            get: <T>(key: string) => (key === 'activeSelectionId' ? start.persisted as T | undefined : undefined as T | undefined),
            update: () => Promise.resolve(),
        },
        settings: { get: <T>(key: string) => settings[key] as T | undefined },
        store,
        hermesHome: hermesHome ? () => hermesHome : undefined,
        excludedProfiles: () => excluded,
        // A start rule needs this window's saved pick and the profiles other windows hold; both
        // are absent in the tests that only resolve a name.
        workspaceSelection: start.workspace === undefined ? undefined : () => start.workspace as string,
        heldElsewhere: start.held === undefined ? undefined : () => start.held as string[],
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

describe('connecting by the name Hermes has', () => {
    it('repairs a name Hermes renamed, keeps the id, and returns the name it found', () => {
        const hermes = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
        const { home, store, profiles } = setup({ profile: 'pa' }, hermes);
        try {
            const id = store.idFor('pa');
            fs.mkdirSync(path.join(hermes, 'profiles', 'kitt'), { recursive: true });
            fs.writeFileSync(path.join(hermes, 'profiles', 'kitt', 'profile.yaml'), 'previous_names:\n  - pa\n');
            createStateDb(path.join(hermes, 'profiles', 'kitt', 'state.db'), []);

            const { target, missing } = profiles.connectTarget(undefined, []);
            assert.strictEqual(missing, false);
            assert.strictEqual(target.agentName, 'kitt');
            assert.strictEqual(target.cliProfile, 'kitt');
            // The id is the id: only the name it answers to moved.
            assert.strictEqual(target.sessionProfileId, id);
            assert.strictEqual(store.nameFor(id), 'kitt');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('finds the profile by the sessions of our tabs when no previous name does', () => {
        const hermes = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
        const { home, store, profiles } = setup({ profile: 'pa' }, hermes);
        try {
            const id = store.idFor('pa');
            fs.mkdirSync(path.join(hermes, 'profiles', 'kitt'), { recursive: true });
            fs.writeFileSync(path.join(hermes, 'profiles', 'kitt', 'profile.yaml'), 'description: renamed\n');
            createStateDb(path.join(hermes, 'profiles', 'kitt', 'state.db'), ['h-open-tab']);

            const { target, missing } = profiles.connectTarget(undefined, ['h-open-tab']);
            assert.strictEqual(missing, false);
            assert.strictEqual(target.agentName, 'kitt');
            assert.strictEqual(target.sessionProfileId, id);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('says the profile is missing when Hermes has profiles and none answers', () => {
        const hermes = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
        const { home, store, profiles } = setup({ profile: 'pa' }, hermes);
        try {
            store.idFor('pa');
            fs.mkdirSync(path.join(hermes, 'profiles'), { recursive: true });
            const { missing } = profiles.connectTarget(undefined, []);
            assert.strictEqual(missing, true);
            // Nothing was renamed: the row still holds the name it had.
            assert.strictEqual(store.nameFor(store.idFor('pa')), 'pa');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('does not call a name missing on a machine Hermes never ran on', () => {
        const hermes = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
        const { home, store, profiles } = setup({ profile: 'pa' }, hermes);
        try {
            store.idFor('pa');
            const { missing } = profiles.connectTarget(undefined, []);
            assert.strictEqual(missing, false);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });
});

describe('the exclusion list', () => {
    it("is this window's sibling plus what the other windows announced", () => {
        const list = excludedProfiles({
            sibling: 'kitt',
            elsewhere: [{ cliProfile: 'dev' }, { cliProfile: '' }],
        });
        assert.deepStrictEqual(list, [
            { cliProfile: 'kitt', holder: 'holderSecondantHere' },
            { cliProfile: 'dev', holder: 'holderPrimaryElsewhere' },
        ]);
    });

    it('names the primary, and trims the profile it is given', () => {
        const list = excludedProfiles({ primary: '  dev  ', elsewhere: [] });
        assert.deepStrictEqual(list, [{ cliProfile: 'dev', holder: 'holderPrimaryHere' }]);
    });

    it('keeps the role of a profile held in another window', () => {
        const list = excludedProfiles({
            elsewhere: [{ cliProfile: 'kitt', role: 'secondant' }, { cliProfile: 'dev', role: 'primary' }],
        });
        assert.deepStrictEqual(list, [
            { cliProfile: 'kitt', holder: 'holderSecondantElsewhere' },
            { cliProfile: 'dev', holder: 'holderPrimaryElsewhere' },
        ]);
    });

    it('offers none of the excluded profiles in the picker', () => {
        const { home, profiles } = setup(
            { agents: [{ name: 'A', profile: 'dev' }, { name: 'B', profile: 'kitt' }] },
            undefined,
            [{ cliProfile: 'dev' }, { cliProfile: 'kitt' }]
        );
        try {
            assert.deepStrictEqual(profiles.entries(), [], 'both are held elsewhere');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('offers the ones nothing excludes', () => {
        const { home, profiles } = setup(
            { agents: [{ name: 'A', profile: 'dev' }, { name: 'B', profile: 'kitt' }] },
            undefined,
            [{ cliProfile: 'dev' }]
        );
        try {
            assert.deepStrictEqual(profiles.entries().map(entry => entry.id), ['B']);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

/**
 * The search reads every profile's state.db while Hermes may be writing it, so a database that will
 * not open, or will not answer, is an ordinary answer — but an answer that says so. `profileFallback`
 * logs it through the caller; this is the caller.
 */
describe('the profile search says what it skipped', () => {
    it('reports a state.db it could not read, through the host log', () => {
        const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-broken-'));
        try {
            const broken = path.join(hermesHome, 'profiles', 'broken');
            fs.mkdirSync(broken, { recursive: true });
            fs.writeFileSync(path.join(broken, 'state.db'), 'this is not a database');
            const logs: string[] = [];
            const { home, store, profiles } = setup({ profile: 'gone-profile' }, hermesHome, [], logs);
            store.idFor('gone-profile');

            const target = profiles.connectTarget(undefined, ['session-1']);

            assert.ok(logs.some(line => line.includes('state.db could not be')),
                `the skip is logged, not silent: ${JSON.stringify(logs)}`);
            assert.strictEqual(target.missing, true, 'and the name stays unresolved');
            fs.rmSync(home, { recursive: true, force: true });
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });
});

/**
 * The start rule: this workspace's pick, then the last pick anywhere, and never one another window
 * is running. The middle step is the fallback the global key still exists for.
 */
describe('the profile a window starts on', () => {
    it("this workspace's pick wins over the last pick anywhere", () => {
        const { home, profiles } = setup({}, undefined, [], [], { workspace: 'kitt', persisted: 'dev' });
        try {
            assert.strictEqual(profiles.seed().cliProfile, 'kitt');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('skips a pick another window is running, and takes the next one', () => {
        const { home, profiles } = setup({}, undefined, [], [], { workspace: 'kitt', persisted: 'dev', held: ['kitt'] });
        try {
            assert.strictEqual(profiles.seed().cliProfile, 'dev', 'the global fallback, which nobody holds');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('leaves the target on its configured profile when every pick is held elsewhere', () => {
        const { home, profiles } = setup({}, undefined, [], [], { workspace: 'kitt', persisted: 'dev', held: ['kitt', 'dev'] });
        try {
            const target = profiles.seed();
            assert.strictEqual(target.agentName, 'default', 'nothing picked: the first-free behaviour, as before');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('falls back to the last pick anywhere when this workspace never saved one', () => {
        const { home, profiles } = setup({}, undefined, [], [], { persisted: 'dev' });
        try {
            assert.strictEqual(profiles.seed().cliProfile, 'dev');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
