import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/cache/sessions';
import type { SessionsHost } from '../../host/cache/sessions';
import type { CatalogSession } from '../../host/acp/AcpClient';
import type { HostToPane } from '../../shared/webview';

const quietHost = (): SessionsHost & { lines: string[] } => {
    const lines: string[] = [];
    return {
        lines,
        post: (_msg: HostToPane) => {},
        log: (line: string) => { lines.push(line); },
        updatePanelTitle: () => {},
        modelLabel: () => undefined,
    };
};

const catalogRow = (sessionId: string, messageCount: number, hidden = false): CatalogSession => ({
    sessionId,
    title: sessionId,
    updatedAt: 100,
    messageCount,
    hidden,
});

const sessionsIn = (dir: string, activeId: string, boundTo?: string): Sessions => {
    const sessions = new Sessions(dir, 'scope', quietHost());
    sessions.activeId = activeId;
    sessions.tabs = [{
        id: activeId,
        title: activeId,
        createdAt: 1,
        updatedAt: 1,
        hermesSessionId: boundTo,
    }];
    return sessions;
};

describe('the tab link, proven from the source', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secondant-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('is linked when the bound session is in the catalog, and the count comes from the row', () => {
        const sessions = sessionsIn(dir, 'tab-1', 'h-1');
        sessions.applyCatalog([catalogRow('h-1', 503)]);

        assert.strictEqual(sessions.activeIsLinked(), true);
        assert.strictEqual(sessions.catalogRow('h-1')?.messageCount, 503, 'the count is the source\'s');
        assert.deepStrictEqual(sessions.tabs.map(tab => tab.id), ['tab-1'], 'the tab keeps its session');
        assert.strictEqual(sessions.tabs[0].hermesSessionId, 'h-1');
    });

    it('is not linked when the recorded pointer\'s session is gone, and nothing throws', () => {
        const sessions = sessionsIn(dir, 'tab-1', 'h-gone');
        sessions.applyCatalog([catalogRow('h-other', 12)]);

        assert.strictEqual(sessions.activeIsLinked(), false);
        assert.strictEqual(sessions.catalogRow('h-gone'), undefined, 'no row, no count to show');
        // The tab is still on the strip: an unlisted binding is kept, never silently dropped.
        assert.ok(sessions.tabs.some(tab => tab.id === 'tab-1'), 'the tab survives the miss');
        assert.ok(sessions.tabs.some(tab => tab.id === 'h-other'), 'the catalog\'s own rows arrive beside it');
    });

    it('is not linked for a tab that was never bound', () => {
        const sessions = sessionsIn(dir, 'tab-new');
        sessions.applyCatalog([catalogRow('h-1', 7)]);

        assert.strictEqual(sessions.activeIsLinked(), false);
        assert.ok(sessions.tabs.some(tab => tab.id === 'tab-new'), 'a fresh tab is not replaced by an adoption');
    });

    it('writes ids and titles only — no count, no engagement', () => {
        const sessions = sessionsIn(dir, 'tab-1', 'h-1');
        sessions.applyCatalog([catalogRow('h-1', 503)]);
        sessions.saveCatalog();

        const written = JSON.parse(fs.readFileSync(sessions.store.catalogPath, 'utf-8')) as Array<Record<string, unknown>>;
        assert.strictEqual(written.length, 1);
        assert.deepStrictEqual(
            Object.keys(written[0]).filter(key => key !== 'createdAt' && key !== 'updatedAt' && key !== 'title' && key !== 'id' && key !== 'hermesSessionId'),
            [],
            'nothing about the conversation content is persisted'
        );
        assert.strictEqual('messageCount' in written[0], false);
        assert.strictEqual('agentEngaged' in written[0], false);
    });
});
