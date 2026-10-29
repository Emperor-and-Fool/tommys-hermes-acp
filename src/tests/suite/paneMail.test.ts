import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PaneMailInbox, PaneMailOutbox, newEnvelope, paneMailPaths } from '../../host/chat/paneMail';
import { parseEnvelope, serializeEnvelope } from '../../shared/paneMail';
import { peerStateAfter } from '../../shared/chat';
import { buildReplayMessages } from '../../host/cache/replay';
import type { PaneMailEnvelope } from '../../shared/paneMail';

/** The only Memento surface the inbox touches. */
class FakeState {
    private _values = new Map<string, unknown>();
    get<T>(key: string): T | undefined {
        return this._values.get(key) as T | undefined;
    }
    async update(key: string, value: unknown): Promise<void> {
        this._values.set(key, value);
    }
}

describe('pane mail', () => {
    let home: string;
    let received: PaneMailEnvelope[];
    let profile: string;
    let state: FakeState;

    const host = () => ({
        profile: () => profile,
        onPeer: (envelope: PaneMailEnvelope) => received.push(envelope),
        setOtherPaneLive: () => undefined,
        state: state as unknown as never,
        log: () => undefined,
    });

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'panemail-'));
        process.env.HERMES_HOME = home;
        received = [];
        profile = 'dev-vsc';
        state = new FakeState();
        fs.mkdirSync(paneMailPaths().dir, { recursive: true });
        fs.writeFileSync(paneMailPaths().log, '');
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
        delete process.env.HERMES_HOME;
    });

    it('hands a new envelope over as a peer, and moves the cursor past it', () => {
        const outbox = new PaneMailOutbox(host() as never);
        assert.ok(
            outbox.send(
                newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'hello', sourceMessageId: 'm1' })
            )
        );

        const inbox = new PaneMailInbox(host() as never);
        assert.strictEqual(inbox.drain(), 1);
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].fromProfile, 'pa');
        assert.strictEqual(received[0].toProfile, 'dev-vsc');
        assert.strictEqual(received[0].body, 'hello');
        assert.strictEqual(received[0].sourceMessageId, 'm1');

        // Second read: nothing new, and the cursor survives on the state object.
        assert.strictEqual(inbox.drain(), 0);
        assert.strictEqual(received.length, 1);
    });

    it('hands an envelope id over once even when the line is written twice', () => {
        const envelope = newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'twice' });
        const line = serializeEnvelope(envelope);
        fs.appendFileSync(paneMailPaths().log, line + line, 'utf8');

        const inbox = new PaneMailInbox(host() as never);
        assert.strictEqual(inbox.drain(), 1);
        assert.strictEqual(received.length, 1);
    });

    it('ignores what is addressed elsewhere, and still consumes it', () => {
        const outbox = new PaneMailOutbox(host() as never);
        outbox.send(newEnvelope({ fromProfile: 'pa', toProfile: 'someone-else', body: 'not mine' }));
        outbox.send(newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'mine' }));

        const inbox = new PaneMailInbox(host() as never);
        assert.strictEqual(inbox.drain(), 1);
        assert.deepStrictEqual(received.map(envelope => envelope.body), ['mine']);
        assert.strictEqual(inbox.drain(), 0);
    });

    it('a card comes back after a reload until it is decided', () => {
        const outbox = new PaneMailOutbox(host() as never);
        const envelope = newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'still open' });
        outbox.send(envelope);

        const first = new PaneMailInbox(host() as never);
        assert.strictEqual(first.drain(), 1);

        // A reload is a fresh instance over the same state. The cursor stopped at the card, so
        // it is drawn again — that is the whole point: nothing was written off on the way in.
        const second = new PaneMailInbox(host() as never);
        assert.strictEqual(second.drain(), 1);
        assert.strictEqual(received.length, 2);

        // Only a decision retires it.
        second.acknowledge(envelope.id);
        const third = new PaneMailInbox(host() as never);
        assert.strictEqual(third.drain(), 0);
        assert.strictEqual(received.length, 2);
    });

    it('leaves a half-written line unread until it is complete', () => {
        const envelope = newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'split' });
        const line = JSON.stringify(envelope);
        fs.appendFileSync(paneMailPaths().log, line.slice(0, 20), 'utf8');

        const inbox = new PaneMailInbox(host() as never);
        assert.strictEqual(inbox.drain(), 0);
        assert.strictEqual(received.length, 0);

        fs.appendFileSync(paneMailPaths().log, line.slice(20) + '\n', 'utf8');
        assert.strictEqual(inbox.drain(), 1);
        assert.strictEqual(received.length, 1);
    });

    it('keeps the cursor in bytes: multi-byte text does not push later lines out of reach', () => {
        // →, —, ‘ and … are two or three bytes each. A character-position cursor overshoots by
        // exactly that many and silently swallows everything appended afterwards.
        const outbox = new PaneMailOutbox(host() as never);
        outbox.send(
            newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'a → b — c ‘d’ … e' })
        );

        const inbox = new PaneMailInbox(host() as never);
        assert.strictEqual(inbox.drain(), 1);

        outbox.send(newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'after the wide text' }));
        assert.strictEqual(inbox.drain(), 1, 'the second envelope must still be reachable');
        assert.deepStrictEqual(
            received.map(envelope => envelope.body),
            ['a → b — c ‘d’ … e', 'after the wide text']
        );
    });

    it('survives a rolled log: an envelope already taken is not taken again after a reload', () => {
        const outbox = new PaneMailOutbox(host() as never);
        const envelope = newEnvelope({ fromProfile: 'pa', toProfile: 'dev-vsc', body: 'played twice' });
        outbox.send(envelope);

        const before = new PaneMailInbox(host() as never);
        assert.strictEqual(before.drain(), 1);
        before.acknowledge(envelope.id);

        // A roll replays the same bytes and the cursor starts over; the decided id is what stops
        // the moderator seeing a card she already answered a second time.
        fs.writeFileSync(paneMailPaths().log, '');
        outbox.send(envelope);

        const after = new PaneMailInbox(host() as never);
        assert.strictEqual(after.drain(), 0);
        assert.strictEqual(received.length, 1);
    });

    it('rejects lines that are not envelopes', () => {
        assert.strictEqual(parseEnvelope('not json'), null);
        assert.strictEqual(parseEnvelope('{"id":"x"}'), null);
        assert.strictEqual(parseEnvelope(''), null);
    });

    it('carries a session-memory ref through the log, and drops one that cannot be rendered', () => {
        const ref = {
            sessionId: 'h-1',
            profile: 'pa',
            title: 'Secondant 01',
            count: 2,
            messageIds: [null, 7] as Array<number | null>,
            from: 1000,
            to: 2000,
        };
        const line = serializeEnvelope({
            id: 'e1', writtenAt: 1, fromProfile: 'pa', fromHost: 'h', toProfile: 'dev-vsc',
            body: 'x', history: ref,
        });
        assert.deepStrictEqual(parseEnvelope(line)?.history, { ...ref, anchor: undefined });

        const broken = JSON.parse(line);
        broken.history = { title: 'no session id' };
        assert.strictEqual(parseEnvelope(JSON.stringify(broken))?.history, undefined, 'a ref without an id is not a ref');
    });
});

describe('peer card state', () => {
    it('delivers or dismisses a pending card', () => {
        assert.strictEqual(peerStateAfter('pending', 'deliver'), 'delivered');
        assert.strictEqual(peerStateAfter('pending', 'dismiss'), 'dismissed');
    });

    it('keeps the first decision: a settled card does not move again', () => {
        assert.strictEqual(peerStateAfter('delivered', 'dismiss'), 'delivered');
        assert.strictEqual(peerStateAfter('dismissed', 'deliver'), 'dismissed');
    });
});

describe('peer cards never reach the agent twice', () => {
    it('drops a pending peer from the replay', () => {
        const messages = buildReplayMessages([{ role: 'peer', text: 'a forwarded draft, still waiting' }]);
        assert.deepStrictEqual(messages, []);
    });

    it('drops a delivered peer too: the user turn already carries it', () => {
        const messages = buildReplayMessages([
            { role: 'peer', text: '[forwarded from pa@host] body' },
            { role: 'user', text: '[forwarded from pa@host] body' },
        ]);
        assert.strictEqual(messages.length, 1);
        assert.strictEqual(messages[0].role, 'user');
    });
});
