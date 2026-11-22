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
}

/** Where the notice points: the folder the agent writes in, and the index that describes it. */
export interface NotesPaths {
    dir: string;
    index: string;
}

export class AgentNotes {
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
     * The notice's notes section: where the folder is, and the one rule about using it.
     *
     * The rule is a rule for the agent, not something we do: its memory entry is Hermes' file, and
     * we never write it (H2). Ours is to say where the room is.
     */
    notice(sessionProfileId: string): string {
        const paths = this.paths(sessionProfileId);
        return [
            '<agent-notes>',
            `Your own notes folder — this agent's, never shared: ${paths.dir}`,
            `Its index names you and lists what is there: ${paths.index}`,
            'When your memory is full, move what only you need to your notes. Keep one memory entry',
            'that points to this folder.',
            '</agent-notes>',
        ].join('\n');
    }
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
