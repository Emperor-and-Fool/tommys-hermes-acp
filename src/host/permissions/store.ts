import * as fs from 'fs';
import * as path from 'path';
import { profileDir } from '../workspace/profileStorage';

/** A saved deny list, exactly as the backup file holds it. */
export interface DenyBackup {
    profile: string;
    savedAt: string;
    patterns: string[];
}

/**
 * The permissions feature's one door to its data: whether DANGER is engaged, and the deny lists it
 * saved before clearing them.
 *
 * Both live beside the profile's other data (`profiles/<scope>/`), not in a temp directory — a
 * backup that is pruned overnight is not a backup — and both are written here and nowhere else
 * (ST1). The scope is a function, not a value: a profile switch changes which directory is meant.
 */
export class PermissionsStore {
    constructor(
        private readonly _historyDir: string,
        private readonly _scopeKey: () => string,
    ) {}

    private get _dir(): string {
        return profileDir(this._historyDir, this._scopeKey());
    }

    /** Where the red action's record lives. */
    get statePath(): string {
        return path.join(this._dir, 'permissions-state.json');
    }

    /**
     * Whether the red action is engaged. Recorded, never inferred: `mode off` with an empty deny
     * list is None, and only the red press makes it ALL.
     */
    openAccess(): boolean {
        try {
            const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            return raw.openAccess === true;
        } catch {
            return false;
        }
    }

    /** Record it. False when the write failed, so a caller can say so instead of pretending. */
    setOpenAccess(next: boolean): boolean {
        try {
            fs.mkdirSync(this._dir, { recursive: true });
            fs.writeFileSync(
                this.statePath,
                JSON.stringify({ openAccess: next, updatedAt: new Date().toISOString() }, null, 2) + '\n',
                'utf8',
            );
            return true;
        } catch {
            return false;
        }
    }

    /** Save a deny list before it is cleared; the file it wrote, or undefined when it could not. */
    saveDenyBackup(profile: string, patterns: string[]): string | undefined {
        try {
            fs.mkdirSync(this._dir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const file = path.join(this._dir, `deny-backup-${stamp}.json`);
            const backup: DenyBackup = { profile, savedAt: new Date().toISOString(), patterns };
            fs.writeFileSync(file, JSON.stringify(backup, null, 2) + '\n', 'utf8');
            return file;
        } catch {
            return undefined;
        }
    }

    /** The newest saved deny list, for a session that no longer remembers which one it made. */
    newestDenyBackup(): string | undefined {
        try {
            const files = fs.readdirSync(this._dir)
                .filter(name => name.startsWith('deny-backup-') && name.endsWith('.json'))
                .sort();
            const last = files[files.length - 1];
            return last ? path.join(this._dir, last) : undefined;
        } catch {
            return undefined;
        }
    }

    /** What a backup file holds; an unreadable one restores nothing rather than guessing. */
    readDenyBackup(file: string): string[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            return Array.isArray(parsed.patterns)
                ? parsed.patterns.filter((pattern: unknown) => typeof pattern === 'string')
                : [];
        } catch {
            return [];
        }
    }
}
