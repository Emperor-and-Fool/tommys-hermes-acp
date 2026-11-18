import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    isHermesProfile,
    parsePreviousNames,
    profileNameFromPreviousNames,
    profileNameHoldingSessions,
} from '../../host/environment/profileFallback';
import { resolveHermesRoot } from '../../host/environment/hermesPaths';

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
            writeProfile(hermesHome, 'kitt', []);
            fs.mkdirSync(path.join(hermesHome, 'profiles', 'dev'), { recursive: true });
            fs.writeFileSync(path.join(hermesHome, 'profiles', 'dev', 'chatter.txt'), 'left behind');
            assert.strictEqual(isHermesProfile(path.join(hermesHome, 'profiles', 'kitt')), true);
            assert.strictEqual(isHermesProfile(path.join(hermesHome, 'profiles', 'dev')), false);
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

    it('skips a folder without profile.yaml and state.db when the old name names it', () => {
        const hermesHome = tempHome();
        try {
            // The leftover of the dev -> dev-vsc rename: nothing but its name.
            fs.mkdirSync(path.join(hermesHome, 'profiles', 'dev'), { recursive: true });
            fs.writeFileSync(path.join(hermesHome, 'profiles', 'dev', 'profile.yaml'), 'previous_names:\n  - pa\n');
            assert.strictEqual(profileNameFromPreviousNames('pa', hermesHome), undefined);
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
