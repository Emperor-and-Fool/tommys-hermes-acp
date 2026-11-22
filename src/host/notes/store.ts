import * as fs from 'fs';
import * as path from 'path';
import { notesDirFor } from '../store/paths';
import { writeAtomicText } from '../store/connection';

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
}
