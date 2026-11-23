import * as fs from 'fs';
import * as path from 'path';
import { t } from '../i18n';
import type { AgentNotes } from './notes';
import type { MirrorLinkRow, MirrorSetup, NotesStore } from './store';
import { readObsidianVaults } from './obsidian';
import type { EditorChoices } from '../../shared/editor';

/**
 * The agent notes mirror: the user's own window into `profiles/<uuid>/notes/`.
 *
 * The folders are named by ids, and an id is not something a person reads in Obsidian or Kate. So
 * the user picks a location once, and this feature keeps `PAs - AgentsProfileInfo` in it with one
 * link per agent, named after the agent and pointing at that agent's notes.
 *
 * Three rules decide everything here:
 * - **A real file is never touched.** Only a link this feature made is renamed or replaced, and a
 *   real file or folder in the mirror is reported and left exactly as it is.
 * - **Nothing is deleted to tidy up.** A link whose target is gone is reported; a link this
 *   extension did not make is reported.
 * - **The link list is the record.** Which agent owns which link is stored beside the mirror's
 *   location (`notes-mirror.json` in the data home), so a rename in Hermes is answered by renaming
 *   one link, not by guessing whose it was.
 *
 * Where it touches a disk: the data home through `NotesStore` (ST1); the mirror folder, which is
 * the user's own folder outside our data home, in this file only. It reaches the editor only
 * through `NotesMirrorHost` (F6).
 */

/** The folder the mirror is. Fixed: a reader who knows the name can find it. */
export const MIRROR_FOLDER = 'PAs - AgentsProfileInfo';

/** One row the user chooses between when the mirror is set up. */
export interface MirrorChoice {
    id: string;
    label: string;
    /** What the row says beside the label: the folder it will use. */
    detail?: string;
    /** The one this extension suggests. */
    suggested?: boolean;
}

/** What the mirror needs from outside: the user's answer, the OS, the log, the menu. */
export interface NotesMirrorHost {
    log(line: string): void;
    /** One short line to the user, through the editor's own notifications. */
    info(message: string): void;
    /** The user's answers and the OS's folders, behind the editor's port (F6). */
    choices: EditorChoices;
    /** Every agent we know: the ids the folders are named by, and Hermes' name for each today. */
    agents(): Array<{ sessionProfileId: string; agentName: string }>;
    /** Turn the ⋯ menu's item: set up when there is no mirror, repair when there is one. */
    mirrorSet(value: boolean): void;
    /**
     * Is another window — either extension — already running?
     *
     * The question is asked once per start, and this is how one window knows it is not the first:
     * `ProfilePresence` announces a window that has a connect, and both extensions share the table.
     */
    otherWindowLive(): boolean;
    /** The agent this window is on: what "open notes location" opens. */
    currentAgentId(): string;
}

/** How long "Remind me in 2 weeks" waits. */
export const ASK_AGAIN_MS = 14 * 24 * 60 * 60 * 1000;

/** What one sync did: one line for the user, the detail to the log. */
export interface MirrorReport {
    created: number;
    renamed: number;
    intact: number;
    findings: string[];
}

/**
 * A link name for an agent: the agent's name, with what Windows forbids replaced.
 *
 * A file name cannot hold `<>:"/\|?*` or a control character, cannot end in a dot or a space, and
 * an empty result is no name at all — that last case falls back to the id, which always works.
 * The name is only *sanitised*, never folded: two agents that differ only in case are reported by
 * the caller rather than merged into one link.
 */
export function linkNameFor(agentName: string, sessionProfileId: string): string {
    const cleaned = agentName
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/[. ]+$/, '')
        .trim();
    return cleaned || sessionProfileId;
}

/** The path a link names, as a string that can be compared with another path. */
function sameTarget(left: string, right: string, platform: NodeJS.Platform): boolean {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** A short reason for a filesystem error, for a line the user reads. */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class NotesMirror {
    /** Whether this window has put the question up in this start: a profile switch is not a start. */
    private _asked = false;

    constructor(
        private readonly _store: NotesStore,
        private readonly _notes: AgentNotes,
        private readonly _host: NotesMirrorHost,
        private readonly _platform: NodeJS.Platform = process.platform,
        private readonly _env: Record<string, string | undefined> = process.env,
    ) {}

    /**
     * The ⋯ menu's agent group, one member per item.
     *
     * The feature answers its own menu: the current agent is the window's, so it is asked for
     * through the port rather than handed in at construction (a window can switch agents).
     */
    get commands() {
        return {
            openLocation: () => this.openLocation(this._host.currentAgentId()),
            setUp: () => this.setUp(),
            repair: () => this.repair(),
            changeLocation: () => this.changeLocation(),
        };
    }

    /** Where the mirror is, and what it holds, or undefined when the user has none. */
    current(): MirrorSetup | undefined {
        return this._store.readMirror();
    }

    /**
     * Every start: say which menu item applies, and repair quietly when a mirror is set.
     *
     * Quiet means the log and the context key only: a window that starts on a working mirror says
     * nothing, and one that had to make a link says it in one line.
     */
    repairOnStart(): void {
        const setup = this.current();
        this._host.mirrorSet(!!setup);
        if (!setup) {
            return;
        }
        const report = this.sync(setup);
        if (report.created || report.renamed || report.findings.length) {
            this._host.log(this.summary(report, setup.location));
        }
    }

    /**
     * The first-run question, when it is due — once per start, in one window.
     *
     * Called when a connect lands, which is the moment this window has something to announce
     * (`ProfilePresence`); before that, every window looks like the only one. The file decides the
     * rest: a location means there is nothing to ask, "never" is final, and "later" waits its date.
     */
    async askIfDue(): Promise<void> {
        if (this._asked || this.current() || !this._due()) {
            return;
        }
        if (this._host.otherWindowLive()) {
            this._host.log('Notes mirror: another window is running; the question is asked there');
            return;
        }
        const doIt = t('notesAskDoIt');
        this._asked = true;
        const answer = await this._host.choices.ask(t('notesAskMirror'), [
            doIt,
            t('notesAskLater'),
            t('notesAskNever'),
        ]);
        if (!answer) {
            // Closed: nothing written, so the next start asks again.
            return;
        }
        if (answer === doIt) {
            await this.setUp();
            return;
        }
        if (answer === t('notesAskLater')) {
            this._store.writeAnswer('later', Date.now() + ASK_AGAIN_MS);
            return;
        }
        if (answer === t('notesAskNever')) {
            this._store.writeAnswer('never', 0);
        }
    }

    /** Is the question due? No answer at all, or a `later` whose date has passed. */
    private _due(now = Date.now()): boolean {
        const answer = this._store.readAnswer();
        if (!answer) {
            return true;
        }
        return answer.answer === 'later' && now >= answer.askAfter;
    }

    /**
     * The ⋯ menu, no mirror yet: ask where, make it, and fill it.
     *
     * Dismissing the picker is an answer too — nothing is created and nothing is stored.
     */
    async setUp(): Promise<void> {
        const location = await this._askLocation();
        if (!location) {
            return;
        }
        const report = this._install(location);
        if (report) {
            await this._announce(report, location);
        }
    }

    /**
     * The ⋯ menu, a mirror already set: build the new one, then take the old one down.
     *
     * The new mirror is made first, so a failed attempt leaves the working one alone. The old
     * folder goes only when everything in it is a link of ours (see `_retireOldMirror`).
     */
    async changeLocation(): Promise<void> {
        const previous = this.current();
        if (!previous) {
            await this.setUp();
            return;
        }
        const location = await this._askLocation();
        if (!location || location === previous.location) {
            return;
        }
        const report = this._install(location);
        if (!report) {
            return;
        }
        report.findings.push(...this._retireOldMirror(previous.location));
        await this._announce(report, location);
    }

    /** Make the folder, record it, and fill it. Undefined when the folder could not be made. */
    private _install(location: string): MirrorReport | undefined {
        try {
            fs.mkdirSync(path.join(location, MIRROR_FOLDER), { recursive: true });
        } catch (error) {
            this._host.info(t('notesMirrorFolderFailed', location, describeError(error)));
            return undefined;
        }
        this._store.writeMirror({ location, agents: [] });
        this._host.mirrorSet(true);
        const setup = this.current();
        return setup ? this.sync(setup) : undefined;
    }

    /**
     * The done notice: what it did, the folder in full, and a button that opens it.
     *
     * A notice with a button, not a bare line: the one thing the user wants after choosing a place
     * is to look at it, and the path alone does not open anything.
     */
    private async _announce(report: MirrorReport, location: string): Promise<void> {
        const answer = await this._host.choices.ask(this.summary(report, location), [t('notesMirrorOpenFolder')]);
        if (answer === t('notesMirrorOpenFolder')) {
            await this._host.choices.showInFileManager(path.join(location, MIRROR_FOLDER));
        }
    }

    /**
     * Take down the folder we are leaving — only when everything in it is a link of ours.
     *
     * A real file or folder inside it is the user's, so the whole folder is then left exactly as
     * it is, links and all, and reported. No link is removed unless it points at an agent's notes
     * folder that we know, and the folder itself goes only when it is empty afterwards.
     */
    private _retireOldMirror(location: string): string[] {
        const folder = path.join(location, MIRROR_FOLDER);
        let names: string[];
        try {
            names = fs.readdirSync(folder);
        } catch {
            return [];
        }
        const notesDirs = this._host.agents()
            .map(agent => this._notes.paths(agent.sessionProfileId).dir);
        const ours: string[] = [];
        const foreign: string[] = [];
        for (const name of names) {
            const entry = path.join(folder, name);
            const state = this._stateOf(entry);
            const target = state.kind === 'link' && state.target ? state.target : '';
            if (target && notesDirs.some(known => sameTarget(known, target, this._platform))) {
                ours.push(entry);
            } else {
                foreign.push(name);
            }
        }
        if (foreign.length > 0) {
            return [t('notesMirrorOldKept', folder, foreign.join(', '))];
        }
        const findings: string[] = [];
        for (const entry of ours) {
            try {
                fs.unlinkSync(entry);
            } catch (error) {
                findings.push(t('notesMirrorOldFailed', describeError(error)));
            }
        }
        if (findings.length === 0) {
            try {
                fs.rmdirSync(folder);
                this._host.log(`Notes mirror: ${folder} retired`);
            } catch (error) {
                findings.push(t('notesMirrorOldFailed', describeError(error)));
            }
        }
        return findings;
    }

    /** The ⋯ menu, mirror already set: bring it in line with the agents, and say what changed. */
    repair(): void {
        const setup = this.current();
        if (!setup) {
            return;
        }
        const report = this.sync(setup);
        this._host.info(this.summary(report, setup.location));
    }

    /** "Open notes location (current agent)": that agent's own folder, in the OS file manager. */
    async openLocation(sessionProfileId: string): Promise<void> {
        try {
            await this._host.choices.showInFileManager(this._notes.paths(sessionProfileId).dir);
        } catch (error) {
            this._host.info(t('notesOpenFailed', describeError(error)));
        }
    }

    /**
     * Bring the mirror in line with the agents, one row at a time.
     *
     * The record of which link belongs to which agent is rewritten with what is on disk now, so a
     * link whose name is taken stays remembered under the old name and is not fought over on the
     * next start.
     */
    sync(setup: MirrorSetup): MirrorReport {
        const report: MirrorReport = { created: 0, renamed: 0, intact: 0, findings: [] };
        const folder = path.join(setup.location, MIRROR_FOLDER);
        try {
            fs.mkdirSync(folder, { recursive: true });
        } catch (error) {
            report.findings.push(t('notesMirrorFolderFailed', folder, describeError(error)));
            return report;
        }
        const previous = new Map<string, MirrorLinkRow>(setup.agents.map(row => [row.sessionProfileId, row]));
        const claimed = new Map<string, string>();
        const rows: MirrorLinkRow[] = [];
        for (const agent of this._host.agents()) {
            const link = linkNameFor(agent.agentName, agent.sessionProfileId);
            const folded = link.toLowerCase();
            const holder = claimed.get(folded);
            if (holder && holder !== agent.sessionProfileId) {
                // Two agents whose names differ only in case: one link on a case-insensitive disk,
                // so the second is reported instead of quietly sharing the first one's folder.
                report.findings.push(t('notesMirrorCaseClash', link));
                continue;
            }
            claimed.set(folded, agent.sessionProfileId);
            const target = path.resolve(this._notes.paths(agent.sessionProfileId).dir);
            const was = previous.get(agent.sessionProfileId);
            if (was && was.link !== link) {
                this._rename(folder, was.link, link, target, report);
            }
            const row: MirrorLinkRow = { sessionProfileId: agent.sessionProfileId, name: agent.agentName, link };
            rows.push(row);
            this._ensureLink(folder, row, target, report);
        }
        this._store.writeMirror({ location: setup.location, agents: rows });
        return report;
    }

    /** The one line the user reads: what went in, and how many things were left alone. */
    private summary(report: MirrorReport, location: string): string {
        const line = t('notesMirrorDone', report.created, report.renamed, report.findings.length);
        for (const finding of report.findings) {
            this._host.log(`Notes mirror: ${finding}`);
        }
        return `${line} ${path.join(location, MIRROR_FOLDER)}`;
    }

    /**
     * Ask where the mirror goes: Obsidian's vaults, Documents, or a folder of the user's own.
     *
     * Every row answers with the folder that will exist afterwards — the chosen folder is the
     * *parent* of `PAs - AgentsProfileInfo`, and a picker that shows only the parent leaves the user
     * guessing which of the two they are choosing. A folder from the OS dialog is confirmed with
     * that same path before anything is created; "Back" returns to the list.
     */
    private async _askLocation(): Promise<string | undefined> {
        const home = this._host.choices.home();
        const documents = path.join(home, 'Documents');
        for (;;) {
            const choices: MirrorChoice[] = readObsidianVaults(this._platform, home, this._env)
                .map((vault, index) => ({
                    id: vault.path,
                    label: vault.name,
                    detail: path.join(vault.path, MIRROR_FOLDER),
                    suggested: index === 0,
                }));
            choices.push({
                id: 'documents',
                label: t('notesMirrorDocuments'),
                detail: path.join(documents, MIRROR_FOLDER),
            });
            choices.push({ id: 'choose', label: t('notesMirrorChoose') });

            const picked = await this._host.choices.pick(t('notesMirrorTitle'), choices);
            if (!picked) {
                return undefined;
            }
            if (picked === 'documents') {
                return documents;
            }
            if (picked !== 'choose') {
                return picked;
            }
            const chosen = await this._host.choices.pickFolder(t('notesMirrorChoose'), home);
            if (!chosen) {
                return undefined;
            }
            const answer = await this._host.choices.ask(
                t('notesMirrorConfirm', path.join(chosen, MIRROR_FOLDER)),
                [t('notesMirrorCreateHere'), t('notesMirrorBack')],
            );
            if (answer === t('notesMirrorCreateHere')) {
                return chosen;
            }
            if (!answer) {
                return undefined;
            }
            // "Back": the list again, with nothing created.
        }
    }

    /** A renamed agent: move our own link to the new name, or say what stands in the way. */
    private _rename(folder: string, from: string, to: string, target: string, report: MirrorReport): void {
        const source = path.join(folder, from);
        const state = this._stateOf(source);
        if (state.kind === 'missing') {
            return;
        }
        if (state.kind === 'real') {
            report.findings.push(t('notesMirrorRealEntry', from));
            return;
        }
        if (!state.target || !sameTarget(state.target, target, this._platform)) {
            report.findings.push(t('notesMirrorNotOurs', from));
            return;
        }
        if (this._stateOf(path.join(folder, to)).kind !== 'missing') {
            report.findings.push(t('notesMirrorNameTaken', to));
            return;
        }
        try {
            fs.renameSync(source, path.join(folder, to));
            report.renamed++;
            this._host.log(`Notes mirror: "${from}" -> "${to}"`);
        } catch (error) {
            report.findings.push(t('notesMirrorLinkFailed', to, describeError(error)));
        }
    }

    /** Make sure one agent's link is there and points at its notes. Never touches a real entry. */
    private _ensureLink(folder: string, row: MirrorLinkRow, target: string, report: MirrorReport): void {
        const linkPath = path.join(folder, row.link);
        const state = this._stateOf(linkPath);
        if (state.kind === 'real') {
            report.findings.push(t('notesMirrorRealEntry', row.link));
            return;
        }
        if (state.kind === 'link') {
            if (!state.target || !sameTarget(state.target, target, this._platform)) {
                report.findings.push(t('notesMirrorNotOurs', row.link));
                return;
            }
            if (!fs.existsSync(target)) {
                // Our link, but the folder behind it went away (a removed profile folder): make the
                // folder again rather than delete the link the user can see.
                this._notes.ensure(row.sessionProfileId);
                report.findings.push(t('notesMirrorTargetRestored', row.link));
                return;
            }
            report.intact++;
            return;
        }
        // Nothing stands there: the notes exist first, so the link is never made to nothing.
        this._notes.ensure(row.sessionProfileId);
        try {
            fs.symlinkSync(target, linkPath, this._platform === 'win32' ? 'junction' : 'dir');
            report.created++;
        } catch (error) {
            report.findings.push(t('notesMirrorLinkFailed', row.link, describeError(error)));
        }
    }

    /**
     * What stands at a path: nothing, a link (with what it names), or something real.
     *
     * `lstat` and `readlink` rather than `existsSync`: a link whose target is gone still has to be
     * told apart from an empty place, because one is reported and the other is filled.
     */
    private _stateOf(entryPath: string): { kind: 'missing' } | { kind: 'real' } | { kind: 'link'; target?: string } {
        let entry: fs.Stats;
        try {
            entry = fs.lstatSync(entryPath);
        } catch {
            return { kind: 'missing' };
        }
        if (!entry.isSymbolicLink()) {
            return { kind: 'real' };
        }
        try {
            return { kind: 'link', target: path.resolve(path.dirname(entryPath), fs.readlinkSync(entryPath)) };
        } catch {
            return { kind: 'link' };
        }
    }
}
