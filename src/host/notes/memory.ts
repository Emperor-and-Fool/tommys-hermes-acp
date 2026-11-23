import { t } from '../i18n';
import { DEFAULT_MEMORY_LIMIT } from '../environment/profileMemory';
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

/**
 * The one figure the dialog suggests: twice Hermes' default, fixed.
 *
 * Fixed, not "twice what this agent has": a suggestion that moves with the file would offer the
 * current limit back as soon as the user took it. Twice the default (2 × 2200) is the room a
 * working agent needs, and it is only offered while the agent is under it.
 */
export const RECOMMENDED_MEMORY_LIMIT = DEFAULT_MEMORY_LIMIT * 2;

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
        const percent = usage.limit > 0 ? Math.round((usage.fill / usage.limit) * 100) : 0;
        const choices: EditorChoiceItem[] = [];
        if (usage.limit < RECOMMENDED_MEMORY_LIMIT) {
            choices.push({
                id: 'recommended',
                label: t('memorySizeRecommended', countText(RECOMMENDED_MEMORY_LIMIT)),
                suggested: true,
            });
        }
        // "Keep" is the limit already in force: choosing it is how a look becomes no write at all.
        choices.push({ id: 'keep', label: t('memorySizeKeep', countText(usage.limit)) });
        choices.push({ id: 'other', label: t('memorySizeOther') });
        const title = t('memorySizeTitle', usage.name, countText(usage.fill), countText(usage.limit), percent);
        const picked = await this._host.choices.pick(title, choices);
        if (!picked) {
            return;
        }

        const limit = await this._limitFor(picked, usage);
        if (limit === undefined) {
            return;
        }
        if (limit === usage.limit) {
            this._host.info(t('memorySizeUnchanged', countText(limit), usage.name));
            return;
        }

        // The cost is the change of the limit, in either direction: what every session carries.
        const change = limit - usage.limit;
        const tokens = Math.round(Math.abs(change) / CHARS_PER_TOKEN);
        const confirm = await this._host.choices.ask(
            change > 0
                ? t('memorySizeConfirmAdd', countText(tokens), usage.name)
                : t('memorySizeConfirmFewer', countText(tokens), usage.name),
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

    /**
     * The number the chosen row means, or undefined when the user asked for nothing.
     *
     * "Keep" is the limit already in force, so it answers nothing at all — a dialog that only looks
     * writes nothing. A typed number may go up or down, but never below what the file holds, and a
     * lowering is asked about once more on its own, because it can cost the agent room it needs.
     */
    private async _limitFor(
        picked: string,
        usage: { fill: number; limit: number },
    ): Promise<number | undefined> {
        if (picked === 'recommended') {
            return RECOMMENDED_MEMORY_LIMIT;
        }
        if (picked === 'keep') {
            return undefined;
        }
        const typed = await this._host.choices.prompt(
            t('memorySizeInput', countText(usage.fill)),
            String(Math.max(usage.limit, usage.fill)),
        );
        if (typed === undefined) {
            return undefined;
        }
        const value = Number(typed.trim().replace(/[,\s]/g, ''));
        if (!Number.isInteger(value) || value < usage.fill) {
            this._host.info(t('memorySizeInvalid', countText(usage.fill)));
            return undefined;
        }
        if (value < usage.limit) {
            const lower = await this._host.choices.ask(
                t('memorySizeLower', countText(usage.limit), countText(value)),
                [t('memorySizeLowerConfirm'), t('memorySizeCancel')],
            );
            if (lower !== t('memorySizeLowerConfirm')) {
                return undefined;
            }
        }
        return value;
    }
}
