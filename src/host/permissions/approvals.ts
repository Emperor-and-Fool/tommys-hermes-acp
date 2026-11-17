import { t } from '../i18n';
import { isSettableApprovalMode } from './approvalModeRules';
import type { ApprovalModeControl } from './approvalModeControl';
import type { PermissionsStore } from './store';
import type { ApprovalMode, HostToPane } from '../../shared/webview';

/** What the permissions feature needs from the rest of the extension. */
export interface ApprovalsHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    /** The CLI profile whose `config.yaml` holds `approvals.mode` and `approvals.deny`. */
    profile(): string;
    /** The Hermes CLI, when one is installed. */
    executable(): Promise<string | undefined>;
}

/** What the router reaches: one member for the whole feature (R2). */
export interface PermissionCommands {
    setMode(mode: unknown): Promise<void>;
    /** Re-read the mode and answer even when it has not changed. */
    request(): void;
    /** The red action: save the deny list, clear it, turn approvals off. */
    openAccess(): Promise<void>;
    /** Put the saved deny list back. */
    restoreDeny(): Promise<void>;
}

/**
 * Permissions: which approval mode the profile runs, and what the red action does.
 *
 * The mode is a profile setting, so this feature reads and writes the profile's `config.yaml`
 * through the CLI. That is the one place our code writes into Hermes' own configuration, and it is
 * deliberate: the mode is the user's setting, not Hermes data (H2 is about transcripts and the
 * catalog). What it never touches is Hermes' idea of what the agent may do — the gates stay in
 * Hermes, and the store here only remembers what this window did.
 */
export class Approvals {
    readonly commands: PermissionCommands;

    /** Guards the red action's two writes: a second press must not be overtaken by the first. */
    private _token = 0;

    constructor(
        private readonly _host: ApprovalsHost,
        private readonly _control: ApprovalModeControl,
        private readonly _store: PermissionsStore,
    ) {
        this.commands = {
            setMode: mode => this.setMode(mode),
            request: () => this.post(true),
            openAccess: () => this.openAccess(),
            restoreDeny: () => this.restoreDeny(),
        };
    }

    /** The switch's state: the cache first, the CLI in the background, a second post if it moved. */
    post(force = false): void {
        const profile = this._host.profile();
        const cached = this._control.last(profile);
        this._say({ mode: cached, denyCount: this._control.lastDenyCount(profile) });
        void this._refresh(profile, cached, force);
    }

    private _say(extra: { mode?: ApprovalMode; denyCount?: number; denyBackup?: string; error?: string }, openAccess?: boolean): void {
        this._host.post({
            type: 'approvalMode',
            mode: extra.mode ?? this._control.last(this._host.profile()),
            denyCount: extra.denyCount ?? this._control.lastDenyCount(this._host.profile()),
            openAccess: openAccess ?? this._store.openAccess(),
            ...(extra.denyBackup ? { denyBackup: extra.denyBackup } : {}),
            ...(extra.error ? { error: extra.error } : {}),
        });
    }

    private async _refresh(profile: string, previous: ApprovalMode, force = false): Promise<void> {
        const executable = await this._host.executable();
        if (!executable) {
            return;
        }
        const mode = await this._control.read(executable, profile);
        const denyCount = await this._control.readDenyCount(executable, profile);
        if (force || mode !== previous) {
            this._say({ mode, denyCount });
        }
    }

    /** The switch was used: write it to the profile, and say so (or put the old value back). */
    async setMode(mode: unknown): Promise<void> {
        this._token += 1;
        if (!isSettableApprovalMode(mode)) {
            this._host.log(`Approval mode ignored: ${String(mode)}`);
            return;
        }
        const profile = this._host.profile();
        const previous = this._control.last(profile);
        const executable = await this._host.executable();
        if (!executable) {
            this._host.log('Approval mode not set: no Hermes executable found');
            this._say({ mode: previous, error: t('approvalModeFailed') });
            return;
        }
        if (await this._control.write(executable, profile, mode)) {
            // Any deliberate choice ends the ALL state, choosing None included.
            this._store.setOpenAccess(false);
            this._say({ mode }, false);
            this._host.log(`Approval mode set to ${mode} (profile=${profile})`);
            return;
        }
        this._host.log(`Approval mode write failed: ${mode} (profile=${profile})`);
        this._say({ mode: previous, error: t('approvalModeFailed') });
    }

    /**
     * The red action: save the deny list, clear it, then turn approvals off for the profile.
     *
     * Order matters — those patterns are the only copy — so a failed save stops everything, and the
     * mode write is skipped when a second press arrived meanwhile.
     */
    async openAccess(): Promise<void> {
        const token = ++this._token;
        const profile = this._host.profile();
        const executable = await this._host.executable();
        if (!executable) {
            this._host.log('Open access not set: no Hermes executable found');
            this._say({ error: t('approvalModeFailed') });
            return;
        }
        const patterns = await this._control.readDenyList(executable, profile);
        let backup: string | undefined;
        if (patterns.length > 0) {
            backup = this._store.saveDenyBackup(profile, patterns);
            if (!backup) {
                this._host.log('Open access: the deny list could not be saved, so nothing was cleared');
                this._say({ denyCount: patterns.length, error: t('approvalModeFailed') });
                return;
            }
            this._host.log(`Deny list saved before clearing: ${backup}`);
        }
        if (!await this._control.clearDeny(executable, profile)) {
            this._host.log(`Open access: clearing approvals.deny failed (profile=${profile})`);
            this._say({ denyBackup: backup, error: t('approvalModeFailed') });
            return;
        }
        if (token !== this._token) {
            // Stopped while clearing the deny list: do not turn approvals off behind the user.
            this._host.log(`Open access cancelled before the mode write (profile=${profile})`);
            this._store.setOpenAccess(false);
            this._say({ denyBackup: backup }, false);
            return;
        }
        const wrote = await this._control.write(executable, profile, 'off');
        this._store.setOpenAccess(wrote);
        this._host.log(`Open access: deny cleared, mode ${wrote ? 'set to off' : 'write failed'} (profile=${profile})`);
        this._say({ denyBackup: backup, ...(wrote ? {} : { error: t('approvalModeFailed') }) }, wrote);
    }

    /** Put the saved deny list back — the other half of the red action. */
    async restoreDeny(): Promise<void> {
        const profile = this._host.profile();
        const file = this._store.newestDenyBackup();
        const executable = await this._host.executable();
        if (!executable || !file) {
            this._host.log(`Deny restore skipped (executable=${!!executable}, backup=${file ?? 'none'})`);
            this._say({ error: t('approvalModeFailed') });
            return;
        }
        const patterns = this._store.readDenyBackup(file);
        const restored = await this._control.writeDenyList(executable, profile, patterns);
        this._store.setOpenAccess(false);
        this._host.log(`Deny restore: ${patterns.length} pattern(s) from ${file} — ${restored ? 'written' : 'failed'}`);
        this._say({ denyBackup: file, ...(restored ? {} : { error: t('approvalModeFailed') }) }, false);
    }
}
