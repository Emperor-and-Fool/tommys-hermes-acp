import { t } from '../i18n';
import type { EditorChoiceItem, EditorChoices } from '../../shared/editor';

/**
 * How much memory an agent may keep: shown, chosen, then written by Hermes' own CLI.
 *
 * Hermes caps MEMORY.md at 2200 characters by default, and every character there is carried in
 * every session of that one agent. So the number is the user's to decide, with two facts in front of
 * them: what the file holds now, and what it is allowed to hold. Nothing here writes a Hermes file:
 * the limit is set by Hermes' own CLI (H1, H2a), through the port.
 */

/** What the dialog needs from outside: the numbers, the questions, and Hermes' answer. */
export interface MemorySizeHost {
    log(line: string): void;
    /** One line to the user, through the editor's own notifications. */
    info(message: string): void;
    choices: EditorChoices;
    /** The agent's name, what its MEMORY.md holds, and the limit it is under. */
    usage(sessionProfileId: string): { name: string; fill: number; limit: number };
    /** The one CLI call behind the dialog: what Hermes answered, failure included. */
    setLimit(sessionProfileId: string, limit: number): Promise<{ ok: boolean; message: string }>;
}

/** Hermes' own estimate: about 2.75 characters per token. */
const CHARS_PER_TOKEN = 2.75;

/** A count as a person reads it: 2210 → 2,210. Locale-free, so the dialog reads the same anywhere. */
export function countText(value: number): string {
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export class MemorySize {
    constructor(private readonly _host: MemorySizeHost) {}

    /**
     * The dialog: what the agent uses now, three answers, one confirmation, then Hermes' verdict.
     *
     * Dismissing any step applies nothing. The confirmation is not a formality — the number is
     * repeated in every session of that agent from the next one on, so the cost is said in tokens.
     */
    async run(sessionProfileId: string): Promise<void> {
        const usage = this._host.usage(sessionProfileId);
        if (!usage.name) {
            this._host.info(t('memorySizeNoAgent'));
            return;
        }
        const doubled = usage.fill * 2;
        const percent = usage.limit > 0 ? Math.round((usage.fill / usage.limit) * 100) : 0;
        const choices: EditorChoiceItem[] = [
            { id: 'double', label: t('memorySizeDouble', countText(doubled)), suggested: true },
            { id: 'keep', label: t('memorySizeKeep', countText(usage.fill)) },
            { id: 'other', label: t('memorySizeOther') },
        ];
        const title = t('memorySizeTitle', usage.name, countText(usage.fill), countText(usage.limit), percent);
        const picked = await this._host.choices.pick(title, choices);
        if (!picked) {
            return;
        }

        const limit = await this._limitFor(picked, usage, doubled);
        if (limit === undefined) {
            return;
        }
        if (limit === usage.limit) {
            this._host.info(t('memorySizeUnchanged', countText(limit), usage.name));
            return;
        }

        const added = Math.max(0, limit - usage.limit);
        const tokens = Math.round(added / CHARS_PER_TOKEN);
        const confirm = await this._host.choices.ask(
            t('memorySizeConfirm', countText(tokens), usage.name),
            [t('memorySizeApply'), t('memorySizeCancel')],
        );
        if (confirm !== t('memorySizeApply')) {
            return;
        }

        const result = await this._host.setLimit(sessionProfileId, limit);
        this._host.log(`Memory limit: hermes answered (${result.ok ? 'ok' : 'failed'}): ${result.message}`);
        this._host.info(result.ok
            ? t('memorySizeDone', countText(limit), usage.name, result.message)
            : t('memorySizeFailed', result.message));
    }

    /** The number the chosen row means: the double, the file as it is, or what the user typed. */
    private async _limitFor(
        picked: string,
        usage: { fill: number; limit: number },
        doubled: number,
    ): Promise<number | undefined> {
        if (picked === 'double') {
            return doubled;
        }
        if (picked === 'keep') {
            return usage.fill;
        }
        const typed = await this._host.choices.prompt(t('memorySizeInput', countText(usage.fill)), String(doubled));
        if (typed === undefined) {
            return undefined;
        }
        const value = Number(typed.trim().replace(/[,\s]/g, ''));
        if (!Number.isInteger(value) || value < usage.fill) {
            this._host.info(t('memorySizeInvalid', countText(usage.fill)));
            return undefined;
        }
        return value;
    }
}
