/**
 * The one run that takes back what 2.6.1's Desktop step left on a machine.
 *
 * Called at activation, Windows only, and idempotent: on a machine that never answered the
 * start-in-tray question, or on Linux, it finds nothing and says nothing. It removes the Startup
 * shortcut and the copied scripts — the two things that acted without the user — and leaves the
 * Desktop build in the Hermes checkout (Hermes' own) and our inert records (not asked for).
 */
import { ensureDataHome } from '../store/connection';
import { startupFolder } from '../environment/startupShortcut';
import { LegacyDesktopStore } from './store';
import type { LegacyCleanup } from './store';

/**
 * Answers what it removed and what it could not (both empty on Linux and on a machine that never
 * installed the tray start), so the caller can put one line in the output log.
 */
export function migrateLegacyDesktop(platform: NodeJS.Platform = process.platform): LegacyCleanup {
    if (platform !== 'win32') {
        return { removed: [], failed: [] };
    }
    return new LegacyDesktopStore(ensureDataHome()).removeLegacyTray(startupFolder());
}
