/**
 * The one notice a window gets when Hermes does not answer the session catalog.
 *
 * A failing catalog is not an empty one. Without the patch, Hermes either raises an error or
 * answers nothing at all, and a connect used to carry on as if the profile had no sessions: tabs
 * left unbound, nothing to reopen, and nothing on screen connecting the two. The notice names the
 * patch the installed Hermes needs and the folder holding it, because that is the fix.
 *
 * Once per connect, not once per read: every refresh reads the catalog again, and a notice per call
 * would be the same sentence on a loop.
 */
import type { EditorChoices } from '../../shared/editor';
import { patchSetFor } from '../environment/hermesPatches';
import { t } from '../i18n';

/** What the notice needs: the connection, the editor's notifications, and the patch folder. */
export interface CatalogNoticeHost {
    /** The Hermes agent's own version, from its initialize answer; '' before it has said. */
    hermesVersion(): string;
    /** The installed copy's patch folder, opened in the OS file manager on request. */
    patchFolder(): string;
    /** One line to the user, through the editor's own notifications. */
    info(message: string): void;
    /** Bring the checkout to the set this Hermes needs, after the user asks for it. */
    patch(): Promise<void>;
    choices: EditorChoices;
    log(line: string): void;
}

/** What the lifecycle may tell the notice: a connect began, or the catalog went unanswered. */
export interface CatalogVoice {
    /** A connect begins: the window may be told once more. */
    beginConnect(): void;
    /** The catalog went unanswered; `reason` is what Hermes said, or why there was no answer. */
    failed(reason: string): Promise<void>;
}

export class CatalogNotice implements CatalogVoice {
    private _told = false;

    constructor(private readonly _host: CatalogNoticeHost) {}

    /**
     * A connect begins. The failure belongs to the installed Hermes, not to the moment, so it is
     * worth saying again after a restart or a profile switch — and only once for each of them.
     */
    beginConnect(): void {
        this._told = false;
    }

    /**
     * The catalog went unanswered. `reason` is what Hermes answered, or why there was no answer.
     *
     * The log line is written even when the notice was already shown, so a refresh that keeps
     * failing still leaves a trace; the notice itself is the once-per-connect part.
     */
    async failed(reason: string): Promise<void> {
        const version = this._host.hermesVersion();
        const set = patchSetFor(version);
        const line = `session/catalog unanswered (Hermes ${version || 'version not reported'}): ${reason}`;
        this._host.log(line);
        if (this._told) {
            return;
        }
        this._told = true;
        const openFolder = t('catalogOpenPatchFolder');
        const details = t('catalogDetails');
        const patchButton = t('patchButton');
        const answer = await this._host.choices.ask(
            set
                ? t('catalogNeedsPatch', version, set.label)
                : t('catalogNoPatchKnown', version || 'unknown'),
            set ? [patchButton, openFolder, details] : [openFolder, details],
        );
        if (answer === patchButton) {
            await this._host.patch();
        } else if (answer === openFolder) {
            await this._host.choices.showInFileManager(this._host.patchFolder());
        } else if (answer === details) {
            this._host.info(t('catalogDetailsBody', reason, line, set ? set.files.join(', ') : t('catalogNoFiles')));
        }
    }
}
