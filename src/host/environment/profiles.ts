import { t } from '../i18n';
import type { HostToPane } from '../../shared/webview';
import { cliProfileForScopeKey, normalizeHermesCliProfile, scopeKeyForCliProfile } from './hermesProfile';
import { discoverHermesProfiles } from './profileDiscovery';
import { sanitizeProfileScopeKey } from '../workspace/profileStorage';
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
    scopeKey: string;
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

    resolveTarget(selectionId?: string): ConnectionTarget {
        const configPath = this._host.settings.get<string>('path') || undefined;
        const configProfile = this._host.settings.get<string>('profile') || undefined;
        const agents = this.readAgentConfigs();

        if (agents.length > 0) {
            const resolvedId = selectionId || this.selectionId || agents[0].name;
            const agent = agents.find(a => a.name === resolvedId) || agents[0];
            return {
                scopeKey: sanitizeProfileScopeKey(agent.name),
                selectionId: agent.name,
                displayName: agent.name,
                cliProfile: normalizeHermesCliProfile(agent.profile ?? configProfile),
                configPath: agent.path || configPath,
            };
        }

        const resolvedId = selectionId || this.selectionId || normalizeHermesCliProfile(configProfile);
        const cliProfile = normalizeHermesCliProfile(resolvedId);
        return {
            scopeKey: scopeKeyForCliProfile(cliProfile),
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
