/**
 * The approval note a gate writes is its own content block (`_meta.kind === 'approval'`), not tool
 * prose: if it leaked into the body it would be drawn twice, and if it were dropped the transcript
 * would lose the only trace of how a command got past the gate.
 */
import * as assert from 'assert';
import { extractApprovalNoteFromContent, extractTextFromContentBlock } from '../../host/acp/contentText';
import { ToolCallTracker, parseToolCallSessionUpdate } from '../../host/acp/toolCallUpdate';

function textBlock(text: string, meta?: Record<string, unknown>) {
    const block: Record<string, unknown> = { type: 'text', text };
    if (meta) {
        block._meta = meta;
    }
    return { type: 'content', content: block };
}

describe('approval note', () => {
    it('keeps the tagged block out of the tool body', () => {
        const content = [
            textBlock('terminal result\n- **exit_code:** 0'),
            textBlock('Command was flagged (recursive delete) and auto-approved by smart approval.', { kind: 'approval' }),
        ];
        assert.strictEqual(extractTextFromContentBlock(content), 'terminal result\n- **exit_code:** 0');
        assert.strictEqual(
            extractApprovalNoteFromContent(content),
            'Command was flagged (recursive delete) and auto-approved by smart approval.'
        );
    });

    it('is undefined for an update with no note', () => {
        const view = parseToolCallSessionUpdate(
            { toolCallId: 'call_1', status: 'completed', content: [textBlock('plain output')] },
            'tool_call_update'
        );
        assert.ok(view);
        assert.strictEqual(view!.body, 'plain output');
        assert.strictEqual(view!.approvalNote, undefined);
    });

    it('carries the note on the parsed view and keeps it across updates', () => {
        const first = parseToolCallSessionUpdate(
            {
                toolCallId: 'call_2',
                status: 'in_progress',
                content: [textBlock('running'), textBlock('flagged (recursive delete)', { kind: 'approval' })],
            },
            'tool_call_update'
        );
        assert.strictEqual(first!.approvalNote, 'flagged (recursive delete)');

        const tracker = new ToolCallTracker();
        assert.strictEqual(tracker.apply(first!).approvalNote, 'flagged (recursive delete)');

        // A later update without the block must not erase what was already shown.
        const later = parseToolCallSessionUpdate(
            { toolCallId: 'call_2', status: 'completed', content: [textBlock('running\nPROBE-DELETED')] },
            'tool_call_update'
        );
        assert.strictEqual(later!.approvalNote, undefined);
        const merged = tracker.apply(later!);
        assert.strictEqual(merged.approvalNote, 'flagged (recursive delete)');
        assert.strictEqual(merged.status, 'completed');
    });
});
