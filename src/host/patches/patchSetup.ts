/**
 * The ACP patch, kept to the set the installed Hermes needs — said at the moments it changes.
 *
 * Two answers to `hermes update`'s "Restore local changes?" both end in no sessions when the version
 * jumps a minor: keep brings the old set back on the new code, decline leaves no catalog methods at
 * all. The window cannot know which the user chose, but it can read the checkout: `patchState` says
 * ok / missing / wrong / unknown, and this class is what says it out loud and, only on a click, fixes
 * it.
 *
 * Nothing here runs on a timer and nothing writes unless the user pressed Patch. The version is stored
 * per checkout, so the dialog appears when Hermes was updated — not on every connect.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { EditorChoices } from '../../shared/editor';
import { t } from '../i18n';
import { patchSetFor } from '../environment/hermesPatches';
import { fixPatchState, GitRunner, PatchState, readPatchState } from '../environment/patchState';
import { patchVersionPathFor } from '../store/paths';

/** The last Hermes version seen in one checkout: our own file, never Hermes'. */
export interface PatchVersionStore {
    read(): { checkout: string; version: string } | undefined;
    write(checkout: string, version: string): void;
}

/**
 * The store, as one small JSON file in the data home.
 *
 * A read that fails is "nothing stored": the check runs and, at worst, says something it could have
 * waited to say. A write that fails is logged by the caller's own log, not thrown.
 */
export function createPatchVersionStore(historyDir: () => string): PatchVersionStore {
    const file = (): string => patchVersionPathFor(historyDir());
    return {
        read: () => {
            try {
                const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as {
                    checkout?: unknown;
                    version?: unknown;
                };
                if (typeof parsed.checkout === 'string' && typeof parsed.version === 'string') {
                    return { checkout: parsed.checkout, version: parsed.version };
                }
            } catch {
                // No file, or one we do not understand: nothing remembered.
            }
            return undefined;
        },
        write: (checkout, version) => {
            try {
                const target = file();
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, JSON.stringify({ checkout, version, at: Date.now() }, null, 2));
            } catch {
                // Remembering is a convenience; failing to remember must not fail the connect.
            }
        },
    };
}

/** What the setup needs from the window: where the checkout is, and how to say things. */
export interface PatchSetupHost {
    /** The Hermes source checkout the CLI runs from. */
    checkout(): string;
    /** This extension's own patch folder. */
    patchDir(): string;
    /** The agent's version, from its initialize answer; '' before it has said. */
    hermesVersion(): string;
    run: GitRunner;
    log(line: string): void;
    store: PatchVersionStore;
    choices: EditorChoices;
    /** Start the panes again, so they load the patched code. */
    reconnect(): Promise<void>;
}

export class PatchSetup {
    /** One dialog at a time: two windows and a refresh must not stack them. */
    private _busy = false;

    constructor(private readonly _host: PatchSetupHost) {}

    /**
     * Called when a connect begins.
     *
     * Same version as last time → nothing. A different version → the "Hermes was updated" dialog,
     * whose [Test patch] runs the same read the catalog notice's [Patch] does. First start → the
     * read runs, and the dialog appears only when it is not ok.
     */
    async onConnect(): Promise<void> {
        const version = this._host.hermesVersion();
        if (!version) {
            return;
        }
        const checkout = this._host.checkout();
        const seen = this._host.store.read();
        const firstStart = !seen || seen.checkout !== checkout;
        if (!firstStart && seen.version === version) {
            return;
        }
        if (this._busy) {
            return;
        }
        this._busy = true;
        try {
            const state = await this._inspect(version);
            this._host.store.write(checkout, version);
            if (state.kind === 'ok') {
                if (!firstStart) {
                    this._host.log(`patch: ok (${state.label}) after the update to ${version}`);
                }
                return;
            }
            if (firstStart) {
                await this._showState(state);
                return;
            }
            await this._afterUpdate(seen.version, version, state);
        } finally {
            this._busy = false;
        }
    }

    /** The catalog notice's [Patch]: read, then say what was found and offer the fix. */
    async promptCatalog(): Promise<void> {
        const version = this._host.hermesVersion();
        if (!version) {
            this._host.log('patch: no version from Hermes yet; nothing read');
            return;
        }
        await this._showState(await this._inspect(version));
    }

    private async _inspect(version: string): Promise<PatchState> {
        const state = await readPatchState({
            checkout: this._host.checkout(),
            patchDir: this._host.patchDir(),
            version,
            run: this._host.run,
        });
        this._host.log(`patch state for Hermes ${version}: ${state.kind}` +
            (state.kind === 'unknown' ? ` — ${state.reason}` : ''));
        return state;
    }

    private async _afterUpdate(from: string, to: string, state: PatchState): Promise<void> {
        const answer = await this._host.choices.modal(
            t('patchUpdatedTitle', from, to),
            [t('patchTestButton'), t('patchNotNow')],
            t('patchUpdatedBody'),
        );
        if (answer === t('patchTestButton')) {
            await this._showState(state);
        }
    }

    private async _showState(state: PatchState): Promise<void> {
        if (state.kind === 'ok') {
            await this._host.choices.modal(t('patchOkTitle', state.label), [t('patchOkButton')]);
            return;
        }
        if (state.kind === 'unknown') {
            this._host.log(`patch: unknown — ${state.reason}`);
            const details = await this._host.choices.modal(
                t('patchUnknownTitle'),
                [t('patchDetailsButton'), t('patchOkButton')],
                state.reason,
            );
            if (details === t('patchDetailsButton')) {
                await this._host.choices.modal(t('patchManualSteps'), [t('patchOkButton')]);
            }
            return;
        }
        const message = state.kind === 'missing'
            ? t('patchMissingTitle', state.version, state.label)
            : t('patchWrongTitle', state.present.join(' + '), state.version, state.label);
        const answer = await this._host.choices.modal(message, [t('patchButton'), t('patchNotNow')]);
        if (answer === t('patchButton')) {
            await this._fix(state);
        }
    }

    /** The one place that writes: reverse what is wrong, apply what is missing, then read again. */
    private async _fix(state: PatchState): Promise<void> {
        if (state.kind !== 'missing' && state.kind !== 'wrong') {
            return;
        }
        const result = await fixPatchState({
            checkout: this._host.checkout(),
            patchDir: this._host.patchDir(),
            state,
            run: this._host.run,
        });
        for (const line of result.log) {
            this._host.log(line);
        }
        const after = await this._inspect(state.version);
        if (after.kind === 'ok') {
            const answer = await this._host.choices.modal(
                t('patchAppliedTitle', after.label),
                [t('patchReconnectButton'), t('patchOkButton')],
                t('patchAppliedBody'),
            );
            if (answer === t('patchReconnectButton')) {
                await this._host.reconnect();
            }
            return;
        }
        await this._host.choices.modal(
            t('patchFailedTitle', state.label, after.kind === 'unknown' ? after.reason : after.kind),
            [t('patchDetailsButton'), t('patchOkButton')],
            t('patchManualSteps'),
        );
    }
}

/** The notice's label for a version, or '' — used by callers that only need to name the set. */
export function patchLabelFor(version: string): string {
    return patchSetFor(version)?.label ?? '';
}
