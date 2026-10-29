import * as assert from 'assert';
import { applyCatalogRows, MAX_SESSION_TITLE_LENGTH, normalizeSessionTitle, renameSession } from '../../host/cache/catalog';
import type { CatalogRow, SessionInfo, SessionTitlePort } from '../../shared/chat';

const local = (over: Partial<SessionInfo>): SessionInfo => ({
    id: 'local-1',
    title: 'local title',
    createdAt: 100,
    updatedAt: 100,
    ...over,
});

const row = (over: Partial<CatalogRow> & { sessionId: string }): CatalogRow => ({
    messageCount: 1,
    updatedAt: 500,
    ...over,
});

describe('applyCatalogRows', () => {
    it('carries the view flags the agent cannot know', () => {
        const previous = [local({
            id: 'tab-a',
            hermesSessionId: 'h-1',
            pinned: true,
            modelId: 'm-1',
            modelLabel: 'Model One',
            cwd: '/work/a',
            title: 'name from before',
        })];
        const result = applyCatalogRows({
            previous,
            rows: [row({ sessionId: 'h-1', title: 'agent name' })],
            activeId: 'tab-a',
            activeLinked: true,
            now: 1000,
        });
        const merged = result.sessions[0];
        assert.strictEqual(merged.id, 'tab-a', 'the local tab id survives');
        assert.strictEqual(merged.title, 'agent name', 'Hermes owns the title');
        assert.strictEqual(merged.pinned, true);
        assert.strictEqual(merged.modelId, 'm-1');
        assert.strictEqual(merged.modelLabel, 'Model One');
        assert.strictEqual(merged.cwd, '/work/a');
        assert.strictEqual(merged.hermesSessionId, 'h-1');
        assert.strictEqual(result.activeChanged, false);
        assert.strictEqual('messageCount' in merged, false, 'the count is Hermes\' and is not copied');
        assert.strictEqual('agentEngaged' in merged, false, 'engagement is read from the catalog, not stored');
    });

    it('skips hidden rows and hands them back for the picker', () => {
        const result = applyCatalogRows({
            previous: [],
            rows: [row({ sessionId: 'h-1' }), row({ sessionId: 'h-2', hidden: true })],
            activeId: 'h-1',
            activeLinked: true,
            now: 1000,
        });
        assert.deepStrictEqual(result.sessions.map(s => s.hermesSessionId), ['h-1']);
        assert.deepStrictEqual(result.hiddenRows.map(r => r.sessionId), ['h-2']);
    });

    it('keeps a tab Hermes does not list, but not one whose row is there and closed', () => {
        // A tab created moments ago: no Hermes id, so no row can exist. It stays.
        const fresh = local({ id: 'tab-new', createdAt: 900, updatedAt: 900 });
        const kept = applyCatalogRows({
            previous: [fresh],
            rows: [row({ sessionId: 'h-old', updatedAt: 400 })],
            activeId: 'tab-new',
            activeLinked: false,
            now: 1000,
        });
        assert.deepStrictEqual(kept.sessions.map(s => s.id), ['tab-new', 'h-old']);

        // A bound tab whose row is present but hidden — closed elsewhere — is not kept: the
        // catalog says this session is not open, and the record must not argue with it.
        const bound = local({ id: 'tab-closed', hermesSessionId: 'h-closed', createdAt: 900, updatedAt: 900 });
        const dropped = applyCatalogRows({
            previous: [bound],
            rows: [row({ sessionId: 'h-old', updatedAt: 400 }), row({ sessionId: 'h-closed', hidden: true })],
            activeId: 'tab-closed',
            activeLinked: true,
            now: 1000,
        });
        assert.deepStrictEqual(dropped.sessions.map(s => s.id), ['h-old'], 'a closed tab is not resurrected');
        assert.strictEqual(dropped.activeChanged, true, 'the tab that vanished is replaced');
        assert.strictEqual(dropped.activeId, 'h-old');
    });

    it('puts pinned tabs first, then the most recently updated', () => {
        const result = applyCatalogRows({
            previous: [local({ id: 'tab-pin', hermesSessionId: 'h-pin', pinned: true })],
            rows: [
                row({ sessionId: 'h-old', updatedAt: 300 }),
                row({ sessionId: 'h-new', updatedAt: 900 }),
                row({ sessionId: 'h-pin', updatedAt: 100 }),
            ],
            activeId: 'tab-pin',
            activeLinked: true,
            now: 1000,
        });
        assert.deepStrictEqual(
            result.sessions.map(s => s.hermesSessionId),
            ['h-pin', 'h-new', 'h-old']
        );
    });
});

describe('normalizeSessionTitle', () => {
    it('collapses whitespace and trims', () => {
        assert.deepStrictEqual(normalizeSessionTitle('  New \n  name  '), { ok: true, title: 'New name' });
    });

    it('refuses a title that is empty or only spaces', () => {
        assert.deepStrictEqual(normalizeSessionTitle('   '), { ok: false, reason: 'empty' });
        assert.deepStrictEqual(normalizeSessionTitle(''), { ok: false, reason: 'empty' });
    });

    it('refuses a title past the agent limit, and keeps one exactly at it', () => {
        const atLimit = 'a'.repeat(MAX_SESSION_TITLE_LENGTH);
        assert.deepStrictEqual(normalizeSessionTitle(atLimit), { ok: true, title: atLimit });
        assert.deepStrictEqual(normalizeSessionTitle(atLimit + 'a'), { ok: false, reason: 'too-long' });
    });
});

describe('renameSession', () => {
    const recorder = (behaviour?: () => void): { calls: string[]; port: SessionTitlePort } => {
        const calls: string[] = [];
        const port: SessionTitlePort = {
            setTitle: async (id: string, title: string) => {
                calls.push('set:' + id + ':' + title);
                if (behaviour) {
                    behaviour();
                }
                return true;
            },
            refreshCatalog: async () => { calls.push('refresh'); },
            log: () => {},
        };
        return { calls, port };
    };

    it('writes through Hermes, then re-reads the catalog', async () => {
        const { calls, port } = recorder();
        const outcome = await renameSession(port, 's-1', '  New   name ');
        assert.deepStrictEqual(outcome, { ok: true, title: 'New name' });
        assert.deepStrictEqual(calls, ['set:s-1:New name', 'refresh']);
    });

    it('never touches the wire for a title Hermes would refuse', async () => {
        const { calls, port } = recorder();
        const outcome = await renameSession(port, 's-1', '   ');
        assert.deepStrictEqual(outcome, { ok: false, reason: 'empty' });
        assert.deepStrictEqual(calls, []);
    });

    it('reports a refusal and skips the rescan when the write is rejected', async () => {
        const { calls, port } = recorder(() => { throw new Error("Title 'Taken' is already in use by session abc"); });
        const outcome = await renameSession(port, 's-1', 'Taken');
        assert.strictEqual(outcome.ok, false);
        assert.strictEqual(outcome.reason, 'refused');
        assert.ok((outcome.message || '').includes('already in use'));
        assert.deepStrictEqual(calls, ['set:s-1:Taken']);
    });
});
