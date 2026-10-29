import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/cache/sessions';
import { PendingUserStore } from '../../host/cache/pendingUsers';

/**
 * One sidecar, one question: did the agent ever receive the message I just sent? It is written
 * where the send happens, and nowhere else.
 */
describe('sessions: the user sidecar', () => {
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

    it('a send writes it', () => {
        session.saveOutgoingUser('did you get this?');
        assert.deepStrictEqual(
            new PendingUserStore(dir).read('tab-a').map(user => user.text),
            ['did you get this?'],
        );
    });

    it('a replayed user row does not', () => {
        // The replay echoes the user's own turns back through the same save path; treating
        // those as sends would fill the sidecar with messages Hermes plainly already has.
        session.saveMessage('user', 'an older turn from the replay');
        assert.deepStrictEqual(new PendingUserStore(dir).read('tab-a'), []);
    });

    it('keeps the last few turns only', () => {
        for (let i = 0; i < 8; i++) {
            session.saveOutgoingUser(`turn ${i}`);
        }
        const kept = new PendingUserStore(dir).read('tab-a');
        assert.strictEqual(kept.length, 5);
        assert.strictEqual(kept[kept.length - 1].text, 'turn 7');
    });
});
