import { t } from '../i18n';
import type { HostToPane } from '../../shared/webview';
import { cliProfileForScopeKey, normalizeHermesCliProfile } from './hermesProfile';
import { discoverHermesProfiles } from './profileDiscovery';
import {
    hasProfilesRoot,
    isCurrentProfile,
    profileNameFromPreviousNames,
    profileNameHoldingSessions,
} from './profileFallback';
import { sanitizeProfileScopeKey } from '../workspace/profileStorage';
import { resolveHermesRoot } from './hermesPaths';
import type { ProfilesStore } from '../store/profiles';

export interface HermesAgentConfig {
    name: string;
    path?: string;
    profile?: string;
}

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

/**
 * What the editor's per-window store offers this feature: read one key, write one key.
 *
 * Declared here rather than importing `vscode.Memento`, so this file stays editor-free (F6). The
 * composition root hands it `context.globalState`, which fits without a cast.
 */
export interface KeyValueState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): PromiseLike<void>;
}

/** The settings this feature reads, behind the same rule: the editor is not imported here (F6). */
export interface SettingsReader {
    get<T>(key: string): T | undefined;
}

/** What the profile selector needs from the provider. */
export interface ProfilesHost {
    log(line: string): void;
    post(msg: HostToPane): void;
    globalState: KeyValueState;
    settings: SettingsReader;
    /** The profile table: names to the ids our records will hang off (host/store/profiles.ts). */
    store: ProfilesStore;
    /** The profile the picker must not offer: the primary's, when this is the secondant. */
    excludedProfile?: () => string | undefined;
    /** Where Hermes keeps its profiles. Absent means the real home; a test passes a temp one. */
    hermesHome?: () => string;
}

/**
 * Which Hermes profile/agent we connect to, and which ones the picker offers.
 *
 * One question, one owner. Everything here answers it: settings (`tommys.path`, `tommys.profile`,
 * `tommys.agents`), the agent list, discovery of profiles on disk, and the selection that survives a
 * window. The working folder is not a profile question: the cwd owner answers that.
 */
export class Profiles {
    /** Agent name or CLI profile id used for reconnect / switch. */
    selectionId = '';
    /** What the chip shows: the agent name, or the translated label for `default`. */
    displayName = '';

    private discovered: string[] | null = null;
    private discovery: Promise<void> | undefined;
    private readonly persistedSelectionId: string;

    constructor(private readonly _host: ProfilesHost) {
        // The profile/agent last picked in the UI outlives the window: without this the
        // extension always reopened on the `tommys.profile` setting, not on the user's pick.
        this.persistedSelectionId = this._host.globalState.get<string>('activeSelectionId') || '';
    }

    /**
     * Seed the in-memory selection from the persisted id, and resolve it.
     *
     * resolveTarget() prefers the in-memory selection over the configured profile, and still
     * falls back when the persisted id no longer resolves.
     */
    seed(): ConnectionTarget {
        this.selectionId = this.persistedSelectionId;
        const target = this.resolveTarget(this.persistedSelectionId || undefined);
        this.selectionId = target.selectionId;
        this.displayName = target.displayName;
        return target;
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
        return profileNameFromPreviousNames(name) || profileNameHoldingSessions(sessionIds);
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
        // A configured agent's key is its display name, not one of our ids: there is nothing to repair.
        const stored = this._host.store.nameFor(target.sessionProfileId);
        if (!stored || isCurrentProfile(stored, hermesHome)) {
            return { target, missing: false };
        }
        const found = profileNameFromPreviousNames(stored, hermesHome) || profileNameHoldingSessions(sessionIds, hermesHome);
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
        const agents = this.readAgentConfigs();

        if (agents.length > 0) {
            const resolvedId = selectionId || this.selectionId || agents[0].name;
            const agent = agents.find(a => a.name === resolvedId) || agents[0];
            return {
                // A configured agent is not a Hermes profile, so it keeps the display-name key it
                // has always had; nothing but a real profile has an id of ours.
                sessionProfileId: sanitizeProfileScopeKey(agent.name),
                agentName: agent.name,
                selectionId: agent.name,
                displayName: agent.name,
                cliProfile: normalizeHermesCliProfile(agent.profile ?? configProfile),
                configPath: agent.path || configPath,
            };
        }

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

    labelFor(cliProfile: string): string {
        return normalizeHermesCliProfile(cliProfile) === 'default'
            ? t('defaultAgent')
            : cliProfile;
    }

    async ensureDiscovered(): Promise<void> {
        if (this.readAgentConfigs().length > 0) {
            this.discovered = null;
            return;
        }
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
        const agents = this.readAgentConfigs();
        const list: ProfileListEntry[] = agents.length > 0
            ? agents.map(a => ({ id: a.name, label: a.name }))
            : (this.discovered ?? ['default']).map(p => ({ id: p, label: this.labelFor(p) }));

        // The secondant may not offer the profile the primary is on: it is not a preference,
        // it is the rule the two extensions live by. Compare what the agent will run on
        // (`cliProfile`), not the id or label an agent happens to be called.
        const excluded = this._host.excludedProfile?.();
        if (!excluded) {
            return list;
        }
        const excludedCli = normalizeHermesCliProfile(excluded);
        return list.filter(entry => this.resolveTarget(entry.id).cliProfile !== excludedCli);
    }

    readAgentConfigs(): HermesAgentConfig[] {
        const raw = this._host.settings.get<unknown>('agents');
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.flatMap(entry => {
            if (!entry || typeof entry !== 'object') {
                return [];
            }
            const name = (entry as { name?: unknown }).name;
            if (typeof name !== 'string' || !name.trim()) {
                return [];
            }
            const agent = entry as HermesAgentConfig;
            return [{ ...agent, name: name.trim() }];
        });
    }

    postList(): void {
        void this.ensureDiscovered().then(() => {
            this._host.post({ type: 'profileList', profiles: this.entries() });
        });
    }

    /** Remember the pick, so the next window opens on it. */
    persistSelection(id: string): void {
        void this._host.globalState.update('activeSelectionId', id);
    }

    /** The agent list changed: the profiles on disk must be read again. */
    forgetDiscovered(): void {
        this.discovered = null;
    }
}
