/**
 * The Linux dashboard unit: written only when the user has none.
 *
 * Every systemctl call here goes through the injected runner, so the test exercises the rule without
 * touching this machine's systemd. Removing it again is the installer's job, on the marker rule, and
 * is tested in extras/KDEdesktopGui/test_installer.py.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import assert from 'assert';
import {
    DASHBOARD_UNIT,
    UNIT_MARKER,
    dashboardUnitPath,
    dashboardUnitText,
    ensureDashboardUnit,
} from '../../host/environment/dashboardUnit';

const calls: string[][] = [];
const runner = async (args: string[]) => {
    calls.push(args);
    return { ok: true, message: 'ok' };
};

describe('the dashboard unit', () => {
    it('is written in the hand-written shape, with the marker', () => {
        const text = dashboardUnitText('/opt/hermes/bin/hermes');
        assert.ok(text.startsWith(UNIT_MARKER), 'the marker opens the file');
        assert.ok(text.includes('ExecStart=/opt/hermes/bin/hermes dashboard --no-open'), text);
        assert.ok(text.includes('Environment=HERMES_DASHBOARD_PORT=9119'), text);
        assert.ok(text.includes('WantedBy=graphical-session.target'), text);
        assert.ok(text.includes('PartOf=graphical-session.target'), text);
    });

    it('lives in the user unit folder on Linux, and nowhere else', () => {
        assert.strictEqual(dashboardUnitPath('linux', { HOME: '/home/skdj' }),
            path.join('/home/skdj', '.config', 'systemd', 'user', DASHBOARD_UNIT));
        assert.strictEqual(dashboardUnitPath('win32', { HOME: 'C:\\Users\\SKDJ' }), '');
        assert.strictEqual(dashboardUnitPath('darwin', { HOME: '/Users/skdj' }), '');
    });

    it('writes and starts a unit only when the user has none', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-unit-new-'));
        const unitPath = path.join(dir, 'user', DASHBOARD_UNIT);
        calls.length = 0;
        const written = await ensureDashboardUnit('/opt/hermes', unitPath, runner);
        assert.deepStrictEqual(written, { created: true, ok: true, message: 'written and started' });
        assert.ok(fs.readFileSync(unitPath, 'utf8').startsWith(UNIT_MARKER));
        assert.deepStrictEqual(calls, [['daemon-reload'], ['enable', '--now', DASHBOARD_UNIT]]);

        calls.length = 0;
        const again = await ensureDashboardUnit('/opt/hermes', unitPath, runner);
        assert.deepStrictEqual(again, { created: false, ok: true, message: 'a dashboard unit already exists; left alone' });
        assert.deepStrictEqual(calls, [], 'an existing unit is not touched');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
