import { t } from '../i18n';
import type { HostToPane } from '../../shared/webview';
import { cliProfileForScopeKey, normalizeHermesCliProfile } from './hermesProfile';
import { discoverHermesProfiles } from './profileDiscovery';
import {
    hasProfilesRoot,
    isCurrentProfile,
    profileDescription,
    profileNameFromPreviousNames,
    profileNameHoldingSessions,
} from './profileFallback';
import { resolveHermesRoot } from './hermesPaths';
import type { ProfilesStore } from '../store/profiles';

export interface ProfileListEntry {
    id: string;
    label: string;
}

export interface ConnectionTarget {
    /** Our id for the agent: the key of every per-agent record, and the folder they live in. */
    sessionProfileId: string;
    /** Hermes' name for the profile today: what `--profile`, pane mail and the user use. */
    agentName: string;
    selectionId: string;
    displayName: string;
    cliProfile: string;
    configPath?: string;
}

/** The settings this feature reads, behind the same rule: the editor is not imported here (F6). */
export interface SettingsReader {
    get<T>(key: string): T | undefined;
}

/**
 * Who holds a profile, as one of the four ways it can be held.
 *
 * A locale key rather than English: the refusal is a sentence the user reads, and the zh-cn
 * translation has to carry every word of it.
 */
export type HolderKey = 'holderPrimaryHere' | 'holderSecondantHere' | 'holderPrimaryElsewhere' | 'holderSecondantElsewhere';

/** A profile this instance may not run on, and who holds it. */
export interface ExcludedProfile {
    cliProfile: string;
    holder: HolderKey;
}

/**
 * The exclusion list the picker and the connect guarantee share.
 *
 * In this window the two extensions withhold each other's profile through their junction; in any
 * other window each instance announces its own in the presence table (`store/presence.ts`).
 * Normalised here, once: the comparison is on the CLI profile, never on the label an agent
 * happens to be called. The holder keeps its role — presence announces it, and "another window"
 * alone cannot tell a user which of the two panes to look at.
 */
export function excludedProfiles(input: {
    /** The primary's profile, as the secondant is told it. */
    primary?: string;
    /** The secondant's profile, as the primary is told it. */
    sibling?: string;
    /** Every row another running instance announced, with its profile and its role. */
    elsewhere: Array<{ cliProfile: string; role?: 'primary' | 'secondant' }>;
}): ExcludedProfile[] {
    const list: ExcludedProfile[] = [];
    if (input.primary) {
        list.push({ cliProfile: normalizeHermesCliProfile(input.primary), holder: 'holderPrimaryHere' });
    }
    if (input.sibling) {
        list.push({ cliProfile: normalizeHermesCliProfile(input.sibling), holder: 'holderSecondantHere' });
    }
    for (const row of input.elsewhere) {
        if (row.cliProfile) {
            list.push({
                cliProfile: normalizeHermesCliProfile(row.cliProfile),
                holder: row.role === 'secondant' ? 'holderSecondantElsewhere' : 'holderPrimaryElsewhere',
            });
        }
    }
    return list.filter(entry => !!entry.cliProfile);
}

/** What the profile selector needs from the provider. */
export interface ProfilesHost {
    log(line: string): void;
    post(msg: HostToPane): void;
    settings: SettingsReader;
    /** The profile table: names to the ids our records will hang off (host/store/profiles.ts). */
    store: ProfilesStore;
    /**
     * The profiles the picker must not offer: the sibling's in this window, and every profile a
     * running instance announced in another window. Named by the CLI profile, the value the agent
     * actually runs on.
     */
    excludedProfiles?: () => Array<{ cliProfile: string }>;
    /**
     * The profile this pane last picked in this window's workspace, or '' when it never did.
     *
     * Read before the workspace is registered: the pick is what a start is resolved from, so it
     * cannot wait for the rest of the window.
     *
     * Required, like every other port member: the start rule and the "never a held profile"
     * guarantee are the feature, and a wiring that quietly leaves one out would delete them
     * without an error.
     */
    workspaceSelection: () => string;
    /** Remember this pane's pick for its workspace. The global key stays the fallback. */
    saveWorkspaceSelection: (selectionId: string) => void;
    /**
     * The CLI profiles other running instances hold.
     *
     * A start must never land on one of them: the window would connect, be refused by the
     * guarantee, and show an error where a profile was expected.
     */
    heldElsewhere: () => string[];
    /** Where Hermes keeps its profiles. Absent means the real home; a test passes a temp one. */
    hermesHome?: () => string;
}

/**
 * Which Hermes profile/agent we connect to, and which ones the picker offers.
 *
 * One question, one owner. Everything here answers it: settings (`tommys.path`, `tommys.profile`),
 * discovery of profiles on disk, and the selection that survives a window. The working folder is
 * not a profile question: the cwd owner answers that.
 */
export class Profiles {
    /** Agent name or CLI profile id used for reconnect / switch. */
    selectionId = '';
    /** What the chip shows: the agent name, or the translated label for `default`. */
    displayName = '';

    private discovered: string[] | null = null;
    private discovery: Promise<void> | undefined;

    constructor(private readonly _host: ProfilesHost) {}

    /**
     * Seed the in-memory selection from this window's pick, and resolve it.
     *
     * The order is the whole rule: this workspace's pick for this pane, then the configured
     * profile (`default`, as resolveTarget(undefined) answers), then the first profile presence
     * does not show as held. A candidate another window is running is skipped, so a start never
     * lands on one — and there is deliberately no "last picked anywhere" step: landing on the
     * configured profile beats landing on another window's.
     */
    seed(): ConnectionTarget {
        this.selectionId = this._startingSelection();
        const target = this.resolveTarget(this.selectionId || undefined);
        this.selectionId = target.selectionId;
        this.displayName = target.displayName;
        return target;
    }

    /** The pick a start resolves from: this workspace's, then the configured one, then a free one. */
    private _startingSelection(): string {
        const held = new Set(this._host.heldElsewhere()
            .map(cliProfile => normalizeHermesCliProfile(cliProfile))
            .filter(Boolean));
        const candidates = [
            this._host.workspaceSelection(),
            this.resolveTarget(undefined).selectionId,
        ];
        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }
            const cliProfile = normalizeHermesCliProfile(this.resolveTarget(candidate).cliProfile);
            if (held.has(cliProfile)) {
                this._host.log(`Start profile "${candidate}" is held by another window; skipping it`);
                continue;
            }
            return candidate;
        }
        const free = this._firstFreeSelection(held);
        if (free) {
            this._host.log(`Start profile "${free}": the first one no other window holds`);
        }
        return free;
    }

    /** The first known profile no other window runs: the list is the table's, in the order it was seeded. */
    private _firstFreeSelection(held: Set<string>): string {
        for (const row of this._host.store.all()) {
            const name = row.agentName;
            if (!name) {
                continue;
            }
            if (!held.has(normalizeHermesCliProfile(this.resolveTarget(name).cliProfile))) {
                return name;
            }
        }
        return '';
    }

    /**
     * Give every profile we already know a row in the table, once per extension load.
     *
     * Two sources, and neither changes anything on disk: the folders our data home already holds
     * (the names from before a rename included — nothing is renamed, moved or re-keyed) and the
     * profiles Hermes lists. Discovery costs a CLI call and runs in the background, so the folder
     * rows are written first and the discovery answer is seeded when it arrives; the default
     * profile is `default`.
     */
    seedStore(): void {
        const store = this._host.store;
        store.seed(store.localScopes().map(cliProfileForScopeKey));
        void this.ensureDiscovered().then(() => {
            store.seed(this.discovered ?? []);
        });
    }

    /**
     * The agent a folder in our data home belongs to.
     *
     * The folder was written under a name, and a name is the one thing about a profile that changes.
     * Three questions, in order: is that name Hermes' name for a profile today (then it is the
     * answer); does some profile.yaml hold it under `previous_names`; whose state.db holds the tabs
     * the folder has. Nothing found is an answer too — the caller leaves the folder where it is.
     */
    agentForScope(scopeKey: string, sessionIds: string[]): string | undefined {
        const name = cliProfileForScopeKey(scopeKey);
        const known = this._host.store.all().some(row => row.agentName === name);
        if (known || isCurrentProfile(name)) {
            return name;
        }
        return profileNameFromPreviousNames(name)
            // The log goes through: an unreadable state.db is skipped, never silently.
            || profileNameHoldingSessions(sessionIds, undefined, line => this._host.log(line));
    }

    /**
     * The target to connect with, after repairing a name Hermes no longer has.
     *
     * Tier 1 is the name the table holds. When Hermes does not have that profile any more, the two
     * fallbacks look for it — the profile.yaml whose `previous_names` holds the name, then the
     * profile whose state.db holds the tabs we have open — and the row is renamed to what they
     * found. The id stays; only the name it answers to moves, which is exactly what a Hermes rename
     * is. Nothing found leaves the row and every folder untouched, and `missing` says so for the
     * pane, but only where Hermes' own profiles folder exists: on a machine Hermes never ran on,
     * every name is missing and that means nothing.
     */
    connectTarget(selectionId: string | undefined, sessionIds: string[]): { target: ConnectionTarget; missing: boolean } {
        const target = this.resolveTarget(selectionId);
        const hermesHome = this._host.hermesHome ? this._host.hermesHome() : resolveHermesRoot();
        // Nothing to repair when the table has no row for this id (a name nobody has seen yet), or
        // when Hermes still has the name the row holds.
        const stored = this._host.store.nameFor(target.sessionProfileId);
        if (!stored || isCurrentProfile(stored, hermesHome)) {
            return { target, missing: false };
        }
        const found = profileNameFromPreviousNames(stored, hermesHome)
            || profileNameHoldingSessions(sessionIds, hermesHome, line => this._host.log(line));
        if (!found) {
            return { target, missing: hasProfilesRoot(hermesHome) };
        }
        if (found !== stored) {
            this._host.store.rename(target.sessionProfileId, found);
            this._host.log(`Profile renamed outside the extension: "${stored}" -> "${found}"`);
        }
        return { target: this.resolveTarget(found), missing: false };
    }

    resolveTarget(selectionId?: string): ConnectionTarget {
        const configPath = this._host.settings.get<string>('path') || undefined;
        const configProfile = this._host.settings.get<string>('profile') || undefined;
        const resolvedId = selectionId || this.selectionId || normalizeHermesCliProfile(configProfile);
        const cliProfile = normalizeHermesCliProfile(resolvedId);
        return {
            // The name is translated here and nowhere else: the id names the folder, the name is
            // what Hermes is told. A name nobody has seen yet mints its row on first use.
            sessionProfileId: this._host.store.idFor(cliProfile),
            agentName: cliProfile,
            selectionId: cliProfile,
            displayName: this.labelFor(cliProfile),
            cliProfile,
            configPath,
        };
    }

    /**
     * Hermes' name for a profile id: the name of that id's folder.
     *
     * The one lookup a caller has when it holds an id and needs a name — a tree file names the
     * agent of the folder it sits in. Nothing is minted and nothing is renamed here. An id the
     * table has no row for falls back to the name the selection resolves to, which is what this
     * answered before the table could be asked, and the only answer left when there is no row.
     */
    agentNameFor(sessionProfileId: string): string {
        return this._host.store.nameFor(sessionProfileId) || this.resolveTarget().agentName;
    }

    /**
     * What a generated file may say about an agent: today's name, and the description Hermes keeps.
     *
     * The name comes from the id's own row, like `agentNameFor`. The description is read from that
     * profile's `profile.yaml`, and is empty when Hermes has none — read, never written (H2).
     */
    describeAgent(sessionProfileId: string): { name: string; description: string } {
        const name = this.agentNameFor(sessionProfileId);
        const hermesHome = this._host.hermesHome ? this._host.hermesHome() : undefined;
        return { name, description: profileDescription(name, hermesHome) };
    }

    labelFor(cliProfile: string): string {
        return normalizeHermesCliProfile(cliProfile) === 'default'
            ? t('defaultAgent')
            : cliProfile;
    }

    async ensureDiscovered(): Promise<void> {
        if (this.discovered) {
            return;
        }
        if (this.discovery) {
            await this.discovery;
            return;
        }
        this.discovery = (async () => {
            const hermesPath = this._host.settings.get<string>('path') || undefined;
            try {
                this.discovered = await discoverHermesProfiles(hermesPath);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._host.log(`Profile discovery failed: ${msg}`);
                this.discovered = ['default'];
            }
        })();
        try {
            await this.discovery;
        } finally {
            this.discovery = undefined;
        }
    }

    entries(): ProfileListEntry[] {
        const list: ProfileListEntry[] =
            (this.discovered ?? ['default']).map(p => ({ id: p, label: this.labelFor(p) }));

        // The rule the extensions live by: two panes may not run on one profile, in this window or
        // in any other. Compare what the agent will run on (`cliProfile`), not the id or label an
        // agent happens to be called.
        const excluded = (this._host.excludedProfiles?.() || [])
            .map(entry => normalizeHermesCliProfile(entry.cliProfile))
            .filter(Boolean);
        if (excluded.length === 0) {
            return list;
        }
        return list.filter(entry => !excluded.includes(this.resolveTarget(entry.id).cliProfile));
    }

    postList(): void {
        void this.ensureDiscovered().then(() => {
            this._host.post({ type: 'profileList', profiles: this.entries() });
        });
    }

    /**
     * Remember the profile a connect landed on, as this workspace's pick for this pane.
     *
     * The one writer, called from the connect's own success signal (`App`, on `profileActive`), so
     * start, switch and reconnect all record what they proved. Nothing is written to globalState
     * any more: the pick is per workspace, and no start reads a "last picked anywhere" value.
     */
    persistSelection(): void {
        if (!this.selectionId) {
            return;
        }
        this._host.saveWorkspaceSelection(this.selectionId);
    }

    /** The agent list changed: the profiles on disk must be read again. */
    forgetDiscovered(): void {
        this.discovered = null;
    }
}
