import { describe, it } from 'mocha';
import assert from 'assert';
import { initI18n } from '../../host/i18n';
import { formatMessagesAsMarkdown } from '../../host/chat/sessionExport';
import type { ChatMessage } from '../../shared/chat';

describe('session export', () => {
    it('exports a history slice as a quoted block with its session handle', () => {
        initI18n('en');
        const messages: ChatMessage[] = [
            {
                role: 'history',
                text: 'user: earlier question\nassistant: earlier answer',
                timestamp: 1,
                history: {
                    sessionId: 'h-1',
                    profile: 'default',
                    title: 'Earlier work',
                    count: 2,
                    messageIds: [null, null],
                },
            },
            { role: 'user', text: 'what changed?', timestamp: 2 },
        ];
        const markdown = formatMessagesAsMarkdown(messages);
        assert.ok(markdown.includes('## From conversation: Earlier work (@session:default/h-1)'), markdown);
        assert.ok(markdown.includes('> user: earlier question'), markdown);
        assert.ok(markdown.includes('> assistant: earlier answer'), markdown);
        assert.ok(markdown.includes('## You\n\nwhat changed?'), markdown);
    });
});
