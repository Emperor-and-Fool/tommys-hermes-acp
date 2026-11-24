/**
 * The tray app's release asset: one build, named in one place, and the only test a download passes.
 *
 * The tests use a small buffer and a small expectation — the point is the rule, not the 199 MB file:
 * a wrong size or a wrong hash must refuse, and a refused download must never be written.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as crypto from 'crypto';
import * as path from 'path';
import { TRAY_APP, trayAppDir, trayAppExe, verifyTrayAppZip } from '../../host/environment/trayApp';
import { startupFolder, shortcutPath } from '../../host/environment/startupShortcut';

const payload = Buffer.from('hermes-desktopgui');
const sha256 = crypto.createHash('sha256').update(payload).digest('hex');

describe('the tray app asset, as it is downloaded', () => {
    it('is one build, named in one place', () => {
        // The values themselves are asserted nowhere else: a second copy of the hash is how two
        // "sources of truth" drift apart. This pins the shape the installer needs.
        assert.ok(TRAY_APP.url.endsWith(`/v2.6.1/${TRAY_APP.folder}-windows-x86_64.zip`), TRAY_APP.url);
        assert.ok(Number.isInteger(TRAY_APP.bytes) && TRAY_APP.bytes > 0, String(TRAY_APP.bytes));
        assert.match(TRAY_APP.sha256, /^[0-9a-f]{64}$/);
        assert.strictEqual(TRAY_APP.exe, 'hermesdesktopgui.exe');
        assert.strictEqual(TRAY_APP.folder, 'hermesdesktopgui');
    });

    it('accepts exactly the file it names', () => {
        assert.deepStrictEqual(verifyTrayAppZip(payload, { bytes: payload.length, sha256 }), { ok: true });
    });

    it('refuses a size that is not the one it names', () => {
        const check = verifyTrayAppZip(payload, { bytes: payload.length + 1, sha256 });
        assert.strictEqual(check.ok, false);
        assert.ok(check.reason?.includes('expected'), String(check.reason));
    });

    it('refuses a hash that is not the one it names, even at the right size', () => {
        const check = verifyTrayAppZip(payload, { bytes: payload.length, sha256: 'a'.repeat(64) });
        assert.strictEqual(check.ok, false);
        assert.ok(check.reason?.includes('sha256'), String(check.reason));
    });

    it('refuses a different file of the same size', () => {
        const other = Buffer.from('hermes-desktopguX');
        assert.strictEqual(other.length, payload.length, 'same size on purpose');
        assert.strictEqual(verifyTrayAppZip(other, { bytes: payload.length, sha256 }).ok, false);
    });
});

describe('where the tray app and its login entries go', () => {
    it('installs beside the user, outside our data home', () => {
        const dir = trayAppDir('win32', { LOCALAPPDATA: 'C:\\Users\\SKDJ\\AppData\\Local' });
        assert.strictEqual(dir, path.join('C:\\Users\\SKDJ\\AppData\\Local', 'hermesdesktopgui'));
        assert.ok(!dir.includes('emperorandfool'), 'the data home gets renamed to .backup-<date>');
        assert.strictEqual(trayAppExe(dir), path.join(dir, 'hermesdesktopgui.exe'));
        assert.strictEqual(trayAppDir('linux', {}), '', 'nothing to install there');
    });

    it('names the Startup folder only on Windows', () => {
        const startup = startupFolder('win32', { APPDATA: 'C:\\Users\\SKDJ\\AppData\\Roaming' });
        assert.strictEqual(
            startup,
            path.join('C:\\Users\\SKDJ\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
        );
        assert.strictEqual(shortcutPath('Hermes Dashboard.lnk', startup),
            path.join(startup, 'Hermes Dashboard.lnk'));
        assert.strictEqual(startupFolder('linux', { APPDATA: '/home/skdj/.config' }), '');
        assert.strictEqual(shortcutPath('x.lnk', ''), '');
    });
});
