/**
 * Types shared across the chat surfaces.
 *
 * First residents: the rename hand-off. A tab's title belongs to Hermes, so the pane only
 * asks for a change and reports why one was refused — the webview, the provider and the
 * catalog rule all speak this contract, which is why it lives here rather than in one of them.
 */

/** What the webview posts when the user commits an inline tab title. */
export interface RenameSessionRequest {
    type: 'renameSession';
    sessionId: string;
    title: string;
}

/** Why a title write did not land. `refused` carries Hermes' own explanation in `message`. */
export type SessionTitleRefusal = 'empty' | 'too-long' | 'refused';

/** The result of asking Hermes to retitle a session: the name it now holds, or the refusal. */
export type SessionTitleOutcome =
    | { ok: true; title: string }
    | { ok: false; reason: SessionTitleRefusal; message?: string };
