import type { EditorChoices, EditorNotices, EditorProgress } from '../../shared/editor';
import type { DesktopAttempt, DesktopStore } from './store';
import type { DesktopBuildResult, DesktopPresence } from '../environment/desktopBuild';
import { t } from '../i18n';

/**
 * Hermes Desktop, prepared once per machine if it is missing (H2a's named setup step).
 *
 * A CLI install has no Desktop until someone builds it, and the user of this extension never runs a
 * terminal to find that out. So: the first window that starts, on a source checkout with no build,
 * runs Hermes' own build command once and shows it as one notification. Everything else is a
 * refusal to build again:
 *
 * - a build that is there means nothing happens, ever (the artifact is the test);
 * - the secondant leaves the machine to the primary, and a lock in the data home stops two windows
 *   from building at the same time;
 * - a failure is remembered with its time, and is not retried automatically for 24 hours — only by a
 *   click on "Try again", or on a start after those 24 hours. Never a loop.
 */

/** A failure older than this is tried again on the next start. Inside it, only by a click. */
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** What the setup needs: the machine's answer, the CLI, and the editor's three ways of speaking. */
export interface DesktopHost {
    /** Only the primary prepares the machine: this is one Desktop per machine, not per window. */
    isPrimary(): boolean;
    /** What is on disk right now, read from the checkout. */
    presence(): Promise<DesktopPresence>;
    /** Hermes' own build, run unattended; the lines arrive as the notification's phase. */
    build(report: (phase: string) => void): Promise<DesktopBuildResult>;
    progress: EditorProgress;
    notices: EditorNotices;
    choices: EditorChoices;
    log(line: string): void;
    now(): number;
}

export class DesktopSetup {
    constructor(private readonly _store: DesktopStore, private readonly _host: DesktopHost) {}

    /**
     * The whole step, once per window start. Never throws and never blocks the caller: a window
     * that cannot prepare Desktop still chats.
     */
    async start(): Promise<void> {
        try {
            await this._start();
        } catch (error) {
            this._host.log(`Desktop setup stopped: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _start(): Promise<void> {
        if (!this._host.isPrimary()) {
            this._host.log('Desktop setup: the secondant leaves the machine\'s Desktop to the primary');
            return;
        }
        const presence = await this._host.presence();
        if (!presence.source) {
            this._host.log('Desktop setup: Hermes is not a source checkout, so its Desktop is its own');
            return;
        }
        if (presence.build) {
            this._host.log(`Desktop setup: a build is already there (${presence.build})`);
            return;
        }
        this._host.log(`Desktop setup: no build in ${presence.checkout}; stamp ${presence.stamp ? 'present' : 'absent'}`);
        const last = this._store.read();
        if (last && !last.ok && this._host.now() - last.at < RETRY_AFTER_MS) {
            this._host.log(
                `Desktop setup: the last build failed at ${new Date(last.at).toISOString()}; ` +
                'not rebuilding before the 24 h retry',
            );
            await this._offer(last.failure ?? last.build ?? '');
            return;
        }
        await this._build();
    }

    /** One attempt under the lock and the notification, then the failure notice outside both. */
    private async _build(): Promise<void> {
        const failure = await this._attempt();
        if (failure !== null) {
            await this._offer(failure);
        }
    }

    private async _attempt(): Promise<string | null> {
        const at = this._host.now();
        if (!this._store.lock(at)) {
            this._host.log('Desktop setup: another window is building it; this one leaves it alone');
            return null;
        }
        let failure: string | null = null;
        try {
            await this._host.progress.run(t('desktopPreparing'), async report => {
                const result = await this._host.build(line => {
                    // Every line as it arrives: the notification shows the phase, the log keeps them
                    // all, so a build that takes minutes leaves a trace even while it is running.
                    this._host.log(line);
                    report(line);
                });
                const attempt: DesktopAttempt = {
                    at: this._host.now(),
                    ok: result.ok,
                    build: result.build ?? undefined,
                    failure: result.ok ? undefined : this._failureText(result),
                };
                this._store.write(attempt);
                if (result.ok) {
                    this._host.log(`Desktop build finished: ${result.build}`);
                    this._host.notices.info(t('desktopReady', result.build ?? ''));
                    return;
                }
                this._host.log(`Desktop build did not finish: ${attempt.failure}`);
                failure = attempt.failure ?? result.message;
            });
        } finally {
            this._store.unlock();
        }
        return failure;
    }

    /** Hermes' own last word plus the tail: the part a user can act on, in one string. */
    private _failureText(result: DesktopBuildResult): string {
        const lines = [result.message, ...result.tail.slice(-8)].filter(Boolean);
        return lines.join('\n');
    }

    /** The failure notice: what it said, and the one way to try now. */
    private async _offer(failure: string): Promise<void> {
        const again = t('desktopTryAgain');
        const details = t('desktopDetails');
        const answer = await this._host.choices.ask(t('desktopFailed'), [again, details]);
        if (answer === again) {
            await this._build();
        } else if (answer === details) {
            this._host.notices.info(t('desktopFailedBody', failure));
        }
    }
}
