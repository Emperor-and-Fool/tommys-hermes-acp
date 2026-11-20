import { t } from '../i18n';
import { isSettableApprovalMode } from './approvalModeRules';
import { resolvePermissionOptionLabel } from './permissionOptions';
import { ApprovalModeControl } from './approvalModeControl';
import type { PermissionsStore } from './store';
import type { ApprovalMode, HostToPane } from '../../shared/webview';
import type { LocaleStrings } from '../../shared/i18n';
import type { AcpClient } from '../acp/AcpClient';

/**
 * The edit mode a button implies. Hermes' own mode ids: `default` asks, `accept_edits` frees the
 * permission root and the temp dir, `dont_ask` frees everything but the sensitive paths it always
 * asks about — that exception is Hermes', not ours, and no button can turn it off.
 */
export function editModeFor(mode: ApprovalMode, danger: boolean): string {
    if (danger) {
        return 'dont_ask';
    }
    if (mode === 'manual') {
        return 'default';
    }
    if (mode === 'smart' || mode === 'off') {
        return 'accept_edits';
    }
    return '';
}

/** What the permissions feature needs from the rest of the extension. */
export interface ApprovalsHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    /** The CLI profile whose `config.yaml` holds `approvals.mode` and `approvals.deny`. */
    profile(): string;
    /** The Hermes CLI, when one is installed. */
    executable(): Promise<string | undefined>;
    /** The live client, when a session is open. */
    acp(): AcpClient | undefined;
    /** Whether a run is in flight: a mode change then applies to the next one. */
    activeSessionBusy(): boolean;
    /** Told when a run ends, so a deferred edit mode can be applied. */
    onRunEnded(handler: () => void): () => void;
    /** Told whenever Hermes reports a session's mode, including on a session just opened. */
    onSessionMode(handler: (mode: string) => void): () => void;
    /**
     * Hand an answer to the turn that asked for it.
     *
     * The answer belongs to the request, which the turn holds; the card is only where it was given.
     */
    respondToPermission(id: string, optionId: string | null): void;
    /** The option the pane showed for an answer, as the stored permission message kept it. */
    storedPermissionOption(id: string, optionId: string): { optionId: string; name?: string; kind?: string } | undefined;
    /** The strings the pane is showing: the label is the one it drew, not a second translation. */
    locale(): LocaleStrings;
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
    /** The answer to a permission card: the turn that asked for it takes it. */
    respond(id: string, optionId: string | null): void;
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

    /** An edit mode a run in flight refused: the Hermes session it is waiting for ('' = none). */
    private _pendingEdits = '';

    /**
     * What we last asked Hermes for, per session, until it reports a mode.
     *
     * The report is the truth (the client remembers what Hermes says, never what we asked), so this
     * is only a fence: two callers — the awaited one before a first prompt and the listener that
     * fires on `session/new` — must not turn one intent into two `set_mode` requests.
     */
    private _askedMode?: { sessionId: string; mode: string };

    /** The `set_mode` request in flight: a second caller waits for the same answer. */
    private _settingMode?: { sessionId: string; mode: string; promise: Promise<void> };

    constructor(
        private readonly _host: ApprovalsHost,
        private readonly _store: PermissionsStore,
        /**
         * The mode each profile reported, read back by the buttons.
         *
         * Built here unless a test hands in its own: it is this feature's memory of Hermes'
         * answer, and the composition root holds one permissions object, not two.
         */
        private readonly _control: ApprovalModeControl = new ApprovalModeControl(),
    ) {
        this.commands = {
            setMode: mode => this.setMode(mode),
            request: () => this.post(true),
            openAccess: () => this.openAccess(),
            restoreDeny: () => this.restoreDeny(),
            respond: (id, optionId) => this._host.respondToPermission(id, optionId),
        };
    }

    /**
     * Start listening: a run that ends applies a deferred edit mode, and a session that reports a
     * mode different from the button's is brought in line (Hermes starts every session on `default`).
     */
    start(): () => void {
        const unRun = this._host.onRunEnded(() => {
            if (!this._pendingEdits) {
                return;
            }
            // The mode belongs to that session: a run that ended on another tab is not its turn.
            if (this._host.acp()?.activeSessionId !== this._pendingEdits) {
                return;
            }
            // Not cleared here: applyEdits either sets the mode (and says the notice is over) or
            // finds itself refused again and keeps waiting.
            void this.applyEdits();
        });
        const unMode = this._host.onSessionMode(() => {
            // Hermes answered: what we asked for is settled, and whatever it reports is the truth.
            this._askedMode = undefined;
            void this.applyEdits();
        });
        return () => {
            unRun();
            unMode();
        };
    }

    /**
     * What an answer was called when the user pressed it.
     *
     * Read from the stored permission message and resolved through the pane's own strings, so the
     * transcript says the same words the card did.
     */
    optionLabel(id: string, optionId: string): string | undefined {
        const option = this._host.storedPermissionOption(id, optionId);
        return option ? resolvePermissionOptionLabel(this._host.locale(), option) : undefined;
    }

    /**
     * Another profile means another `approvals.mode`: forget what this one reported.
     *
     * Called by the composition root when the profile setting changes or the pane switches agent;
     * the forgetting is this feature's, so the caller only says that it happened.
     */
    onProfileChanged(): void {
        this._control.clear();
    }

    /** What the button implies, as an edit mode, for the session that is open. */
    private _desiredEditMode(): string {
        const profile = this._host.profile();
        return editModeFor(this._control.last(profile), this._store.openAccess());
    }

    /**
     * Make the loaded session's edit mode match the buttons.
     *
     * Idle only. A run in flight refuses the change, so the intent is remembered for that session
     * and applied when that run ends — never sent twice, and never retried in a loop.
     *
     * Callers race on purpose: `promptRunner` awaits this before a first prompt goes out, and the
     * session-mode listener fires on the very `session/new` that made the session. One intent must
     * become one `set_mode`, so a caller that matches the request in flight waits for it instead of
     * sending its own, and one that matches a request already answered waits for the report.
     */
    async applyEdits(): Promise<void> {
        const acp = this._host.acp();
        if (!acp || !acp.activeSessionId) {
            return;
        }
        let desired = this._desiredEditMode();
        if (!desired) {
            // Nothing is remembered for this profile. An agent switch clears it, and Hermes then
            // reports `default` on the session it opens, so a session would run Manual while the
            // row says None — silently, until something else happens to read the mode. The mode
            // lives in Hermes' own yaml: read it now, once, and let the row show what was applied.
            const profile = this._host.profile();
            await this._refresh(profile, this._control.last(profile), true);
            desired = this._desiredEditMode();
            if (!desired) {
                // Still unknown: say so rather than leave a session on a mode nobody chose.
                this._host.log(`Edit mode unknown for profile "${profile}" (session ${acp.activeSessionId}): nothing applied`);
                return;
            }
        }
        const sessionId = acp.activeSessionId;
        const inflight = this._settingMode;
        if (inflight && inflight.sessionId === sessionId && inflight.mode === desired) {
            await inflight.promise;
            return;
        }
        if (acp.currentSessionMode === desired) {
            this._askedMode = undefined;
            this._defer('');
            return;
        }
        if (this._askedMode?.sessionId === sessionId && this._askedMode.mode === desired) {
            // Asked, and the request came back; Hermes' report has not landed yet. Nothing to send:
            // the awaited caller needs the request's answer, and it has had it.
            return;
        }
        if (this._host.activeSessionBusy()) {
            this._defer(sessionId);
            this._host.log(`Edit mode ${desired} waits for the next run`);
            return;
        }
        const promise = this._sendMode(acp, sessionId, desired);
        this._settingMode = { sessionId, mode: desired, promise };
        try {
            await promise;
        } finally {
            if (this._settingMode?.promise === promise) {
                this._settingMode = undefined;
            }
        }
    }

    /** One request, and its two outcomes: the fence is set before it goes out, and dropped on failure. */
    private async _sendMode(acp: AcpClient, sessionId: string, desired: string): Promise<void> {
        this._askedMode = { sessionId, mode: desired };
        try {
            await acp.setSessionMode(desired);
            this._defer('');
            this._host.log(`Edit mode set to ${desired}`);
        } catch (err) {
            this._askedMode = undefined;
            this._defer(sessionId);
            this._host.log(`Edit mode ${desired} refused: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Record which session an edit mode is waiting for, and say it when that changes.
     *
     * The pane shows "Applies from the next run." only while that session is the one on screen, and
     * a blank chat — no Hermes session at all — never gets here, so it never shows it.
     */
    private _defer(sessionId: string): void {
        if (this._pendingEdits === sessionId) {
            return;
        }
        this._pendingEdits = sessionId;
        this._say({});
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
            // Derived, never passed: a deferred edit mode is the only reason to defer, and
            // `_pendingEdits` is its one owner. Its session travels with it, so the pane can keep
            // the notice to the tab it is about.
            ...(this._pendingEdits
                ? { notice: 'appliesNextRun' as const, noticeSessionId: this._pendingEdits }
                : {}),
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
            await this.applyEdits();
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
        await this.applyEdits();
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
        await this.applyEdits();
    }
}
