import * as vscode from 'vscode';
import { t } from '../i18n';
import type { HostToPane } from '../types/webview';
import { normalizeHermesCliProfile, scopeKeyForCliProfile } from './hermesProfile';
import { discoverHermesProfiles } from './profileDiscovery';
import { sanitizeProfileScopeKey } from '../cache/profileStorage';

export interface HermesAgentConfig {
    name: string;
    path?: string;
    profile?: string;
    cwd?: string;
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
    configCwd?: string;
}

/** What the profile selector needs from the provider. */
export interface ProfilesHost {
    log(line: string): void;
    post(msg: HostToPane): void;
    globalState: vscode.Memento;
}

/**
 * Which Hermes profile/agent we connect to, and which ones the picker offers.
 *
 * One question, one owner. Everything here answers it: settings (`tommys.path`, `tommys.cwd`,
 * `tommys.profile`, `tommys.agents`), the agent list, discovery of profiles on disk, and the
 * selection that survives a window.
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

    resolveTarget(selectionId?: string): ConnectionTarget {
        const config = vscode.workspace.getConfiguration('tommys');
        const configPath = config.get<string>('path') || undefined;
        const configCwd = config.get<string>('cwd') || undefined;
        const configProfile = config.get<string>('profile') || undefined;
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
                configCwd: agent.cwd || configCwd,
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
            configCwd,
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
            const config = vscode.workspace.getConfiguration('tommys');
            const hermesPath = config.get<string>('path') || undefined;
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
        if (agents.length > 0) {
            return agents.map(a => ({ id: a.name, label: a.name }));
        }
        const profiles = this.discovered ?? ['default'];
        return profiles.map(p => ({
            id: p,
            label: this.labelFor(p),
        }));
    }

    readAgentConfigs(): HermesAgentConfig[] {
        const config = vscode.workspace.getConfiguration('tommys');
        const raw = config.get<unknown>('agents');
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
