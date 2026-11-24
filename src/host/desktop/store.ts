import * as fs from 'fs';
import * as path from 'path';
import { desktopDirFor } from '../store/paths';

/**
 * The Desktop feature's one door to the data home (ST1) — and now only to its legacy.
 *
 * 2.6.1 built Hermes' Electron Desktop and answered a start-in-tray question. It copied the launcher
 * scripts it ran at login into `<data home>/desktop/tray/`. Desktop is not this extension's any more,
 * so those scripts and the Startup shortcut that pointed at them go; the build record
 * (`desktop/build.json`) and the answer to the question (`desktop/tray.json`) are inert files of
 * ours and stay — nothing reads them, and deleting what nobody asked for is not a migration.
 */

/** The Startup shortcut 2.6.1 wrote, by name. Nothing else in that folder is ours. */
export const LEGACY_TRAY_LINK = 'Hermes Desktop (tray).lnk';

/** What a removal actually did, for the one log line it earns. */
export interface LegacyCleanup {
    removed: string[];
    failed: string[];
}

export class LegacyDesktopStore {
    private readonly _dir: string;

    constructor(historyDir: string) {
        this._dir = desktopDirFor(historyDir);
    }

    /** Where 2.6.1 copied the launcher scripts: `<data home>/desktop/tray/`. */
    scriptsDir(): string {
        return path.join(this._dir, 'tray');
    }

    /**
     * Remove exactly the two things 2.6.1 put outside its own records: the Startup shortcut and the
     * copied scripts. Everything else in that folder belongs to the user and is never touched.
     */
    removeLegacyTray(startup: string): LegacyCleanup {
        const removed: string[] = [];
        const failed: string[] = [];
        const link = path.join(startup, LEGACY_TRAY_LINK);
        try {
            if (fs.existsSync(link)) {
                fs.unlinkSync(link);
                removed.push(link);
            }
        } catch (error) {
            failed.push(`${link}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const scripts = this.scriptsDir();
        try {
            if (fs.existsSync(scripts)) {
                fs.rmSync(scripts, { recursive: true, force: true });
                removed.push(scripts);
            }
        } catch (error) {
            failed.push(`${scripts}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { removed, failed };
    }
}
