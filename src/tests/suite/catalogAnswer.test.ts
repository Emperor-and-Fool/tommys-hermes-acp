/**
 * The client's own reading of `_session/catalog`, not a fake one level up.
 *
 * 7a3c51a made the answer explicit but returned the bare row list on success; the caller then read
 * `answered` off an array, found nothing, and called a working catalog "unanswered" (Linux, Hermes
 * 0.22.6 with 0001+0002, 2026-11-24). The lifecycle tests fake this function, so they could not see
 * it: this one drives the real method against a fake connection.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import { AcpClient } from '../../host/acp/AcpClient';

function clientAnswering(reply: unknown): AcpClient {
    const client = new AcpClient(() => undefined, () => undefined, async () => null as any);
    (client as any)._conn = { agent: { request: async () => reply } };
    return client;
}

describe('the session catalog answer, read by the client itself', () => {
    it('an answer with rows is answered, with the rows', async () => {
        const answer = await clientAnswering({
            sessions: [
                { session_id: 'a', title: 'One', cwd: '/x', hidden: true, message_count: 3, updated_at: 10 },
                { session_id: '', title: 'no id' },
            ],
        }).listSessionCatalog();
        assert.strictEqual(answer.answered, true);
        assert.ok(answer.answered && answer.sessions.length === 1);
        assert.deepStrictEqual(answer.answered && answer.sessions[0], {
            sessionId: 'a', title: 'One', cwd: '/x', hidden: true, messageCount: 3, updatedAt: 10_000,
        });
    });

    it('an empty list is answered and empty, not unanswered', async () => {
        const answer = await clientAnswering({ sessions: [] }).listSessionCatalog();
        assert.deepStrictEqual(answer, { answered: true, sessions: [] });
    });

    it('no catalog in the reply is unanswered, with a reason', async () => {
        const answer = await clientAnswering(null).listSessionCatalog();
        assert.strictEqual(answer.answered, false);
        assert.ok(!answer.answered && typeof answer.reason === 'string' && answer.reason.length > 0);
    });
});
