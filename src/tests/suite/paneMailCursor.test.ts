import { describe, it } from 'mocha';
import assert from 'assert';
import { planDrain } from '../../host/chat/paneMail';
import { serializeEnvelope } from '../../shared/paneMail';
import type { PaneMailEnvelope } from '../../shared/paneMail';

let seq = 0;
const envelope = (toProfile: string, body = 'draft'): PaneMailEnvelope => ({
    id: `env-${++seq}`,
    writtenAt: 1,
    fromProfile: 'pa',
    fromHost: 'host',
    toProfile,
    body,
});

const log = (...envelopes: PaneMailEnvelope[]): string =>
    envelopes.map(item => serializeEnvelope(item) + '\n').join('');

/**
 * The inbox rule: the cursor stops at the first card this profile has not decided on, which is
 * what lets a reload draw the card again without any per-card file.
 */
describe('inbox drain plan', () => {
    const ME = 'dev-vsc';

    it('injects an undecided card and leaves the cursor on its line', () => {
        const first = envelope('pa');
        const mine = envelope(ME);
        const text = log(first, mine);
        const plan = planDrain(text, 0, ME, new Set());

        assert.deepStrictEqual(plan.open.map(item => item.id), [mine.id]);
        // Not past the card: the next drain has to see it again.
        assert.strictEqual(plan.cursor, text.indexOf(serializeEnvelope(mine)));
    });

    it('walks past mail for someone else', () => {
        const text = log(envelope('code-cleaner'), envelope('pa'));
        const plan = planDrain(text, 0, ME, new Set());

        assert.deepStrictEqual(plan.open, []);
        assert.strictEqual(plan.cursor, text.length);
    });

    it('walks past a decided card', () => {
        const mine = envelope(ME);
        const text = log(mine);
        const plan = planDrain(text, 0, ME, new Set([mine.id]));

        assert.deepStrictEqual(plan.open, []);
        assert.strictEqual(plan.cursor, text.length);
    });

    it('stops at the first open card even when a later one is decided', () => {
        const open = envelope(ME);
        const settled = envelope(ME);
        const text = log(open, settled);
        const plan = planDrain(text, 0, ME, new Set([settled.id]));

        assert.deepStrictEqual(plan.open.map(item => item.id), [open.id]);
        assert.strictEqual(plan.cursor, text.indexOf(serializeEnvelope(open)));
    });

    it('re-drains the same card after a "reload" — the cursor did not move past it', () => {
        const mine = envelope(ME);
        const text = log(mine, envelope('pa'));
        const first = planDrain(text, 0, ME, new Set());
        const again = planDrain(text, first.cursor, ME, new Set());

        assert.deepStrictEqual(again.open.map(item => item.id), [mine.id]);
    });

    it('deciding the last open card lets the cursor reach the end', () => {
        const mine = envelope(ME);
        const text = log(mine);
        const before = planDrain(text, 0, ME, new Set());
        const after = planDrain(text, before.cursor, ME, new Set([mine.id]));

        assert.deepStrictEqual(after.open, []);
        assert.strictEqual(after.cursor, text.length);
    });

    it('ignores a half-written last line and keeps the cursor before it', () => {
        const mine = envelope(ME);
        const complete = log(mine);
        const partial = serializeEnvelope(envelope(ME)).slice(0, 20);
        const plan = planDrain(complete + partial, complete.length, ME, new Set([mine.id]));

        assert.deepStrictEqual(plan.open, []);
        assert.strictEqual(plan.cursor, complete.length);
    });
});
