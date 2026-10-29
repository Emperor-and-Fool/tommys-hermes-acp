import { describe, it } from 'mocha';
import assert from 'assert';
import { extractChunkMeta, extractToolMeta, parseToolLocations } from '../../host/acp/replayChunkMeta';

describe('ACP metadata capture', () => {
    it('takes messageId and _meta off a text chunk', () => {
        const extras = extractChunkMeta({ messageId: 'm-123', _meta: { seq: 5 } });
        assert.strictEqual(extras.messageId, 'm-123');
        assert.deepStrictEqual(extras.meta, { seq: 5 });
    });

    it('leaves absent fields absent, never empty', () => {
        const extras = extractChunkMeta({});
        assert.strictEqual(extras.messageId, undefined);
        assert.strictEqual(extras.meta, undefined);
    });

    it('ignores a messageId that is not a non-empty string', () => {
        assert.strictEqual(extractChunkMeta({ messageId: '' }).messageId, undefined);
        assert.strictEqual(extractChunkMeta({ messageId: 42 }).messageId, undefined);
    });

    it('captures the tool fields Hermes sends beside the rendered text', () => {
        const extras = extractToolMeta(
            {
                locations: [{ path: 'src/a.ts', line: 12 }, { path: 'src/b.ts' }, { line: 3 }, 'nonsense'],
                _meta: { hermes: { compactionSummary: true } },
            },
            { title: 'Read file', kind: 'read', status: 'completed' }
        );
        assert.strictEqual(extras.toolTitle, 'Read file');
        assert.strictEqual(extras.toolKind, 'read');
        assert.strictEqual(extras.toolStatus, 'completed');
        assert.deepStrictEqual(extras.toolLocations, [{ path: 'src/a.ts', line: 12 }, { path: 'src/b.ts' }]);
        assert.deepStrictEqual(extras.meta, { hermes: { compactionSummary: true } });
    });

    it('keeps a tool row quiet when the update is bare', () => {
        assert.deepStrictEqual(extractToolMeta({}, {}), {});
    });

    it('parses locations defensively', () => {
        assert.strictEqual(parseToolLocations(undefined), undefined);
        assert.strictEqual(parseToolLocations('nope'), undefined);
        assert.strictEqual(parseToolLocations([]), undefined);
        assert.deepStrictEqual(parseToolLocations([{ path: 'x', line: 1 }]), [{ path: 'x', line: 1 }]);
    });
});
