/**
 * The patch rules against real git, on real Hermes files.
 *
 * The other patch tests model a checkout so the decisions can be read; this one runs the actual
 * commands against a throwaway repository built from two pristine snapshots — `acp_adapter/` at
 * Hermes v0.22.6 and at v0.23.3 (see `src/tests/fixtures/`, MIT, Nous Research). It is the only test
 * that can show that our patch files apply where we say they do, and that a Fix leaves exactly the
 * set it claims.
 *
 * Git runs offline against the temp repository. Nothing here touches ~/.hermes.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import assert from 'assert';
import {
    fixPatchState,
    PatchState,
    readPatchState,
    runGit,
} from '../../host/environment/patchState';

/** `out/tests/suite` → the repository root, where `src/` and `packaging/` live. */
const ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURES = path.join(ROOT, 'src', 'tests', 'fixtures');
const PATCH_DIR = path.join(ROOT, 'packaging', 'hermes-patches');

const P0001 = '0001-acp-session-catalog-hidden-title.patch';
const P0002 = '0002-acp-gateway-ext-methods.patch';
const P0003 = '0003-acp-023x-session-catalog-hidden-title.patch';

async function git(cwd: string, args: string[]): Promise<string> {
    const answer = await runGit(args, cwd);
    assert.strictEqual(answer.code, 0, `git ${args.join(' ')} failed: ${answer.output}`);
    return answer.output;
}

/** A temp repository whose `acp_adapter/` is one pristine Hermes snapshot, committed as its base. */
async function repository(fixture: 'hermes-0.22.6' | 'hermes-0.23.3'): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `patch-real-${fixture}-`));
    fs.cpSync(path.join(FIXTURES, fixture, 'acp_adapter'), path.join(dir, 'acp_adapter'), { recursive: true });
    await git(dir, ['init', '-q', '.']);
    await git(dir, ['add', '-A']);
    await git(dir, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'fixture']);
    return dir;
}

async function apply(cwd: string, patch: string): Promise<void> {
    await git(cwd, ['apply', path.join(PATCH_DIR, patch)]);
}

function state(cwd: string, version: string): Promise<PatchState> {
    return readPatchState({ checkout: cwd, patchDir: PATCH_DIR, version, run: runGit });
}

/** Every file's content hash, to prove a tree was left alone. */
function fingerprint(cwd: string): string {
    const hash = crypto.createHash('sha256');
    for (const name of fs.readdirSync(path.join(cwd, 'acp_adapter')).sort()) {
        const file = path.join(cwd, 'acp_adapter', name);
        if (fs.statSync(file).isFile()) {
            hash.update(name);
            hash.update(fs.readFileSync(file));
        }
    }
    return hash.digest('hex');
}

/** Run the fix where the state asks for one, then require the checkout to read ok. */
async function fixAndCheck(cwd: string, version: string, before: PatchState): Promise<void> {
    const result = await fixPatchState({ checkout: cwd, patchDir: PATCH_DIR, state: before, run: runGit });
    assert.strictEqual(result.changed, true, result.log.join('\n'));
    const after = await state(cwd, version);
    assert.strictEqual(after.kind, 'ok', `after Fix: ${after.kind} ${after.kind === 'unknown' ? after.reason : ''}`);
}

describe('real git: Hermes v0.22.6 needs 0001 + 0002', () => {
    it('missing → Fix → ok', async () => {
        const dir = await repository('hermes-0.22.6');
        try {
            const before = await state(dir, '0.22.6');
            assert.strictEqual(before.kind, 'missing', before.kind);
            assert.deepStrictEqual(before.kind === 'missing' ? before.applicable : [], ['0001', '0002']);
            await fixAndCheck(dir, '0.22.6', before);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('ok reads ok and Fix changes nothing', async () => {
        const dir = await repository('hermes-0.22.6');
        try {
            await apply(dir, P0001);
            await apply(dir, P0002);
            const before = await state(dir, '0.22.6');
            assert.strictEqual(before.kind, 'ok', before.kind);
            const fingerprintBefore = fingerprint(dir);
            const result = await fixPatchState({ checkout: dir, patchDir: PATCH_DIR, state: before, run: runGit });
            assert.strictEqual(result.changed, false);
            assert.strictEqual(fingerprint(dir), fingerprintBefore, 'byte for byte');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an edit of our own reads unknown, and Fix leaves it untouched', async () => {
        const dir = await repository('hermes-0.22.6');
        try {
            const file = path.join(dir, 'acp_adapter', 'session.py');
            fs.appendFileSync(file, '\n# a hand edit that is not one of our sets\n');
            const fingerprintBefore = fingerprint(dir);
            const found = await state(dir, '0.22.6');
            assert.strictEqual(found.kind, 'unknown', found.kind);
            const result = await fixPatchState({ checkout: dir, patchDir: PATCH_DIR, state: found, run: runGit });
            assert.strictEqual(result.changed, false);
            assert.strictEqual(fingerprint(dir), fingerprintBefore, 'byte for byte');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('real git: Hermes v0.23.3 needs 0003 alone', () => {
    it('missing → Fix → ok', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            const before = await state(dir, '0.23.3');
            assert.strictEqual(before.kind, 'missing', before.kind);
            assert.deepStrictEqual(before.kind === 'missing' ? before.applicable : [], ['0003']);
            await fixAndCheck(dir, '0.23.3', before);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('ok reads ok', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            await apply(dir, P0003);
            const before = await state(dir, '0.23.3');
            assert.strictEqual(before.kind, 'ok', before.kind);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('the 0.22 set on 0.23.3 reads wrong, and Fix replaces it', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            // Both apply cleanly — that is the whole hazard: nothing on disk says they are wrong.
            await apply(dir, P0001);
            await apply(dir, P0002);
            const before = await state(dir, '0.23.3');
            assert.strictEqual(before.kind, 'wrong', before.kind);
            assert.deepStrictEqual(before.kind === 'wrong' ? before.extra : [], ['0001', '0002']);
            assert.deepStrictEqual(before.kind === 'wrong' ? before.missing : [], ['0003']);
            await fixAndCheck(dir, '0.23.3', before);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('the 0.22 set plus 0003 reads wrong, and Fix removes only the extra', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            await apply(dir, P0001);
            await apply(dir, P0002);
            await apply(dir, P0003);
            const before = await state(dir, '0.23.3');
            assert.strictEqual(before.kind, 'wrong', before.kind);
            assert.deepStrictEqual(before.kind === 'wrong' ? before.extra : [], ['0001', '0002']);
            assert.deepStrictEqual(before.kind === 'wrong' ? before.missing : [], []);
            await fixAndCheck(dir, '0.23.3', before);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an edit of our own reads unknown, and Fix leaves it untouched', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            const file = path.join(dir, 'acp_adapter', 'session.py');
            fs.appendFileSync(file, '\n# a hand edit that is not one of our sets\n');
            const fingerprintBefore = fingerprint(dir);
            const found = await state(dir, '0.23.3');
            assert.strictEqual(found.kind, 'unknown', found.kind);
            const result = await fixPatchState({ checkout: dir, patchDir: PATCH_DIR, state: found, run: runGit });
            assert.strictEqual(result.changed, false);
            assert.strictEqual(fingerprint(dir), fingerprintBefore, 'byte for byte');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
