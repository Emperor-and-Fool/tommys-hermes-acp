import { describe, it } from 'mocha';
import assert from 'assert';
import { HistoryStages } from '../../host/chat/historyAttach';
import type { ChatMessage, HistoryRef } from '../../shared/chat';

function ref(over: Partial<HistoryRef> = {}): HistoryRef {
    return { sessionId: 'sess-a', profile: 'dev', title: 'Earlier work', count: 0, messageIds: [], ...over };
}

function msg(role: string, text: string): ChatMessage {
    return { role, text, timestamp: 1 };
}

describe('history stages', () => {
    it('keeps a pick inside the tab it was staged in', () => {
        const stages = new HistoryStages();
        stages.stage('tab-a', ref(), [msg('user', 'from a')]);
        assert.ok(stages.current('tab-a'));
        assert.strictEqual(stages.current('tab-b'), null);
        assert.strictEqual(stages.block('tab-b'), '');
    });

    it('a lookup that finishes late updates only its own tab', async () => {
        const stages = new HistoryStages();
        let release: () => void = () => undefined;
        const lookup = new Promise<void>(resolve => { release = resolve; });
        stages.stage('tab-a', ref(), [msg('user', 'from a')]);
        stages.begin('tab-a', lookup);
        stages.stage('tab-b', ref({ sessionId: 'sess-b', title: 'B' }), [msg('user', 'from b')]);
        assert.strictEqual(stages.isPending('tab-a'), true);
        assert.strictEqual(stages.isPending('tab-b'), false);

        release();
        await lookup;
        stages.stage('tab-a', ref(), [msg('user', 'from a')], [41]);

        assert.deepStrictEqual(stages.current('tab-a')!.ref.messageIds, [41]);
        assert.deepStrictEqual(stages.current('tab-b')!.ref.messageIds, [null]);
        assert.strictEqual(stages.isPending('tab-a'), false);
    });

    it('drops a tab pick when the tab closes, leaving the others alone', () => {
        const stages = new HistoryStages();
        stages.stage('tab-a', ref(), [msg('user', 'x')]);
        stages.stage('tab-b', ref({ sessionId: 'sess-b' }), [msg('user', 'y')]);
        stages.drop('tab-a');
        assert.strictEqual(stages.current('tab-a'), null);
        assert.ok(stages.current('tab-b'));
        assert.strictEqual(stages.size, 1);
    });

    it('clear reports whether there was a pick and empties that tab only', () => {
        const stages = new HistoryStages();
        stages.stage('tab-a', ref(), [msg('user', 'x')]);
        stages.stage('tab-b', ref({ sessionId: 'sess-b' }), [msg('user', 'y')]);
        assert.strictEqual(stages.clear('tab-a'), true);
        assert.strictEqual(stages.clear('tab-a'), false);
        assert.strictEqual(stages.current('tab-a'), null);
        assert.strictEqual(stages.block('tab-a'), '');
        assert.ok(stages.current('tab-b'));
    });

    it('waits only for the tab it was asked about', async () => {
        const stages = new HistoryStages();
        let release: () => void = () => undefined;
        stages.stage('tab-a', ref(), [msg('user', 'x')]);
        stages.begin('tab-a', new Promise<void>(resolve => { release = resolve; }));

        await stages.waitFor('tab-b');
        let done = false;
        void stages.waitFor('tab-a').then(() => { done = true; });
        await Promise.resolve();
        assert.strictEqual(done, false);

        release();
        await stages.waitFor('tab-a');
        assert.strictEqual(done, true);
    });
});
