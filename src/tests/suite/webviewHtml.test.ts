import * as assert from 'assert';
import * as path from 'path';
import { buildWebviewHtml, highlightSheetFor } from '../../webview/html';
import { en } from '../../i18n/locales/en';

// vscode.ColorThemeKind: Light = 1, Dark = 2, HighContrast = 3, HighContrastLight = 4.
const repoRoot = path.resolve(__dirname, '../../..');
const htmlPath = path.join(repoRoot, 'media', 'chat.html');
const uri = (relative: string) => 'file:///media/' + relative;

describe('webviewHtml', () => {
    it('fills the locale slots even when no webview exists yet', () => {
        const html = buildWebviewHtml({ htmlPath, themeKind: 2, locale: en });
        assert.ok(html.includes('function localeText'), 'the locale helper is injected');
        assert.strictEqual(html.includes('{{LOCALE_JSON}}'), false);
        assert.strictEqual(html.includes('{{LOCALE_HELPER}}'), false);
        // Without a webview the resource slots stay open for a later build.
        assert.ok(html.includes('{{CHAT_JS_URI}}'));
    });

    it('fills every resource slot when a webview is available', () => {
        const html = buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale: en });
        for (const slot of ['MARKED_URI', 'HIGHLIGHT_URI', 'HIGHLIGHT_CSS_URI', 'PURIFY_URI', 'CHAT_CSS_URI', 'CHAT_JS_URI', 'LOCALE_JSON', 'LOCALE_HELPER']) {
            assert.strictEqual(html.includes('{{' + slot + '}}'), false, slot + ' was not replaced');
        }
        assert.ok(html.includes('file:///media/vendor/highlight.min.js'));
        assert.ok(html.includes('file:///media/chat.js'));
    });

    it('escapes "<" in the locale payload so it cannot close the script tag', () => {
        const locale = { ...en, send: '</script><b>x</b>' };
        const html = buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale });
        assert.ok(html.includes('\\u003c/script>'));
        assert.strictEqual(html.includes('</script><b>x</b>'), false);
    });

    it('picks the light syntax sheet for both light theme kinds', () => {
        assert.strictEqual(highlightSheetFor(1), 'github-light.min.css');
        assert.strictEqual(highlightSheetFor(4), 'github-light.min.css');
        assert.strictEqual(highlightSheetFor(2), 'github-dark.min.css');
        assert.strictEqual(highlightSheetFor(3), 'github-dark.min.css');
    });
});
