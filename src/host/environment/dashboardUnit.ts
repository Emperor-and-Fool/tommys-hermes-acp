import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * The Linux dashboard unit: written by us when there is none, and removed only when it is ours.
 *
 * Nothing in Hermes creates `hermes-dashboard.service` (0.22.6 writes gateway units only, and the
 * docs leave the dashboard's autostart to the user). So the menu's install does what the user would:
 * a unit in their own `~/.config/systemd/user/`, started hidden, on 9119 — and a marker comment so a
 * later removal can tell it apart from one the user wrote. Their unit is never rewritten, and a unit
 * without the marker is never removed.
 */

export const DASHBOARD_UNIT = 'hermes-dashboard.service';

/** The line that makes a unit ours. Any file without it is left exactly as it is. */
export const UNIT_MARKER = '# Written by the Tommys Hermes ACP extension — remove this unit with the tray app.';

/** `~/.config/systemd/user/hermes-dashboard.service` on Linux; '' elsewhere. */
export function dashboardUnitPath(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): string {
    if (platform !== 'linux') {
        return '';
    }
    const home = (env.HOME || '').trim();
    return home ? path.join(home, '.config', 'systemd', 'user', DASHBOARD_UNIT) : '';
}

/** The unit's text, in the shape of a hand-written one: the app's own command, the port, the session. */
export function dashboardUnitText(hermesExe: string): string {
    return [
        UNIT_MARKER,
        '[Unit]',
        'Description=Hermes dashboard (127.0.0.1:9119)',
        'After=graphical-session.target',
        'PartOf=graphical-session.target',
        '',
        '[Service]',
        'Type=simple',
        'Environment=HERMES_DASHBOARD_PORT=9119',
        `ExecStart=${hermesExe} dashboard --no-open`,
        'Restart=on-failure',
        '',
        '[Install]',
        'WantedBy=graphical-session.target',
        '',
    ].join('\n');
}

/** What one systemd call answered. */
interface Call {
    ok: boolean;
    message: string;
}

function systemctl(args: string[]): Promise<Call> {
    return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn('systemctl', ['--user', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch (error) {
            resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
            return;
        }
        let out = '';
        const timer = setTimeout(() => {
            try { proc.kill(); } catch { /* already gone */ }
            resolve({ ok: false, message: `systemctl ${args.join(' ')} did not answer within 20 s` });
        }, 20_000);
        proc.stdout?.on('data', chunk => { out += String(chunk); });
        proc.stderr?.on('data', chunk => { out += String(chunk); });
        proc.on('error', error => {
            clearTimeout(timer);
            resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
        });
        proc.on('close', code => {
            clearTimeout(timer);
            const tail = out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
            resolve({ ok: code === 0, message: tail || `exit ${code}` });
        });
    });
}

/**
 * Write our unit when the user has none, then let systemd start it now.
 *
 * An existing unit — ours or theirs — is left alone here: theirs is the installer's business (it
 * offers `--no-open` with a backup), and ours is already enabled from the run that wrote it.
 */
export async function ensureDashboardUnit(
    hermesExe: string,
    unitPath: string,
    run: (args: string[]) => Promise<Call> = systemctl,
): Promise<Call & { created: boolean }> {
    if (!unitPath) {
        return { created: false, ok: true, message: 'no systemd user units on this platform' };
    }
    if (fs.existsSync(unitPath)) {
        return { created: false, ok: true, message: 'a dashboard unit already exists; left alone' };
    }
    try {
        fs.mkdirSync(path.dirname(unitPath), { recursive: true });
        fs.writeFileSync(unitPath, dashboardUnitText(hermesExe), 'utf8');
    } catch (error) {
        return { created: false, ok: false, message: `could not write ${unitPath}: ${String(error)}` };
    }
    const reload = await run(['daemon-reload']);
    if (!reload.ok) {
        return { created: true, ok: false, message: `daemon-reload: ${reload.message}` };
    }
    const enabled = await run(['enable', '--now', DASHBOARD_UNIT]);
    return { created: true, ok: enabled.ok, message: enabled.ok ? 'written and started' : `enable: ${enabled.message}` };
}
