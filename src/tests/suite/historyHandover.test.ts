import { describe, it } from 'mocha';
import assert from 'assert';
import { handoverLines } from '../../shared/historyHandover';
import type { HistoryRef } from '../../shared/chat';

const ref = (over: Partial<HistoryRef> = {}): HistoryRef => ({
    sessionId: 'h-1',
    profile: 'pa',
    title: 'Secondant 01',
    count: 2,
    messageIds: [41, 42],
    from: 1000,
    to: 2000,
    ...over,
});

/**
 * One vocabulary for both routes: attach (same profile) and forward (a profile the reader does not
 * own). The Note is the only conditional line — a grant is a lie when there is no boundary.
 */
describe('history handover lines', () => {
    it('names the session, its span, and the call that reads more', () => {
        const lines = handoverLines(ref(), { readerProfile: 'dev-vsc' });

        assert.strictEqual(lines[0], 'Session: @session:pa/h-1');
        assert.ok(lines[1].startsWith('Span: 1970-01-01T00:00:01.000Z → '), lines[1]);
        assert.ok(lines.some(line => line.startsWith('Note: ')), 'cross-profile keeps the note');
        assert.ok(lines.some(line => line.includes('around_message_id')), 'and the hint');
    });

    it('drops the cross-profile note when the reader owns the slice', () => {
        const lines = handoverLines(ref({ profile: 'dev-vsc' }), { readerProfile: 'dev-vsc' });

        assert.ok(!lines.some(line => line.startsWith('Note: ')), 'same profile: no grant to state');
        assert.ok(lines.some(line => line.startsWith('Hint: ')), 'but still the hint');
    });

    it('falls back to the anchor when no id matched, in both directions', () => {
        const anchorRef = ref({ messageIds: [null, null], from: undefined, to: undefined, anchor: 'where is the context' });

        const forwarded = handoverLines(anchorRef, { readerProfile: 'dev-vsc' });
        const attached = handoverLines(anchorRef, { readerProfile: 'pa' });

        assert.ok(forwarded.includes('Anchor: "where is the context"'));
        assert.ok(forwarded.some(line => line.includes('search the transcript for "where is the context"')));
        assert.ok(attached.some(line => line.startsWith('Hint: ')), 'the attach path gets advice too now');
        assert.ok(!attached.some(line => line.startsWith('Note: ')));
    });

    it('uses the caller’s anchor when the ref has none', () => {
        const lines = handoverLines(ref({ messageIds: [null], from: undefined, to: undefined }), {
            readerProfile: 'pa',
            fallbackAnchor: 'opening words',
        });
        assert.ok(lines.includes('Anchor: "opening words"'));
    });

    it('falls back to the sender’s profile when the ref carries none', () => {
        const lines = handoverLines(ref({ profile: '' }), { readerProfile: 'dev-vsc', fallbackProfile: 'pa' });
        assert.strictEqual(lines[0], 'Session: @session:pa/h-1');
    });
});
