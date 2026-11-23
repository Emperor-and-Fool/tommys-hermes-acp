/**
 * The Desktop setup step: built once per machine when it is missing, and refusals after that.
 *
 * The subject is the decision, not the build — Hermes' own command builds. So the runner is a fake
 * that counts its calls, and the machine (a temp data home) is real: the lock and the 24-hour record
 * are the things that must hold when two windows start at once or a build fails.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesktopSetup, RETRY_AFTER_MS } from '../../host/desktop/desktop';
import type { DesktopHost } from '../../host/desktop/desktop';
import { DesktopStore, LOCK_STALE_MS } from '../../host/desktop/store';
import type { DesktopBuildResult, DesktopPresence } from '../../host/environment/desktopBuild';
import { t } from '../../host/i18n';

const present: DesktopPresence = {
    checkout: '/h/hermes-agent',
    source: true,
    build: '/h/hermes-agent/apps/desktop/release/linux-unpacked/hermes',
    stamp: false,
};

const missing: DesktopPresence = {
    checkout: '/h/hermes-agent',
    source: true,
    build: null,
    stamp: false,
};

const packaged: DesktopPresence = { checkout: null, source: false, build: null, stamp: false };

const ok: DesktopBuildResult = {
    ok: true,
    code: 0,
    build: '/h/hermes-agent/apps/desktop/release/linux-unpacked/hermes',
    tail: ['✓ Desktop packaged app ready (not launching; --build-only)'],
    message: '/h/hermes-agent/apps/desktop/release/linux-unpacked/hermes',
};

const failed: DesktopBuildResult = {
    ok: false,
    code: 1,
    build: null,
    tail: ['→ Preparing Node dependencies', '✗ Desktop GUI build failed: npm ERR! code ELIFECYCLE'],
    message: 'exit 1',
};

/** The step over a fake machine: what it asked, what it built, and what it said. */
const setup = (options: {
    store: DesktopStore;
    presence: DesktopPresence;
    result?: DesktopBuildResult;
    isPrimary?: boolean;
    answer?: string;
    now?: number;
}) => {
    const builds: string[] = [];
    const runs: string[] = [];
    const infos: string[] = [];
    const warns: string[] = [];
    const asked: Array<{ message: string; actions: string[] }> = [];
    const logs: string[] = [];
    let answer = options.answer;
    const host: DesktopHost = {
        isPrimary: () => options.isPrimary !== false,
        presence: async () => options.presence,
        build: async (report) => {
            builds.push('build');
            report('Preparing Node dependencies');
            return options.result ?? ok;
        },
        progress: {
            run: async (title, job) => {
                runs.push(title);
                await job(() => {});
            },
        },
        notices: {
            info: (message) => { infos.push(message); },
            warn: (message) => { warns.push(message); },
        },
        choices: {
            pick: async () => undefined,
            prompt: async () => undefined,
            pickFolder: async () => undefined,
            home: () => '/home',
            showInFileManager: async () => {},
            ask: async (message, actions) => {
                asked.push({ message, actions });
                const given = answer;
                answer = undefined;
                return given;
            },
        },
        log: (line) => { logs.push(line); },
        now: () => options.now ?? Date.now(),
    };
    return {
        desktop: new DesktopSetup(options.store, host),
        builds, runs, infos, warns, asked, logs,
        answerWith: (value: string) => { answer = value; },
    };
};

const storeIn = (): { store: DesktopStore; dir: string } => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-setup-'));
    return { store: new DesktopStore(dir), dir };
};

describe('the Desktop setup: build once, and only when there is nothing to keep', () => {
    it('does nothing when a build is already there', async () => {
        const { store, dir } = storeIn();
        const step = setup({ store, presence: present });
        await step.desktop.start();
        assert.deepStrictEqual(step.runs, [], 'no notification');
        assert.deepStrictEqual(step.builds, [], 'no build');
        assert.deepStrictEqual(step.infos, [], 'nothing to tell the user');
        assert.ok(step.logs.some(line => line.includes('already there')), step.logs.join(' | '));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does nothing on a packaged install: its Desktop is its own', async () => {
        const { store, dir } = storeIn();
        const step = setup({ store, presence: packaged });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, []);
        assert.deepStrictEqual(step.runs, []);
        assert.ok(step.logs.some(line => line.includes('not a source checkout')), step.logs.join(' | '));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does nothing in the secondant: the machine is the primary\'s to prepare', async () => {
        const { store, dir } = storeIn();
        const step = setup({ store, presence: missing, isPrimary: false });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, []);
        assert.ok(step.logs.some(line => line.includes('secondant')), step.logs.join(' | '));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('builds once when it is missing, under one notification, and records what it produced', async () => {
        const { store, dir } = storeIn();
        const step = setup({ store, presence: missing });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, ['build'], 'one build');
        assert.deepStrictEqual(step.runs, [t('desktopPreparing')], 'one notification, titled');
        assert.strictEqual(step.infos.length, 1, 'one success notice');
        assert.ok(step.infos[0].includes(ok.build!), step.infos[0]);
        assert.ok(
            step.logs.includes('Preparing Node dependencies'),
            `the build's own lines reach the log: ${step.logs.join(' | ')}`,
        );
        const record = store.read();
        assert.ok(record?.ok, 'a success is recorded');
        assert.strictEqual(record?.build, ok.build);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('leaves the lock free afterwards, so a later start can build again', async () => {
        const { store, dir } = storeIn();
        await setup({ store, presence: missing }).desktop.start();
        assert.strictEqual(store.lock(Date.now()), true, 'the lock was released');
        store.unlock();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('the Desktop setup: two windows, one build', () => {
    it('skips while another window holds the lock', async () => {
        const { store, dir } = storeIn();
        assert.strictEqual(store.lock(Date.now()), true, 'the other window got there first');
        const step = setup({ store, presence: missing });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, [], 'the second window builds nothing');
        assert.deepStrictEqual(step.runs, [], 'and shows no notification it cannot honour');
        assert.ok(step.logs.some(line => line.includes('another window')), step.logs.join(' | '));
        store.unlock();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('takes over a lock a window died holding', async () => {
        const { store, dir } = storeIn();
        assert.strictEqual(store.lock(Date.now() - LOCK_STALE_MS - 1000), true);
        const step = setup({ store, presence: missing });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, ['build'], 'a stale lock is not a wall');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('the Desktop setup: a failure is remembered, not retried in a loop', () => {
    it('records the failure with its time and what Hermes said', async () => {
        const { store, dir } = storeIn();
        const now = 1_700_000_000_000;
        const step = setup({ store, presence: missing, result: failed, now });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, ['build']);
        const record = store.read();
        assert.strictEqual(record?.ok, false);
        assert.strictEqual(record?.at, now, 'the time it ended');
        assert.ok(record?.failure?.includes('Desktop GUI build failed'), String(record?.failure));
        assert.ok(record?.failure?.includes('exit 1'), 'and how it ended');
        assert.deepStrictEqual(step.asked.length, 1, 'one failure notice');
        assert.deepStrictEqual(step.asked[0].actions, [t('desktopTryAgain'), t('desktopDetails')]);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does not rebuild on a start inside the 24 hours, and offers the retry instead', async () => {
        const { store, dir } = storeIn();
        const now = 1_700_000_000_000;
        store.write({ at: now - 60_000, ok: false, failure: 'npm ERR! code ELIFECYCLE' });
        const step = setup({ store, presence: missing, now });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, [], 'no automatic retry inside 24 h');
        assert.deepStrictEqual(step.runs, [], 'and nothing pretends to work');
        assert.deepStrictEqual(step.asked.length, 1, 'the failure notice is shown');
        assert.ok(step.logs.some(line => line.includes('24 h')), step.logs.join(' | '));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('builds again on a start after the 24 hours', async () => {
        const { store, dir } = storeIn();
        const now = 1_700_000_000_000;
        store.write({ at: now - RETRY_AFTER_MS - 1000, ok: false, failure: 'boom' });
        const step = setup({ store, presence: missing, now });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, ['build'], 'the recorded failure has expired');
        assert.strictEqual(store.read()?.ok, true, 'and the new attempt replaces it');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('builds now when the user clicks Try again, past the 24 hours or not', async () => {
        const { store, dir } = storeIn();
        const now = 1_700_000_000_000;
        store.write({ at: now - 60_000, ok: false, failure: 'boom' });
        const step = setup({ store, presence: missing, now, answer: t('desktopTryAgain') });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, ['build'], 'the click is the way around the wait');
        assert.strictEqual(store.read()?.ok, true);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('shows the last lines in Details', async () => {
        const { store, dir } = storeIn();
        const now = 1_700_000_000_000;
        store.write({ at: now - 60_000, ok: false, failure: '✗ Desktop GUI build failed: npm ERR!' });
        const step = setup({ store, presence: missing, now, answer: t('desktopDetails') });
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, [], 'Details is not a retry');
        assert.strictEqual(step.infos.length, 1);
        assert.ok(step.infos[0].includes('Desktop GUI build failed'), step.infos[0]);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('retries a failed build once from the notice right after the attempt', async () => {
        const { store, dir } = storeIn();
        const step = setup({ store, presence: missing, result: failed });
        step.answerWith(t('desktopTryAgain'));
        await step.desktop.start();
        assert.deepStrictEqual(step.builds, ['build', 'build'], 'the click runs it again, once');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('the Desktop store', () => {
    it('reads back nothing when there is no record, or when it is damaged', () => {
        const { store, dir } = storeIn();
        assert.strictEqual(store.read(), undefined);
        fs.mkdirSync(path.join(dir, 'desktop'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'desktop', 'build.json'), '{ not json');
        assert.strictEqual(store.read(), undefined);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps the record at the data home, not in a profile folder', () => {
        const { store, dir } = storeIn();
        store.write({ at: 1, ok: true, build: '/x' });
        assert.ok(fs.existsSync(path.join(dir, 'desktop', 'build.json')));
        assert.strictEqual(store.read()?.build, '/x');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
