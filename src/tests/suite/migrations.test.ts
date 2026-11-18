import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupDataHome, backupStamp, runMigrations } from '../../host/store/migrations';
import { activeSessionPathFor, sessionsPathFor } from '../../host/store/paths';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-migrate-'));
}

/** Every line a run logged, in order: what moved, merged or was left alone. */
function logger(): { lines: string[]; log: (line: string) => void } {
    const lines: string[] = [];
    return { lines, log: (line) => lines.push(line) };
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
            const first = logger();
            backupDataHome(home, first.log, new Date(2026, 10, 18));
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
            const first = logger();
            runMigrations(home, first.log);
            assert.strictEqual(fs.existsSync(path.join(home, 'sessions.json')), false);
            assert.strictEqual(fs.readFileSync(activeSessionPathFor(home, '__default__'), 'utf-8'), 'abc');
            assert.deepStrictEqual(first.lines, [
                'Backup: ' + path.basename(home) + '.backup-' + backupStamp() + ' written',
                'Migration: the root sessions.json moved into the default profile',
            ]);

            const second = logger();
            runMigrations(home, second.log);
            assert.strictEqual(fs.existsSync(sessionsPathFor(home, '__default__')), true);
            assert.deepStrictEqual(second.lines, ['Backup: ' + path.basename(home) + '.backup-' + backupStamp() + ' exists, left as it is']);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
            fs.rmSync(`${home}.backup-${backupStamp()}`, { recursive: true, force: true });
        }
    });
});
