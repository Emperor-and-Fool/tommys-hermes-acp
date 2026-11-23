import { INDEX_FILE } from './store';
import type { NoteFile, NotesStore } from './store';

/**
 * An agent's own notes: a folder in the data home, and the index that names it.
 *
 * Hermes' memory is capped (2200 characters in `MEMORY.md`, 1375 in `USER.md`), and much of what an
 * agent wants to remember is only relevant to that one agent. So each agent gets a folder beside its
 * tabs — `profiles/<sessionProfileId>/notes/` — and learns where it is in the notice it already
 * reads once per session and workspace. This feature is the basis: no menu, no mirror, no UI.
 *
 * What it never does: write into Hermes' home (H2). The name and the description are read from the
 * profile table and from Hermes' own `profile.yaml`, through `environment/` (H1).
 */

/** What the notes feature needs from the rest of the extension. */
export interface AgentNotesHost {
    log(line: string): void;
    /**
     * Hermes' name and description for an agent id.
     *
     * Read, never written (H2). The description is empty when Hermes has none, and an agent with no
     * description still gets its folder and its index.
     */
    profileInfo(sessionProfileId: string): { name: string; description: string };
    /**
     * Does this agent's MEMORY.md carry the protected section naming that notes folder?
     *
     * Hermes' file, read only (H1, H2), and answered once per connect: true means the one-time
     * setup block in the notice has been done and is never sent again.
     */
    protectedSection(sessionProfileId: string, notesDir: string): boolean;
}

/** Where the notice points: the folder the agent writes in, and the index that describes it. */
export interface NotesPaths {
    dir: string;
    index: string;
}

export class AgentNotes {
    /** Per agent: the answer `protectedSection` gave on this connect. Absent means "not yet". */
    private readonly _protected = new Map<string, boolean>();

    constructor(
        private readonly _store: NotesStore,
        private readonly _host: AgentNotesHost,
    ) {}

    /**
     * Make sure this agent has its notes folder and an index that matches what is in it.
     *
     * Called when a connect lands: that is the moment the agent's id is known and will not move.
     * The index is rewritten only when its text changes, so a reconnect is not a write.
     *
     * @returns whether the folder is new — the one thing worth a log line.
     */
    ensure(sessionProfileId: string): boolean {
        const { created } = this._store.ensureDir(sessionProfileId);
        const info = this._host.profileInfo(sessionProfileId);
        const text = indexText({
            name: info.name,
            description: info.description,
            sessionProfileId,
            files: this._store.files(sessionProfileId),
        });
        if (this._store.readIndex(sessionProfileId) !== text) {
            this._store.writeIndex(sessionProfileId, text);
        }
        // Read once per connect: the notice asks this, and the answer is Hermes' own file.
        this._protected.set(
            sessionProfileId,
            this._host.protectedSection(sessionProfileId, this.paths(sessionProfileId).dir),
        );
        if (created) {
            this._host.log(`Notes: created the folder for ${info.name || sessionProfileId}`);
        }
        return created;
    }

    /**
     * Where this agent's notes are, for the notice that tells it.
     *
     * A path and no promise: the folder is made by `ensure` on connect, so a read here never has to
     * create anything.
     */
    paths(sessionProfileId: string): NotesPaths {
        return {
            dir: this._store.dirFor(sessionProfileId),
            index: this._store.indexPathFor(sessionProfileId),
        };
    }

    /**
     * The notice's notes section: where the folder is, the rule about using it, and — while the
     * agent has not yet kept its protected section — the one-time block that asks for it.
     *
     * The texts are the contract and are not translated: every word here is read in every session
     * by every agent, and a translation is a second version of the same instruction.
     */
    notice(sessionProfileId: string): string {
        const dir = this.paths(sessionProfileId).dir;
        const lines = [
            '<agent-notes>',
            `Your notes folder: ${dir} (index: ${INDEX_FILE})`,
            'Keep notes per project here, so your memory stays small.',
            '</agent-notes>',
        ];
        if (this._protected.get(sessionProfileId) !== true) {
            lines.push('', notesSetupBlock(dir));
        }
        return lines.join('\n');
    }
}

/**
 * The one-time block: the protected section the agent keeps at the start of its own MEMORY.md.
 *
 * Ours is to ask, never to do it: MEMORY.md is Hermes' file (H2), so the agent writes the section
 * itself, and the notice stops carrying this block once the file shows it (see `ps_set`).
 */
export function notesSetupBlock(notesDir: string): string {
    return [
        '<agent-notes-setup>',
        'One-time setup. At the very start of your MEMORY.md, keep a protected section:',
        "== Protected section — change only on the user's explicit instruction ==",
        `Notes: ${notesDir} (index: ${INDEX_FILE})`,
        '== End of protected section ==',
        'The Notes line comes first in it. Create the section if missing; if one exists, rename its markers',
        'to these and add the Notes line. Replace entries that point to older note locations.',
        'Write memory and notes in English, whatever language the user speaks.',
        '</agent-notes-setup>',
    ].join('\n');
}

/**
 * The generated index, in the folder an agent reads first.
 *
 * Pure, so the shape is testable without a folder. Three facts and a list: who the agent is, who it
 * says it is, and which notes exist — never their content, which is the agent's business and would
 * make this file a second copy of it.
 */
export function indexText(input: {
    name: string;
    description: string;
    sessionProfileId: string;
    files: NoteFile[];
}): string {
    const lines = [
        `# ${input.name || input.sessionProfileId} — notes`,
        '',
        '**Generated.** The extension rewrites this file whenever the agent\'s name, its description',
        'or the list below changes. Do not keep notes in it: the other files in this folder are your',
        'own, and the extension only reads them.',
        '',
        `- Agent: ${input.name || '(unknown)'}`,
        `- Session profile id: ${input.sessionProfileId}`,
        `- Description: ${input.description || '(none)'}`,
        '',
        '## Files in this folder',
        '',
    ];
    if (input.files.length === 0) {
        lines.push('- (no notes yet)');
    } else {
        for (const file of input.files) {
            lines.push(`- \`${file.name}\` — ${file.size} bytes, changed ${new Date(file.changedAt).toISOString()}`);
        }
    }
    return `${lines.join('\n')}\n`;
}
