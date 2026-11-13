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
            currentWorkspaceId: () => '',
            workspaceIdForCwd: () => '',
            knownWorkspaceIds: () => [],
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

/**
 * A blank chat is not a session: nothing is written for it, and the record it eventually gets is
 * born in the project it was opened in.
 */
describe('sessions: a chat becomes a record only when it says something', () => {
    let dir: string;
    let session: Sessions;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-blank-'));
        session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => 'ws-1',
            workspaceIdForCwd: () => '',
            knownWorkspaceIds: () => [],
        });
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('a blank chat is registered nowhere', () => {
        session.activeId = 'blank-1';
        session.beginBlank('project-1');

        session.ensureRegistered();
        session.saveCurrent();

        assert.deepStrictEqual(session.tabs, []);
    });

    it('leaving a blank chat discards the project it carried', () => {
        session.activeId = 'blank-1';
        session.beginBlank('project-1');
        session.tabs.unshift({ id: 'real-1', title: 'a real session', createdAt: 1, updatedAt: 1, hermesSessionId: 'hermes-1' });

        session.activate('real-1');
        session.activeId = 'blank-1';
        session.saveCurrent();

        assert.strictEqual(session.tabs.length, 1, 'the blank never became a record');
        assert.strictEqual(session.tabs[0].id, 'real-1');
    });

    it('binding a Hermes session makes the record, so the binding has somewhere to land', () => {
        session.activeId = 'blank-3';
        session.beginBlank('project-2');

        // No user turn yet: this is `session/new` answering, which is the first turn's own doing.
        session.ensureRegistered(true);
        const record = session.tabs.find(tab => tab.id === 'blank-3');
        assert.ok(record, 'the tab exists the moment a session is bound to it');
        assert.strictEqual(record.project, 'project-2');
        assert.strictEqual(record.title, 'New Chat', 'the catalog names it once it has a title');

        record.hermesSessionId = 'hermes-9';
        assert.strictEqual(session.tabs.filter(tab => tab.id === 'blank-3').length, 1, 'registered once');
    });

    it('the first turn writes the record, in the project the blank chat carried', () => {
        session.activeId = 'blank-2';
        session.beginBlank('project-1');
        session.saveMessage('user', 'the first thing I said');

        session.ensureRegistered();

        assert.strictEqual(session.tabs.length, 1);
        assert.strictEqual(session.tabs[0].id, 'blank-2');
        assert.strictEqual(session.tabs[0].project, 'project-1');
        assert.strictEqual(session.tabs[0].workspaceId, 'ws-1');
        assert.strictEqual(session.tabs[0].title, 'the first thing I said');
    });
});
