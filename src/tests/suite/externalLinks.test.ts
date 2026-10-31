import * as assert from 'assert';
import { isExternalLinkAllowed } from '../../host/webview/externalLinks';

describe('isExternalLinkAllowed', () => {
    it('allows the schemes a message may legitimately open', () => {
        for (const url of [
            'https://example.com/docs?q=1#top',
            'http://example.com',
            'mailto:someone@example.com',
            'HTTPS://EXAMPLE.COM/upper',
        ]) {
            assert.strictEqual(isExternalLinkAllowed(url), true, url);
        }
    });

    it('refuses schemes that would act on the editor or the filesystem', () => {
        for (const url of [
            'command:workbench.action.terminal.new',
            'vscode://emperorandfool.tommys-hermes-acp/open',
            'file:///etc/passwd',
            'javascript:alert(1)',
            'data:text/html,<b>x</b>',
            'vbscript:msgbox',
            '',
        ]) {
            assert.strictEqual(isExternalLinkAllowed(url), false, url);
        }
    });

    it('refuses relative and protocol-relative links', () => {
        assert.strictEqual(isExternalLinkAllowed('//example.com/x'), false);
        assert.strictEqual(isExternalLinkAllowed('/local/path'), false);
        assert.strictEqual(isExternalLinkAllowed('#anchor'), false);
    });
});
