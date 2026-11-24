/**
 * What 2.6.1's Desktop step left, and what the one migration takes back.
 *
 * The two paths it removes are the ones that acted without being asked again: the Startup shortcut
 * and the copied launcher scripts. Everything else — our inert records, and any other program the
 * user starts at login — must survive, which is what this pins.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LegacyDesktopStore, LEGACY_TRAY_LINK } from '../../host/desktop/store';
import { migrateLegacyDesktop } from '../../host/desktop/legacy';

/** A data home and a Startup folder, with what 2.6.1 wrote in both. */
const home = () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-data-'));
    const startup = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-startup-'));
    fs.mkdirSync(path.join(data, 'desktop', 'tray'), { recursive: true });
    fs.writeFileSync(path.join(data, 'desktop', 'tray', 'Start-HermesInTray.ps1'), '');
    fs.writeFileSync(path.join(data, 'desktop', 'build.json'), '{}');
    fs.writeFileSync(path.join(data, 'desktop', 'tray.json'), '{}');
    fs.writeFileSync(path.join(startup, LEGACY_TRAY_LINK), '');
    fs.writeFileSync(path.join(startup, 'Someone else.lnk'), '');
    return { data, startup };
};

describe('the Desktop leftover from 2.6.1', () => {
    it('removes the Startup shortcut and the copied scripts, and nothing else', () => {
        const { data, startup } = home();
        const cleanup = new LegacyDesktopStore(data).removeLegacyTray(startup);
        assert.strictEqual(cleanup.failed.length, 0, cleanup.failed.join(' | '));
        assert.deepStrictEqual(cleanup.removed.sort(), [
            path.join(data, 'desktop', 'tray'),
            path.join(startup, LEGACY_TRAY_LINK),
        ].sort());
        assert.ok(!fs.existsSync(path.join(startup, LEGACY_TRAY_LINK)), 'the shortcut is gone');
        assert.ok(!fs.existsSync(path.join(data, 'desktop', 'tray')), 'the scripts are gone');
        assert.ok(fs.existsSync(path.join(startup, 'Someone else.lnk')), 'another login item survives');
        assert.ok(fs.existsSync(path.join(data, 'desktop', 'tray.json')), 'its record survives');
        assert.ok(fs.existsSync(path.join(data, 'desktop', 'build.json')), 'and so does the build record');
        fs.rmSync(data, { recursive: true, force: true });
        fs.rmSync(startup, { recursive: true, force: true });
    });

    it('is a no-op the second time, and on a machine that never had it', () => {
        const { data, startup } = home();
        new LegacyDesktopStore(data).removeLegacyTray(startup);
        const again = new LegacyDesktopStore(data).removeLegacyTray(startup);
        assert.deepStrictEqual(again, { removed: [], failed: [] }, 'nothing left to do');
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-empty-'));
        assert.deepStrictEqual(new LegacyDesktopStore(empty).removeLegacyTray(startup),
            { removed: [], failed: [] });
        fs.rmSync(data, { recursive: true, force: true });
        fs.rmSync(startup, { recursive: true, force: true });
        fs.rmSync(empty, { recursive: true, force: true });
    });

    it('does not run at all off Windows', () => {
        for (const platform of ['linux', 'darwin'] as NodeJS.Platform[]) {
            assert.deepStrictEqual(migrateLegacyDesktop(platform), { removed: [], failed: [] }, platform);
        }
    });
});
