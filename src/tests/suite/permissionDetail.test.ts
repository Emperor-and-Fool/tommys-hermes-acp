import { describe, it } from 'mocha';
import assert from 'assert';
import { extractPermissionDetail } from '../../host/acp/AcpClient';

/**
 * The parser `AcpClient` actually calls when it builds a permission card. The card is the whole
 * approval UI: whatever this drops is what the user approves without seeing.
 */
describe('permission card detail', () => {
    it('shows a structured input instead of approving blind', () => {
        const detail = extractPermissionDetail({ rawInput: { command: 'rm -rf build', args: ['-v'] } });

        assert.ok(detail, 'a structured input produces detail');
        assert.match(detail!, /rm -rf build/);
        assert.match(detail!, /"-v"/);
    });

    it('keeps a string input as it was written', () => {
        assert.strictEqual(extractPermissionDetail({ rawInput: 'git push --force' }), 'git push --force');
    });

    it('reads the snake_case spelling the protocol also uses', () => {
        assert.strictEqual(extractPermissionDetail({ raw_input: 'ls -la' }), 'ls -la');
    });

    it('joins the input and the content block', () => {
        const detail = extractPermissionDetail({
            rawInput: 'ls',
            content: [{ type: 'text', text: 'list the directory' }],
        });

        assert.strictEqual(detail, 'ls\n\nlist the directory');
    });

    it('has nothing to show when the call carries no input', () => {
        assert.strictEqual(extractPermissionDetail({ content: [{}] }), undefined);
    });
});
