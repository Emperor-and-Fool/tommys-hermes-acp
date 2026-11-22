import * as fs from 'fs';
import * as path from 'path';
import { notesDirFor, notesMirrorPathFor } from '../store/paths';
import { writeAtomic, writeAtomicText } from '../store/connection';

/**
 * The notes feature's one door to the data home (ST1).
 *
 * An agent's notes are its own files; this store only makes their folder, reads the list, and owns
 * the one file of ours in it — the generated index. Like every other store it asks `store/paths`
 * for where, and commits through `store/connection`'s temp-file-and-rename.
 */

/** A file the agent keeps: what the index lists, and nothing of its content. */
export interface NoteFile {
    name: string;
    size: number;
    /** Last change, in ms, as the filesystem reports it. */
    changedAt: number;
}

/** The generated index. A fixed name, so every agent and every reader finds its way. */
export const INDEX_FILE = '00 Index.md';

/** One agent's link in the mirror: the name Hermes had when it was made, and the file name used. */
export interface MirrorLinkRow {
    sessionProfileId: string;
    /** The agent's name at the time the link was created: a rename is what makes it differ. */
    name: string;
    /** The link's file name in the mirror folder, after sanitising. */
    link: string;
}

/** Where the mirror is, and what stands in it. Stored in the data home, never in a setting. */
export interface MirrorSetup {
    /** The folder the user chose; the mirror itself is `PAs - AgentsProfileInfo` inside it. */
    location: string;
    agents: MirrorLinkRow[];
}

export class NotesStore {
    constructor(private readonly _historyDir: string) {}

    /** The agent's notes folder. A path, not a promise: `ensureDir` is what creates it. */
    dirFor(sessionProfileId: string): string {
        return notesDirFor(this._historyDir, sessionProfileId);
    }

    /** The generated index's path, whether or not it exists yet. */
    indexPathFor(sessionProfileId: string): string {
        return path.join(this.dirFor(sessionProfileId), INDEX_FILE);
    }

    /** Create the folder if it is not there. `created` says whether this call made it. */
    ensureDir(sessionProfileId: string): { dir: string; created: boolean } {
        const dir = this.dirFor(sessionProfileId);
        const created = !fs.existsSync(dir);
        fs.mkdirSync(dir, { recursive: true });
        return { dir, created };
    }

    /** The index as it is on disk, or '' when there is none. */
    readIndex(sessionProfileId: string): string {
        try {
            return fs.readFileSync(this.indexPathFor(sessionProfileId), 'utf-8');
        } catch {
            return '';
        }
    }

    /** Replace the index. One file, written whole: it is generated, never appended to. */
    writeIndex(sessionProfileId: string, text: string): void {
        writeAtomicText(this.indexPathFor(sessionProfileId), text);
    }

    /**
     * The agent's own `.md` files: name, size, last change. No content.
     *
     * The index itself is left out: it is ours, and listing it would make the list change every
     * time the list changed. A file that vanishes between the listing and the stat is skipped.
     */
    files(sessionProfileId: string): NoteFile[] {
        const dir = this.dirFor(sessionProfileId);
        let names: string[];
        try {
            names = fs.readdirSync(dir);
        } catch {
            return [];
        }
        const files: NoteFile[] = [];
        for (const name of names.sort()) {
            if (name === INDEX_FILE || !name.toLowerCase().endsWith('.md')) {
                continue;
            }
            try {
                const stat = fs.statSync(path.join(dir, name));
                if (!stat.isFile()) {
                    continue;
                }
                files.push({ name, size: stat.size, changedAt: stat.mtimeMs });
            } catch {
                // Gone between the listing and the stat: the read is a report, not a lock.
            }
        }
        return files;
    }

    /** The mirror the user set up, or undefined when there is none yet. */
    readMirror(): MirrorSetup | undefined {
        try {
            const parsed = JSON.parse(fs.readFileSync(notesMirrorPathFor(this._historyDir), 'utf-8')) as MirrorSetup;
            if (!parsed || typeof parsed.location !== 'string' || !parsed.location) {
                return undefined;
            }
            return { location: parsed.location, agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
        } catch {
            return undefined;
        }
    }

    /**
     * Store the mirror, or forget it when the user has none.
     *
     * Forgetting removes the record only: the links and the folder the user has are theirs, and
     * nothing here deletes a file the user can see (the menu has no "remove the mirror" action).
     */
    writeMirror(setup: MirrorSetup): void {
        writeAtomic(notesMirrorPathFor(this._historyDir), setup);
    }
}
