import * as assert from 'assert';
import { PEER_TURN_SEPARATOR, peerTurnBlock, peerTurnText } from '../../host/chat/peerTurn';

const item = (over: Partial<Parameters<typeof peerTurnBlock>[0]> = {}) => ({
    fromProfile: 'pa',
    fromHost: 'HGSjopTop9L',
    body: 'look at this',
    ...over,
});

describe('peer turn text', () => {
    it('opens with who forwarded it, then the body unchanged', () => {
        assert.strictEqual(
            peerTurnBlock(item()),
            '[forwarded from pa@HGSjopTop9L]\n\nlook at this'
        );
    });

    it('carries the session handle and span of a session-memory pick', () => {
        const turn = peerTurnBlock(item({
            body: 'a slice',
            history: {
                sessionId: 'h-1',
                profile: 'pa',
                title: 'Secondant 01',
                count: 3,
                messageIds: [1, 2, 3],
                from: Date.UTC(2026, 9, 21, 13, 0, 0),
                to: Date.UTC(2026, 9, 21, 13, 5, 0),
            },
        }));
        assert.ok(turn.includes('Session: @session:pa/h-1'));
        assert.ok(turn.includes('2026-10-21T13:00:00.000Z → 2026-10-21T13:05:00.000Z'));
        assert.ok(turn.endsWith('a slice'));
    });

    it('falls back to the anchor when no message id matched, and to the sender profile when the ref has none', () => {
        const turn = peerTurnBlock(item({
            history: {
                sessionId: 'h-2',
                profile: '',
                title: 'x',
                count: 1,
                messageIds: [null],
                anchor: 'where is the context',
            },
        }));
        assert.ok(turn.includes('Session: @session:pa/h-2'), 'the sender profile stands in');
        assert.ok(turn.includes('Anchor: "where is the context"'));
    });

    it('tells the receiving agent what the handle is for, and how to read more', () => {
        const withIds = peerTurnBlock(item({
            history: {
                sessionId: 'h-3', profile: 'dev-vsc', title: 't', count: 1,
                messageIds: [null, 41], anchor: 'x',
            },
        }));
        assert.ok(withIds.includes('Note: this session handle reads outside your profile'));
        assert.ok(withIds.includes('around_message_id'), 'the hint names the call that scrolls');
        assert.ok(withIds.includes('@session:dev-vsc/h-3'), 'and the handle it should pass');

        const anchorOnly = peerTurnBlock(item({
            history: {
                sessionId: 'h-4', profile: 'dev-vsc', title: 't', count: 1,
                messageIds: [null], anchor: 'where is the context',
            },
        }));
        assert.ok(anchorOnly.includes('search the transcript for "where is the context"'));
        assert.strictEqual(anchorOnly.includes('around_message_id'), false, 'no ids, no scroll hint');
    });

    it('says nothing about a session for an ordinary forward', () => {
        assert.strictEqual(peerTurnBlock(item()).includes('Session:'), false);
    });

    it('joins a stack into one turn, in arrival order, with a rule between items', () => {
        const turn = peerTurnText([item({ body: 'one' }), item({ body: 'two', fromProfile: 'dev-vsc' })]);
        assert.strictEqual(
            turn,
            '[forwarded from pa@HGSjopTop9L]\n\none' +
                PEER_TURN_SEPARATOR +
                '[forwarded from dev-vsc@HGSjopTop9L]\n\ntwo'
        );
        assert.strictEqual(turn.indexOf('one') < turn.indexOf('two'), true);
    });
});
