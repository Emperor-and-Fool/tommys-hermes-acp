import * as fs from 'fs';
import * as path from 'path';

/**
 * The vaults Obsidian itself knows about.
 *
 * Only read, and only to offer the user the folders it already has: the alternative is a folder
 * dialog in a tree of notes, which is the same question with more clicks. Obsidian's list is one
 * JSON file per install shape (`{ vaults: { <hash>: { path, ts, open? } } }`), and the file lives
 * in a different place on every platform — and, on Linux, in a different place per install method.
 */

/** One vault, named the way Obsidian names it: the folder's last segment. */
export interface ObsidianVault {
    name: string;
    path: string;
}

/**
 * Where a machine keeps `obsidian.json`, most likely first.
 *
 * `env` is a parameter so a test can answer `%APPDATA%` without a Windows machine; on Linux the
 * flatpak install keeps its own config, and Obsidian's native install the XDG one.
 */
export function obsidianConfigPaths(
    platform: NodeJS.Platform,
    home: string,
    env: Record<string, string | undefined> = process.env,
): string[] {
    if (platform === 'win32') {
        const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return [path.join(appData, 'obsidian', 'obsidian.json')];
    }
    if (platform === 'darwin') {
        return [path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')];
    }
    return [
        path.join(home, '.config', 'obsidian', 'obsidian.json'),
        path.join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
    ];
}

/** The vault list, in the file's own shape. A file that is not that shape answers nothing. */
export function parseObsidianVaults(text: string): ObsidianVault[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    const vaults = (parsed as { vaults?: unknown })?.vaults;
    if (!vaults || typeof vaults !== 'object') {
        return [];
    }
    const list: ObsidianVault[] = [];
    for (const entry of Object.values(vaults as Record<string, unknown>)) {
        const vaultPath = (entry as { path?: unknown })?.path;
        if (typeof vaultPath !== 'string' || !vaultPath) {
            continue;
        }
        list.push({ name: path.basename(vaultPath), path: vaultPath });
    }
    return list.sort((left, right) => left.name.localeCompare(right.name));
}

/** The vaults on this machine: the first config file that holds a list wins. */
export function readObsidianVaults(
    platform: NodeJS.Platform,
    home: string,
    env: Record<string, string | undefined> = process.env,
): ObsidianVault[] {
    for (const file of obsidianConfigPaths(platform, home, env)) {
        try {
            return parseObsidianVaults(fs.readFileSync(file, 'utf-8'));
        } catch {
            // Not this install shape: the next candidate is the same question, not a failure.
        }
    }
    return [];
}
