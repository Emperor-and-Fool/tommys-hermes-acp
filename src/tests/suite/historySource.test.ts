import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toChatMessages } from '../../host/chat/historyLookup';
import { PENDING_USER_LIMIT, PendingUserStore } from '../../host/cache/pendingUsers';

describe('export rows become transcript messages', () => {
    it('converts Hermes seconds to milliseconds', () => {
        const [message] = toChatMessages([{ role: 'user', content: 'hello', timestamp: 1_700_000_000 }]);
        assert.strictEqual(message.timestamp, 1_700_000_000_000);
        assert.strictEqual(message.role, 'user');
        assert.strictEqual(message.text, 'hello');
    });

    it('drops permission rows and empty bodies', () => {
        const messages = toChatMessages([
            { role: 'permission', content: 'may I?', timestamp: 1 },
            { role: 'assistant', content: '   ', timestamp: 2 },
            { role: 'assistant', content: 'kept', timestamp: 3 },
        ]);
        assert.deepStrictEqual(messages.map(message => message.text), ['kept']);
    });

    it('keeps everything Hermes exported: the pane shows what a replay would', () => {
        const rows = Array.from({ length: 130 }, (_, index) => ({
            role: 'assistant',
            content: `message ${index}`,
            timestamp: index,
        }));
        assert.strictEqual(toChatMessages(rows).length, 130);
    });
});

describe('pending user messages: the only local state', () => {
    let dir: string;
    let store: PendingUserStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'));
        store = new PendingUserStore(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps the last five turns, oldest first', () => {
        for (let index = 0; index < 7; index++) {
            store.append('tab-1', `message ${index}`, index);
        }
        const users = store.read('tab-1');
        assert.strictEqual(users.length, PENDING_USER_LIMIT);
        assert.deepStrictEqual(users.map(user => user.text), ['message 2', 'message 3', 'message 4', 'message 5', 'message 6']);
    });

    it('ignores blank text', () => {
        store.append('tab-1', '   ');
        assert.deepStrictEqual(store.read('tab-1'), []);
    });

    it('retains only what a replay did not contain, and removes the file when nothing is left', () => {
        store.append('tab-1', 'arrived', 1);
        store.append('tab-1', 'lost', 2);

        store.retain('tab-1', ['lost']);
        assert.deepStrictEqual(store.read('tab-1').map(user => user.text), ['lost']);

        store.retain('tab-1', []);
        assert.deepStrictEqual(store.read('tab-1'), []);
        assert.ok(!fs.existsSync(store.pathFor('tab-1')));
    });

    it('keeps sessions apart', () => {
        store.append('tab-1', 'one');
        store.append('tab-2', 'two');
        assert.deepStrictEqual(store.read('tab-1').map(user => user.text), ['one']);
        assert.deepStrictEqual(store.read('tab-2').map(user => user.text), ['two']);
    });
});
