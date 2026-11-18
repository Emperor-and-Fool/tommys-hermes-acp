import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Project, SessionInfo } from '../../shared/chat';
import { backupDataHome, backupStamp, runMigrations } from '../../host/store/migrations';
import { ProfilesStore } from '../../host/store/profiles';
import { activeSessionPathFor } from '../../host/store/paths';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-migrate-'));
}

/** Every line a run logged, in order: what moved, merged or was left alone. */
function logger(): { lines: string[]; log: (line: string) => void } {
    const lines: string[] = [];
    return { lines, log: (line) => lines.push(line) };
}

function tab(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
    return { title: overrides.id, createdAt: 1, updatedAt: 1, ...overrides };
}

/** A profile folder as it was written before the key moved: by name, tabs and projects inside. */
function writeProfileFolder(
    home: string,
    name: string,
    tabs: SessionInfo[],
    projects: Project[] = [],
    extra: Record<string, string> = {},
): string {
    const dir = path.join(home, 'profiles', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(tabs));
    if (projects.length) {
        fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify(projects));
    }
    for (const [file, contents] of Object.entries(extra)) {
        fs.writeFileSync(path.join(dir, file), contents);
    }
    return dir;
}

function readTabs(dir: string): SessionInfo[] {
    return JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf-8'));
}

function readProjects(dir: string): Project[] {
    return JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf-8'));
}

describe('data home migrations', () => {
    it('copies the home into a dated backup next to it', () => {
        const home = tempHome();
        try {
            fs.mkdirSync(path.join(home, 'profiles', 'kitt'), { recursive: true });
            fs.writeFileSync(path.join(home, 'profiles', 'kitt', 'sessions.json'), '[]');
            fs.writeFileSync(path.join(home, 'profiles.json'), '{"profiles":[]}');
            const { lines, log } = logger();
            const target = backupDataHome(home, log, new Date(2026, 10, 18));
            assert.strictEqual(target, `${home}.backup-20261118`);
            assert.strictEqual(fs.existsSync(path.join(target!, 'profiles', 'kitt', 'sessions.json')), true);
            assert.deepStrictEqual(lines, [`Backup: ${path.basename(home)}.backup-20261118 written`]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-20261118`, { recursive: true, force: true });
        }
    });

    it('names the backup yyyymmdd', () => {
        assert.strictEqual(backupStamp(new Date(2026, 0, 5)), '20260105');
        assert.strictEqual(backupStamp(new Date(2026, 11, 31)), '20261231');
    });

    it('never overwrites a backup that is already there', () => {
        const home = tempHome();
        const target = `${home}.backup-20261118`;
        try {
            fs.writeFileSync(path.join(home, 'profiles.json'), '{"profiles":[]}');
            backupDataHome(home, logger().log, new Date(2026, 10, 18));
            fs.writeFileSync(path.join(target, 'marker.txt'), 'the first backup');
            fs.writeFileSync(path.join(home, 'profiles.json'), '{"profiles":[{"later":true}]}');
            const second = logger();
            backupDataHome(home, second.log, new Date(2026, 10, 18));
            assert.strictEqual(fs.readFileSync(path.join(target, 'profiles.json'), 'utf-8'), '{"profiles":[]}');
            assert.strictEqual(fs.readFileSync(path.join(target, 'marker.txt'), 'utf-8'), 'the first backup');
            assert.deepStrictEqual(second.lines, ['Backup: ' + path.basename(target) + ' exists, left as it is']);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(target, { recursive: true, force: true });
        }
    });

    it('leaves a home that is not there alone', () => {
        const missing = path.join(os.tmpdir(), 'hermes-migrate-absent-' + Date.now());
        const { lines, log } = logger();
        assert.strictEqual(backupDataHome(missing, log, new Date(2026, 10, 18)), undefined);
        assert.deepStrictEqual(lines, []);
    });

    it('moves the pre-profile sessions.json into the default folder, once', () => {
        const home = tempHome();
        try {
            fs.writeFileSync(path.join(home, 'sessions.json'), '[]');
            fs.writeFileSync(path.join(home, 'active-session.txt'), 'abc');
            // What environment/profiles.ts answers for the default profile's scope key.
            const resolver = (scope: string): string | undefined => (scope === '__default__' ? 'default' : undefined);
            const first = logger();
            runMigrations(home, resolver, first.log);
            assert.strictEqual(fs.existsSync(path.join(home, 'sessions.json')), false);
            const defaultId = new ProfilesStore(home).idFor('default');
            assert.strictEqual(fs.readFileSync(activeSessionPathFor(home, defaultId), 'utf-8'), 'abc');
            assert.strictEqual(fs.existsSync(path.join(home, 'profiles', '__default__')), false);
            assert.deepStrictEqual(first.lines, [
                'Backup: ' + path.basename(home) + '.backup-' + backupStamp() + ' written',
                'Migration: the root sessions.json moved into the default profile',
                "Migration: profiles/__default__ moved to default's id folder",
            ]);

            const second = logger();
            runMigrations(home, resolver, second.log);
            assert.strictEqual(fs.existsSync(path.join(home, 'profiles', defaultId, 'sessions.json')), true);
            assert.deepStrictEqual(second.lines, ['Backup: ' + path.basename(home) + '.backup-' + backupStamp() + ' exists, left as it is']);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });

    it('moves a folder written under the agent name to the agent id folder', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const id = store.idFor('kitt');
            writeProfileFolder(home, 'kitt', [tab({ id: 't1', hermesSessionId: 'h1' })], [], { 'notes.md': 'mine' });
            const { lines, log } = logger();
            runMigrations(home, () => 'kitt', log);
            assert.strictEqual(fs.existsSync(path.join(home, 'profiles', 'kitt')), false);
            assert.deepStrictEqual(readTabs(path.join(home, 'profiles', id)).map(t => t.id), ['t1']);
            assert.strictEqual(fs.readFileSync(path.join(home, 'profiles', id, 'notes.md'), 'utf-8'), 'mine');
            assert.deepStrictEqual(lines, [
                `Backup: ${path.basename(home)}.backup-${backupStamp()} written`,
                "Migration: profiles/kitt moved to kitt's id folder",
            ]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });

    it('merges into an id folder that already exists, keeping the centre tags', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const id = store.idFor('kitt');
            const centre = path.join(home, 'profiles', id);
            writeProfileFolder(home, id, [
                tab({ id: 't1', hermesSessionId: 'h1', project: 'p-centre' }),
                tab({ id: 't2', hermesSessionId: 'h2', workspaceId: 'w1' }),
            ], [{ id: 'p-centre', name: 'Projects', workspaceId: 'w1' }]);
            writeProfileFolder(home, 'kitt', [
                tab({ id: 't1', hermesSessionId: 'h1', project: 'p-side', workspaceId: 'w1' }),
                tab({ id: 't3', hermesSessionId: 'h3' }),
            ], [
                { id: 'p-side', name: 'Other', workspaceId: 'w1' },
                { id: 'p-new', name: 'Docs', workspaceId: 'w1' },
            ], { 'docs.md': 'from the side' });
            const { lines, log } = logger();
            runMigrations(home, () => 'kitt', log);

            const tabs = readTabs(centre);
            assert.deepStrictEqual(tabs.map(t => t.id).sort(), ['t1', 't2', 't3']);
            const t1 = tabs.find(t => t.id === 't1')!;
            // The centre's project wins; the workspace it lacked is taken from the side.
            assert.strictEqual(t1.project, 'p-centre');
            assert.strictEqual(t1.workspaceId, 'w1');
            const projects = readProjects(centre);
            // One "Projects" in one workspace is one project; "Docs" is new.
            assert.deepStrictEqual(projects.map(p => p.name).sort(), ['Docs', 'Other', 'Projects']);
            const t3 = tabs.find(t => t.id === 't3')!;
            assert.strictEqual(t3.project, undefined);
            assert.strictEqual(fs.readFileSync(path.join(centre, 'docs.md'), 'utf-8'), 'from the side');
            assert.deepStrictEqual(lines, [
                `Backup: ${path.basename(home)}.backup-${backupStamp()} written`,
                'Migration: profiles/kitt project "Other" taken over',
                'Migration: profiles/kitt project "Docs" taken over',
                'Migration: profiles/kitt projects merged (2 added)',
                'Migration: profiles/kitt tab t1 keeps its project ("p-centre" over "p-side")',
                'Migration: profiles/kitt tabs merged (1 added)',
                'Migration: profiles/kitt 1 file(s) copied in',
            ]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });

    it('leaves a folder alone when no agent answers for its name', () => {
        const home = tempHome();
        try {
            writeProfileFolder(home, 'dev', [tab({ id: 't1', hermesSessionId: 'h1' })]);
            const { lines, log } = logger();
            runMigrations(home, () => undefined, log);
            assert.strictEqual(fs.existsSync(path.join(home, 'profiles', 'dev', 'sessions.json')), true);
            assert.deepStrictEqual(lines, [
                `Backup: ${path.basename(home)}.backup-${backupStamp()} written`,
                'Migration: profiles/dev names no agent, left as it is',
            ]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });

    it('takes an old-name folder by the previous name it has, and by the sessions it holds', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const kittId = store.idFor('kitt');
            const irisId = store.idFor('iris');
            writeProfileFolder(home, 'pa', [tab({ id: 't1', hermesSessionId: 'h1' })]);
            writeProfileFolder(home, 'emai', [tab({ id: 't2', hermesSessionId: 'h2' })]);
            // What environment/profiles.ts does: the previous name first, then the session ids.
            const byPreviousName = (scope: string): string | undefined =>
                ({ pa: 'kitt', emai: 'iris' } as Record<string, string>)[scope];
            const bySession = (scope: string, ids: string[]): string | undefined =>
                byPreviousName(scope) || (ids.includes('h2') ? 'iris' : undefined);
            runMigrations(home, bySession, logger().log);
            assert.deepStrictEqual(readTabs(path.join(home, 'profiles', kittId)).map(t => t.id), ['t1']);
            assert.deepStrictEqual(readTabs(path.join(home, 'profiles', irisId)).map(t => t.id), ['t2']);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });

    it('is a no-op on a second run: same bytes, no log', () => {
        const home = tempHome();
        try {
            const store = new ProfilesStore(home);
            const id = store.idFor('kitt');
            fs.mkdirSync(path.join(home, 'profiles', id), { recursive: true });
            writeProfileFolder(home, id, [tab({ id: 't1', hermesSessionId: 'h1', project: 'p1' })], [
                { id: 'p1', name: 'Projects', workspaceId: 'w1' },
            ]);
            writeProfileFolder(home, 'kitt', [
                tab({ id: 't1', hermesSessionId: 'h1', project: 'p-side' }),
                tab({ id: 't3', hermesSessionId: 'h3' }),
            ], [{ id: 'p-side', name: 'Projects', workspaceId: 'w1' }]);
            runMigrations(home, () => 'kitt', logger().log);
            const before = fs.readFileSync(path.join(home, 'profiles', id, 'sessions.json'), 'utf-8');
            const second = logger();
            runMigrations(home, () => 'kitt', second.log);
            assert.strictEqual(fs.readFileSync(path.join(home, 'profiles', id, 'sessions.json'), 'utf-8'), before);
            assert.deepStrictEqual(second.lines, [`Backup: ${path.basename(home)}.backup-${backupStamp()} exists, left as it is`]);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });
});
