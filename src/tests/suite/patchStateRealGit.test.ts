/**
 * The patch rules against real git, on real Hermes files.
 *
 * The other patch tests model a checkout so the decisions can be read; this one runs the actual
 * commands against a throwaway repository built from two pristine snapshots — `acp_adapter/` at
 * Hermes v0.22.6 and at v0.23.3 (see `src/tests/fixtures/`, MIT, Nous Research). It is the only test
 * that can show that our patch files apply where we say they do, that a Fix leaves exactly the set it
 * claims, and that a second Fix on the same tree writes nothing.
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

function fix(cwd: string, version: string) {
    return fixPatchState({ checkout: cwd, patchDir: PATCH_DIR, version, run: runGit });
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

async function nothingStaged(cwd: string): Promise<void> {
    const answer = await runGit(['diff', '--cached', '--quiet'], cwd);
    assert.strictEqual(answer.code, 0, `something was staged: ${answer.output}`);
}

function sha(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('real git: Hermes v0.22.6 needs 0001 + 0002', () => {
    it('missing → Fix → ok', async () => {
        const dir = await repository('hermes-0.22.6');
        try {
            const before = await state(dir, '0.22.6');
            assert.strictEqual(before.kind, 'missing', before.kind);
            assert.deepStrictEqual(before.kind === 'missing' ? before.applicable : [], ['0001', '0002']);
            const result = await fix(dir, '0.22.6');
            assert.strictEqual(result.changed, true, result.log.join('\n'));
            assert.strictEqual(result.state.kind, 'ok', result.log.join('\n'));
            await nothingStaged(dir);
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
            const result = await fix(dir, '0.22.6');
            assert.strictEqual(result.changed, false);
            assert.strictEqual(fingerprint(dir), fingerprintBefore, 'byte for byte');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an edit outside our files is reported and does not stop the Fix', async () => {
        const dir = await repository('hermes-0.22.6');
        try {
            // catalog.py is not touched by 0001/0002: somebody else's edit, not our business.
            const other = path.join(dir, 'acp_adapter', 'catalog.py');
            fs.appendFileSync(other, '\n# an unrelated local edit\n');
            const before = sha(other);

            const found = await state(dir, '0.22.6');
            assert.strictEqual(found.kind, 'missing', `${found.kind} ${found.kind === 'unknown' ? found.reason : ''}`);
            assert.ok(found.others.includes('acp_adapter/catalog.py'), `others: ${found.others.join(', ')}`);

            const result = await fix(dir, '0.22.6');
            assert.strictEqual(result.state.kind, 'ok', result.log.join('\n'));
            assert.strictEqual(sha(other), before, 'the unrelated edit is untouched');
            await nothingStaged(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an edit inside one of our files reads unknown, and Fix leaves it untouched', async () => {
        const dir = await repository('hermes-0.22.6');
        try {
            fs.appendFileSync(path.join(dir, 'acp_adapter', 'session.py'), '\n# a hand edit of our own file\n');
            const fingerprintBefore = fingerprint(dir);
            const found = await state(dir, '0.22.6');
            assert.strictEqual(found.kind, 'unknown', found.kind);
            const result = await fix(dir, '0.22.6');
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
            const result = await fix(dir, '0.23.3');
            assert.strictEqual(result.changed, true, result.log.join('\n'));
            assert.strictEqual(result.state.kind, 'ok', result.log.join('\n'));
            await nothingStaged(dir);
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
            const result = await fix(dir, '0.23.3');
            assert.strictEqual(result.changed, true, result.log.join('\n'));
            assert.strictEqual(result.state.kind, 'ok', result.log.join('\n'));
            await nothingStaged(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('two fixes on the same wrong tree end ok, and the second writes nothing', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            await apply(dir, P0001);
            await apply(dir, P0002);
            // Two windows, each holding a dialog opened on this picture.
            const first = await fix(dir, '0.23.3');
            assert.strictEqual(first.state.kind, 'ok', first.log.join('\n'));
            const fingerprintAfterFirst = fingerprint(dir);

            const second = await fix(dir, '0.23.3');
            assert.strictEqual(second.changed, false, 'the second one must not act');
            assert.ok(second.log[0].includes('already in place'), second.log[0]);
            assert.strictEqual(fingerprint(dir), fingerprintAfterFirst, 'byte for byte');
            assert.strictEqual(second.state.kind, 'ok');
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
            const result = await fix(dir, '0.23.3');
            assert.strictEqual(result.state.kind, 'ok', result.log.join('\n'));
            await nothingStaged(dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an unrelated edit does not stop the set from reading missing', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            const other = path.join(dir, 'acp_adapter', 'tools.py');
            fs.appendFileSync(other, '\n# an unrelated local edit\n');
            const before = sha(other);
            const found = await state(dir, '0.23.3');
            assert.strictEqual(found.kind, 'missing', `${found.kind} ${found.kind === 'unknown' ? found.reason : ''}`);
            assert.ok(found.others.includes('acp_adapter/tools.py'), `others: ${found.others.join(', ')}`);
            const result = await fix(dir, '0.23.3');
            assert.strictEqual(result.state.kind, 'ok', result.log.join('\n'));
            assert.strictEqual(sha(other), before, 'the unrelated edit is untouched');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('an edit inside one of our files reads unknown, and Fix leaves it untouched', async () => {
        const dir = await repository('hermes-0.23.3');
        try {
            // gateway_server.py is ours for 0.23.3 (0003 touches it); session.py is not, and an edit
            // there is the unrelated case below.
            fs.appendFileSync(path.join(dir, 'acp_adapter', 'gateway_server.py'), '\n# a hand edit of our own file\n');
            const fingerprintBefore = fingerprint(dir);
            const found = await state(dir, '0.23.3');
            assert.strictEqual(found.kind, 'unknown', found.kind);
            const result = await fix(dir, '0.23.3');
            assert.strictEqual(result.changed, false);
            assert.strictEqual(fingerprint(dir), fingerprintBefore, 'byte for byte');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
