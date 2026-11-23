/**
 * What Hermes Desktop looks like on disk, and what the build command is spelled.
 *
 * Both halves face the outside world: the paths are Hermes' own layout (a checkout with `.git`,
 * an unpacked app under `apps/desktop/release`), and the argv is the contract with the CLI. Temp
 * folders stand in for the checkout, so nothing here reads the machine's real Hermes.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    desktopBuildArgs,
    desktopExecutableCandidates,
    desktopPresence,
    findDesktopBuild,
    findHermesSourceCheckout,
} from '../../host/environment/desktopBuild';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-presence-'));

/** A Hermes home whose `hermes-agent` is a source checkout, with or without a build. */
const home = (build?: { platform: 'linux' | 'win32'; name: string; dir: string }): string => {
    const root = dir();
    const checkout = path.join(root, 'hermes-agent');
    fs.mkdirSync(path.join(checkout, 'apps', 'desktop'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'apps', 'desktop', 'package.json'), '{}');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
    if (build) {
        const app = path.join(checkout, 'apps', 'desktop', 'release', build.dir, build.name);
        fs.mkdirSync(path.dirname(app), { recursive: true });
        fs.writeFileSync(app, '');
    }
    return root;
};

describe('the Desktop build command', () => {
    it('is Hermes\' own --build-only, which builds and does not launch', () => {
        assert.deepStrictEqual(desktopBuildArgs(), ['desktop', '--build-only']);
    });
});

describe('finding the Desktop on a machine', () => {
    it('reads the Linux checkout: linux-unpacked/hermes', () => {
        const root = home({ platform: 'linux', name: 'hermes', dir: 'linux-unpacked' });
        const presence = desktopPresence('linux', root);
        assert.strictEqual(presence.source, true, 'a checkout with .git is a source install');
        assert.strictEqual(presence.checkout, path.join(root, 'hermes-agent'));
        assert.strictEqual(presence.build, path.join(root, 'hermes-agent', 'apps', 'desktop', 'release', 'linux-unpacked', 'hermes'));
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reads the Windows checkout: win-unpacked\\Hermes.exe', () => {
        const root = home({ platform: 'win32', name: 'Hermes.exe', dir: 'win-unpacked' });
        const presence = desktopPresence('win32', root);
        assert.strictEqual(presence.source, true);
        assert.strictEqual(
            presence.build,
            path.join(root, 'hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe'),
        );
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('answers no build for a checkout that has none, and remembers it is a source install', () => {
        const root = home();
        const presence = desktopPresence('linux', root);
        assert.strictEqual(presence.source, true);
        assert.strictEqual(presence.build, null);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('answers not-a-source-install for a packaged Hermes, so nothing is ever built there', () => {
        const root = dir();
        // A packaged install: no hermes-agent checkout, no .git, nothing to build in.
        fs.mkdirSync(path.join(root, 'hermes-agent', 'apps', 'desktop'), { recursive: true });
        const presence = desktopPresence('linux', root);
        assert.strictEqual(presence.source, false);
        assert.strictEqual(presence.checkout, null);
        assert.strictEqual(presence.build, null);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('takes the newest of several unpacked trees, as Hermes does', async () => {
        const root = home({ platform: 'linux', name: 'hermes', dir: 'linux-unpacked' });
        const older = path.join(root, 'hermes-agent', 'apps', 'desktop', 'release', 'linux-arm64-unpacked', 'hermes');
        fs.mkdirSync(path.dirname(older), { recursive: true });
        fs.writeFileSync(older, '');
        const past = new Date(Date.now() - 60_000);
        fs.utimesSync(older, past, past);
        const found = findDesktopBuild(path.join(root, 'hermes-agent'), 'linux');
        assert.strictEqual(found, path.join(root, 'hermes-agent', 'apps', 'desktop', 'release', 'linux-unpacked', 'hermes'));
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('names the platform dirs Hermes names', () => {
        const win = desktopExecutableCandidates('/r', 'win32');
        assert.deepStrictEqual(win.map(p => path.basename(p)), ['Hermes.exe', 'Hermes.exe', 'Hermes.exe']);
        assert.deepStrictEqual(win.map(p => path.basename(path.dirname(p))),
            ['win-unpacked', 'win-ia32-unpacked', 'win-arm64-unpacked']);
        const linux = desktopExecutableCandidates('/r', 'linux');
        assert.deepStrictEqual(linux.map(p => path.basename(p)), ['hermes', 'Hermes', 'hermes', 'Hermes']);
        assert.ok(linux.every(p => p.startsWith('/r/linux')));
    });

    it('finds no checkout when the home holds none', () => {
        const root = dir();
        assert.strictEqual(findHermesSourceCheckout(root), null);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
