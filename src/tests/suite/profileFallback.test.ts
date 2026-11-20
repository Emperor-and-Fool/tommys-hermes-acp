import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    hasProfileMeta,
    hasProfileState,
    parsePreviousNames,
    profileNameFromPreviousNames,
    profileNameHoldingSessions,
} from '../../host/environment/profileFallback';
import { resolveHermesRoot } from '../../host/environment/hermesPaths';
import { HERMES_DEFAULT_PROFILE } from '../../host/environment/hermesProfile';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
}

/** A folder that is a profile: profile.yaml and state.db, as Hermes writes them. */
function writeProfile(hermesHome: string, name: string, previousNames: string[], sessionIds: string[] = []): void {
    const dir = path.join(hermesHome, 'profiles', name);
    fs.mkdirSync(dir, { recursive: true });
    const yaml = [
        'description: a test profile',
        'description_auto: false',
        'previous_names:',
        ...previousNames.map(previous => `  - ${previous}`),
        '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'profile.yaml'), yaml);
    createStateDb(path.join(dir, 'state.db'), sessionIds);
}

/** The table the search asks: one row per session, keyed by id. */
function createStateDb(dbPath: string, sessionIds: string[]): void {
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

/** Every file under a tree, with its bytes: the proof that a search wrote nothing (H2). */
function snapshot(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(target);
            } else {
                out.push(`${path.relative(dir, target)}:${fs.readFileSync(target).toString('base64')}`);
            }
        }
    };
    walk(dir);
    return out.sort();
}

describe('profile fallback', () => {
    it('reads previous_names in the block form and the inline form', () => {
        assert.deepStrictEqual(parsePreviousNames('previous_names:\n  - pa\n  - old-pa\n'), ['pa', 'old-pa']);
        assert.deepStrictEqual(parsePreviousNames('previous_names: [pa, "emai"]\n'), ['pa', 'emai']);
        assert.deepStrictEqual(parsePreviousNames('description: none\n'), []);
        assert.deepStrictEqual(parsePreviousNames('previous_names:\ndescription: none\n'), []);
    });

    it('stops at the next top-level key and survives a quoted name with a comment', () => {
        const yaml = [
            'previous_names:',
            "  - 'pa'  # the old name",
            'description: a profile',
            '  - not-a-name',
            '',
        ].join('\n');
        assert.deepStrictEqual(parsePreviousNames(yaml), ['pa']);
    });

    it('tells a profile from a folder that only looks like one', () => {
        const hermesHome = tempHome();
        try {
            const profiles = path.join(hermesHome, 'profiles');
            writeProfile(hermesHome, 'kitt', []);
            // A profile created without --description has no profile.yaml (Hermes writes it only
            // for one), and a folder that never ran has no state.db. Each search needs its own file.
            fs.mkdirSync(path.join(profiles, 'no-meta'), { recursive: true });
            createStateDb(path.join(profiles, 'no-meta', 'state.db'), []);
            fs.mkdirSync(path.join(profiles, 'no-state'), { recursive: true });
            fs.writeFileSync(path.join(profiles, 'no-state', 'profile.yaml'), 'description: never ran\n');
            fs.mkdirSync(path.join(profiles, 'dev'), { recursive: true });
            fs.writeFileSync(path.join(profiles, 'dev', 'chatter.txt'), 'left behind');
            assert.deepStrictEqual(
                [hasProfileMeta(path.join(profiles, 'kitt')), hasProfileState(path.join(profiles, 'kitt'))],
                [true, true]
            );
            assert.deepStrictEqual(
                [hasProfileMeta(path.join(profiles, 'no-meta')), hasProfileState(path.join(profiles, 'no-meta'))],
                [false, true]
            );
            assert.deepStrictEqual(
                [hasProfileMeta(path.join(profiles, 'no-state')), hasProfileState(path.join(profiles, 'no-state'))],
                [true, false]
            );
            assert.deepStrictEqual(
                [hasProfileMeta(path.join(profiles, 'dev')), hasProfileState(path.join(profiles, 'dev'))],
                [false, false]
            );
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('finds the profile whose previous_names holds the old name', () => {
        const hermesHome = tempHome();
        try {
            writeProfile(hermesHome, 'kitt', ['pa']);
            writeProfile(hermesHome, 'iris', ['emai']);
            assert.strictEqual(profileNameFromPreviousNames('pa', hermesHome), 'kitt');
            assert.strictEqual(profileNameFromPreviousNames('emai', hermesHome), 'iris');
            assert.strictEqual(profileNameFromPreviousNames('never-existed', hermesHome), undefined);
            assert.strictEqual(profileNameFromPreviousNames('', hermesHome), undefined);
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('finds a profile that has profile.yaml but no state.db by its old name, and never by its sessions', () => {
        const hermesHome = tempHome();
        try {
            const dir = path.join(hermesHome, 'profiles', 'pa');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'profile.yaml'), 'previous_names:\n  - old-pa\n');
            assert.strictEqual(profileNameFromPreviousNames('old-pa', hermesHome), 'pa');
            assert.strictEqual(profileNameHoldingSessions(['local-a'], hermesHome), undefined);
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('reaches a profile that has state.db and no profile.yaml by its sessions', () => {
        const hermesHome = tempHome();
        try {
            // What `hermes profile create` without --description leaves: no profile.yaml at all.
            const dir = path.join(hermesHome, 'profiles', 'kitt');
            fs.mkdirSync(dir, { recursive: true });
            createStateDb(path.join(dir, 'state.db'), ['local-a']);
            assert.strictEqual(profileNameHoldingSessions(['local-a'], hermesHome), 'kitt');
            assert.strictEqual(profileNameFromPreviousNames('kitt', hermesHome), undefined);
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('skips a folder with neither file, even when its name is supposed to be an old one', () => {
        const hermesHome = tempHome();
        try {
            // The leftover of the dev -> dev-vsc rename: nothing but its name.
            fs.mkdirSync(path.join(hermesHome, 'profiles', 'dev'), { recursive: true });
            assert.strictEqual(profileNameFromPreviousNames('pa', hermesHome), undefined);
            assert.strictEqual(profileNameHoldingSessions(['local-a'], hermesHome), undefined);
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('finds the profile whose state.db holds the session ids', () => {
        const hermesHome = tempHome();
        try {
            writeProfile(hermesHome, 'kitt', [], ['local-a', 'local-b']);
            writeProfile(hermesHome, 'iris', [], ['local-c']);
            assert.strictEqual(profileNameHoldingSessions(['local-b', 'nobody'], hermesHome), 'kitt');
            assert.strictEqual(profileNameHoldingSessions(['local-c'], hermesHome), 'iris');
            assert.strictEqual(profileNameHoldingSessions(['nobody'], hermesHome), undefined);
            assert.strictEqual(profileNameHoldingSessions([], hermesHome), undefined);
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('answers the default profile from the state.db at the root', () => {
        const hermesHome = tempHome();
        try {
            writeProfile(hermesHome, 'kitt', [], ['local-a']);
            createStateDb(path.join(hermesHome, 'state.db'), ['local-default']);
            assert.strictEqual(profileNameHoldingSessions(['local-default'], hermesHome), 'default');
            assert.strictEqual(profileNameHoldingSessions(['local-a'], hermesHome), 'kitt');
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });

    it('takes the profiles folder out of a HERMES_HOME that points at a profile', () => {
        const before = process.env.HERMES_HOME;
        try {
            process.env.HERMES_HOME = path.join(path.sep, 'home', 'someone', '.hermes', 'profiles', 'kitt');
            assert.strictEqual(resolveHermesRoot(), path.join(path.sep, 'home', 'someone', '.hermes'));
            process.env.HERMES_HOME = path.join(path.sep, 'home', 'someone', '.hermes');
            assert.strictEqual(resolveHermesRoot(), path.join(path.sep, 'home', 'someone', '.hermes'));
        } finally {
            if (before === undefined) {
                delete process.env.HERMES_HOME;
            } else {
                process.env.HERMES_HOME = before;
            }
        }
    });

    it('reads Hermes and writes nothing', () => {
        const hermesHome = tempHome();
        try {
            writeProfile(hermesHome, 'kitt', ['pa'], ['local-a']);
            createStateDb(path.join(hermesHome, 'state.db'), ['local-default']);
            const before = snapshot(hermesHome);
            profileNameFromPreviousNames('pa', hermesHome);
            profileNameHoldingSessions(['local-a', 'local-default'], hermesHome);
            assert.deepStrictEqual(snapshot(hermesHome), before);
        } finally {
            fs.rmSync(hermesHome, { recursive: true, force: true });
        }
    });
});

describe('a state.db that cannot be read', () => {
    it('is logged once and the next source answers', () => {
        const home = tempHome();
        try {
            const named = path.join(home, 'profiles', 'kitt');
            fs.mkdirSync(named, { recursive: true });
            fs.writeFileSync(path.join(named, 'state.db'), 'this is not a database');
            createStateDb(path.join(home, 'state.db'), ['s1']);

            const lines: string[] = [];
            const found = profileNameHoldingSessions(['s1'], home, line => lines.push(line));

            assert.strictEqual(found, HERMES_DEFAULT_PROFILE, 'the default profile holds the session');
            assert.strictEqual(lines.length, 1, 'one line for one unreadable database');
            assert.match(lines[0], /kitt state\.db could not be (opened|read)/);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
