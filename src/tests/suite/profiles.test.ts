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
    start: { workspace?: string; held?: string[] } = {},
    role: 'primary' | 'secondant' = 'primary',
) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-target-'));
    const store = new ProfilesStore(home);
    // What a connect would save for this pane: the role is the port's business, not Profiles'.
    const saved: Array<{ role: 'primary' | 'secondant'; selectionId: string }> = [];
    const profiles = new Profiles({
        log: (line: string) => {
            logs.push(line);
        },
        post: () => undefined,
        settings: { get: <T>(key: string) => settings[key] as T | undefined },
        store,
        hermesHome: hermesHome ? () => hermesHome : undefined,
        excludedProfiles: () => excluded,
        // The start rule's three: a test that only resolves a name supplies the empty answers.
        workspaceSelection: () => start.workspace || '',
        saveWorkspaceSelection: (selectionId: string) => {
            saved.push({ role, selectionId });
        },
        heldElsewhere: () => start.held || [],
    });
    return { home, store, profiles, saved, logs };
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

/**
 * What the picker is offered comes from Hermes (`hermes profile list`; `ensureDiscovered` spawns
 * it). A test about what the picker does with that list hands it the answer instead of running the
 * CLI — the parsing of the table has its own test. Names only: the id a picker row carries is the
 * Hermes name today.
 */
const discover = (profiles: Profiles, names: string[]): void => {
    (profiles as unknown as { discovered: string[] | null }).discovered = names;
};

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
            {},
            undefined,
            [{ cliProfile: 'default' }, { cliProfile: 'dev' }, { cliProfile: 'kitt' }]
        );
        try {
            discover(profiles, ['default', 'dev', 'kitt']);
            assert.deepStrictEqual(profiles.entries(), [], 'every profile Hermes has is held elsewhere');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('offers the ones nothing excludes', () => {
        const { home, profiles } = setup(
            {},
            undefined,
            [{ cliProfile: 'default' }, { cliProfile: 'dev' }]
        );
        try {
            discover(profiles, ['default', 'dev', 'kitt']);
            assert.deepStrictEqual(
                profiles.entries().map(entry => entry.id),
                ['kitt'],
                'the only profile no window is running'
            );
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
 * The start rule: this workspace's pick, then the configured profile (`default`), then the first
 * profile no other window holds. A candidate another window is running is skipped — and there is
 * no "last picked anywhere" step, so a start never lands on another window's profile.
 */
describe('the profile a window starts on', () => {
    it("this workspace's pick is taken", () => {
        const { home, profiles } = setup({}, undefined, [], [], { workspace: 'kitt' });
        try {
            assert.strictEqual(profiles.seed().cliProfile, 'kitt');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('skips a pick another window is running, and takes the configured profile instead', () => {
        const { home, profiles, logs } = setup({}, undefined, [], [], { workspace: 'kitt', held: ['kitt'] });
        try {
            assert.strictEqual(profiles.seed().cliProfile, 'default', 'the configured profile, not another window\'s pick');
            assert.ok(logs.some(line => line.includes('is held by another window; skipping it')));
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('takes the first profile nobody holds when this workspace\'s pick and the default are both taken', () => {
        const { home, store, profiles } = setup({}, undefined, [], [], { workspace: 'kitt', held: ['kitt', 'default'] });
        try {
            store.seed(['kitt', 'dev']);
            assert.strictEqual(profiles.seed().cliProfile, 'dev', 'the first free one in the table');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('a start saves nothing; the connect is what writes the pick', () => {
        const { home, profiles, saved } = setup({}, undefined, [], [], { workspace: '' });
        const secondant = setup({}, undefined, [], [], { workspace: '' }, 'secondant');
        try {
            const target = profiles.seed();
            assert.deepStrictEqual(saved, [], 'seeding is not a pick');
            profiles.persistSelection();
            assert.deepStrictEqual(saved, [{ role: 'primary', selectionId: target.selectionId }]);

            const other = secondant.profiles.seed();
            secondant.profiles.persistSelection();
            assert.deepStrictEqual(secondant.saved, [{ role: 'secondant', selectionId: other.selectionId }], 'its own column');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(secondant.home, { recursive: true, force: true });
        }
    });

    it('no saved pair and nothing configured starts on the default profile', () => {
        const { home, profiles } = setup({}, undefined, [], [], {});
        try {
            assert.strictEqual(profiles.seed().agentName, 'default');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
