/**
 * The Linux dashboard unit: written only when there is none, removed only when it is ours.
 *
 * Every systemctl call here goes through the injected runner, so the test exercises the rule without
 * touching this machine's systemd: a unit with our marker is disabled and deleted, a unit without it
 * is reported and left untouched, and no unit means no work at all.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DASHBOARD_UNIT,
    UNIT_MARKER,
    dashboardUnitPath,
    dashboardUnitText,
    ensureDashboardUnit,
    isOurUnit,
    removeOurDashboardUnit,
} from '../../host/environment/dashboardUnit';

const calls: string[][] = [];
const runner = async (args: string[]) => {
    calls.push(args);
    return { ok: true, message: 'ok' };
};

const tempUnit = (text: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-unit-'));
    const file = path.join(dir, '.config', 'systemd', 'user', DASHBOARD_UNIT);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
};

describe('the dashboard unit', () => {
    it('is written in the hand-written shape, with the marker', () => {
        const text = dashboardUnitText('/opt/hermes/bin/hermes');
        assert.ok(text.startsWith(UNIT_MARKER), 'the marker opens the file');
        assert.ok(text.includes('ExecStart=/opt/hermes/bin/hermes dashboard --no-open'), text);
        assert.ok(text.includes('Environment=HERMES_DASHBOARD_PORT=9119'), text);
        assert.ok(text.includes('WantedBy=graphical-session.target'), text);
        assert.ok(text.includes('PartOf=graphical-session.target'), text);
        assert.strictEqual(isOurUnit(text), true);
        assert.strictEqual(isOurUnit('[Unit]\nDescription=half\n'), false);
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

    it('removes a unit that carries our marker, disabling it first', async () => {
        const unitPath = tempUnit(dashboardUnitText('/opt/hermes'));
        calls.length = 0;
        const removed = await removeOurDashboardUnit(unitPath, runner);
        assert.strictEqual(removed.removed, true);
        assert.strictEqual(fs.existsSync(unitPath), false, 'the file is gone');
        assert.deepStrictEqual(calls, [['disable', '--now', DASHBOARD_UNIT], ['daemon-reload']]);
        fs.rmSync(path.dirname(path.dirname(path.dirname(path.dirname(unitPath)))), { recursive: true, force: true });
    });

    it('leaves a unit the user wrote, and says so', async () => {
        const theirs = '[Unit]\nDescription=Hermes dashboard (mine)\nExecStart=/opt/hermes dashboard --no-open\n';
        const unitPath = tempUnit(theirs);
        calls.length = 0;
        const result = await removeOurDashboardUnit(unitPath, runner);
        assert.strictEqual(result.removed, false);
        assert.ok(result.message.includes('left alone'), result.message);
        assert.strictEqual(fs.readFileSync(unitPath, 'utf8'), theirs, 'byte for byte');
        assert.deepStrictEqual(calls, [], 'and systemd is not asked to stop it');
        fs.rmSync(path.dirname(path.dirname(path.dirname(path.dirname(unitPath)))), { recursive: true, force: true });
    });

    it('does nothing when there is no unit at all', async () => {
        calls.length = 0;
        assert.deepStrictEqual(await removeOurDashboardUnit('/nonexistent/' + DASHBOARD_UNIT, runner),
            { removed: false, ok: true, message: 'no dashboard unit' });
        assert.deepStrictEqual(calls, []);
    });
});
