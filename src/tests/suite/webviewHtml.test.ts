import * as assert from 'assert';
import * as path from 'path';
import { buildWebviewHtml, highlightSheetFor } from '../../host/webview/html';
import { en } from '../../host/i18n/locales/en';
import { PRIMARY, SECONDANT, setActiveIdentity } from '../../shared/extensionId';

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
        for (const slot of ['MARKED_URI', 'HIGHLIGHT_URI', 'HIGHLIGHT_CSS_URI', 'PURIFY_URI', 'CHAT_CSS_URI', 'CHAT_JS_URI', 'LOADING_ICON_URI', 'LOCALE_JSON', 'LOCALE_HELPER']) {
            assert.strictEqual(html.includes('{{' + slot + '}}'), false, slot + ' was not replaced');
        }
        assert.ok(html.includes('file:///media/vendor/highlight.min.js'));
        assert.ok(html.includes('file:///media/pane.js'));
    });

    it('gives the loading block the identity\'s own icon', () => {
        try {
            setActiveIdentity(PRIMARY);
            const primary = buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale: en });
            assert.ok(primary.includes('file:///media/icon_fullcolor.png?v='), 'the primary loads the full-colour art');

            setActiveIdentity(SECONDANT);
            const secondant = buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale: en });
            assert.ok(secondant.includes('file:///media/icon_orange.svg?v='), 'the secondant loads the orange art');
            assert.strictEqual(secondant.includes('icon_fullcolor.png'), false, 'only one of the two files is referenced');
        } finally {
            setActiveIdentity(PRIMARY);
        }
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

    it('carries a nonce-guarded CSP and stamps every script with the nonce', () => {
        const html = buildWebviewHtml({
            htmlPath,
            resourceUri: uri,
            cspSource: 'vscode-webview://abc',
            themeKind: 2,
            locale: en,
        });
        assert.ok(html.includes("default-src 'none'"), 'the CSP is present');
        assert.ok(html.includes('img-src vscode-webview://abc'), 'the webview origin is allowed');
        assert.strictEqual(html.includes('{{CSP_NONCE}}'), false, 'the nonce slot is filled');
        assert.strictEqual(html.includes('{{CSP_SOURCE}}'), false, 'the source slot is filled');

        const nonces = [...html.matchAll(/<script nonce="([^"]+)"/g)].map(m => m[1]);
        const scripts = [...html.matchAll(/<script\b/g)].length;
        assert.strictEqual(nonces.length, scripts, 'every script tag carries a nonce');
        assert.strictEqual(new Set(nonces).size, 1, 'one nonce per build');
    });

    it('gives two builds different nonces', () => {
        const build = () => buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale: en });
        const nonceOf = (html: string) => /<script nonce="([^"]+)"/.exec(html)?.[1];
        assert.notStrictEqual(nonceOf(build()), nonceOf(build()));
    });

    it('keeps a `$&` in a locale string literal instead of expanding it', () => {
        const locale = { ...en, __probe: 'costs $& nothing, $1 stays' } as unknown as typeof en;
        const html = buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale });
        assert.ok(html.includes('costs $& nothing, $1 stays'), 'the value survives verbatim');
        assert.strictEqual(html.includes('{{LOCALE_JSON}}'), false, 'the slot is still filled');
    });

    it('escapes `<` in the locale payload so it cannot close the script', () => {
        const locale = { ...en, __probe: '</script><b>x</b>' } as unknown as typeof en;
        const html = buildWebviewHtml({ htmlPath, resourceUri: uri, themeKind: 2, locale });
        assert.strictEqual(html.includes('</script><b>x</b>'), false);
        assert.ok(html.includes('\\u003c/script>'), 'escaped as a unicode sequence');
    });
});
