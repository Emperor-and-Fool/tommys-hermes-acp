import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/cache/sessions';
import { PendingUserStore } from '../../host/cache/pendingUsers';
import { PendingPeerStore } from '../../host/cache/pendingPeers';

/**
 * Two sidecars, one class of bug: state the pane must not lose, written where the state is
 * created rather than where it is painted.
 */
describe('sessions: the two sidecars', () => {
    let dir: string;
    let session: Sessions;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-sidecar-'));
        session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
        });
        session.activeId = 'tab-a';
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('a send writes the pending-user sidecar', () => {
        session.saveOutgoingUser('did you get this?');
        assert.deepStrictEqual(
            new PendingUserStore(dir).read('tab-a').map(user => user.text),
            ['did you get this?'],
        );
    });

    it('a replayed user row does not write it', () => {
        // The replay echoes the user's own turns back through the same save path; treating
        // those as sends would fill the sidecar with messages Hermes plainly already has.
        session.saveMessage('user', 'an older turn from the replay');
        assert.deepStrictEqual(new PendingUserStore(dir).read('tab-a'), []);
    });

    it('a peer card survives the transcript being emptied', () => {
        session.savePeerMessage(
            { id: 'env-1', fromProfile: 'pa', fromHost: 'host', senderRole: 'primary' },
            'a forwarded draft',
        );
        assert.strictEqual(session.messages.length, 1);

        // What a reload does to the transcript: Hermes has no row for a pending card.
        session.messages = [];
        const merged = session.mergePendingPeers();

        assert.strictEqual(merged.length, 1);
        assert.strictEqual(session.messages[0].role, 'peer');
        assert.strictEqual(session.messages[0].peerState, 'pending');
        assert.strictEqual(session.messages[0].text, 'a forwarded draft');
    });

    it('merging twice does not duplicate the card', () => {
        session.savePeerMessage({ id: 'env-1', fromProfile: 'pa', fromHost: 'host' }, 'draft');
        // While the live card is still in memory the merge adds nothing: the dedupe is by id.
        assert.strictEqual(session.mergePendingPeers().length, 0);
        session.messages = [];
        assert.strictEqual(session.mergePendingPeers().length, 1);
        assert.strictEqual(session.mergePendingPeers().length, 0);
    });

    it('a decision is final across a reload', () => {
        session.savePeerMessage({ id: 'env-1', fromProfile: 'pa', fromHost: 'host' }, 'draft');
        assert.strictEqual(session.setPeerState('env-1', 'delivered'), true);

        session.messages = [];
        assert.deepStrictEqual(session.mergePendingPeers(), []);
        assert.deepStrictEqual(new PendingPeerStore(dir).read('tab-a'), []);
    });
});
