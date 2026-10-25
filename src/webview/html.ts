import * as fs from 'fs';
import { WEBVIEW_LOCALE_HELPER } from '../i18n/format';
import type { LocaleStrings } from '../i18n/types';

/** Everything the page needs as inputs; nothing here reads the provider or the vscode API. */
export interface WebviewHtmlInput {
    /** Absolute path of `media/chat.html`, the template with the placeholder slots. */
    htmlPath: string;
    /**
     * Turns a path relative to `media/` into a URI the webview may load. Absent when the
     * document is built before a webview exists, which is why the slots stay unfilled then.
     */
    resourceUri?: (relativeToMedia: string) => string;
    /** `vscode.ColorThemeKind`: it decides which syntax sheet matches. */
    themeKind: number;
    locale: LocaleStrings;
}

// vscode.ColorThemeKind: Light = 1, Dark = 2, HighContrast = 3, HighContrastLight = 4.
const LIGHT_THEME_KINDS = [1, 4];

/**
 * Syntax colours ship in two variants. The dark sheet sets `.hljs{color:#c9d1d9}` and
 * `.message pre code` cancels its background, so on a light theme it paints pale grey on a
 * pale chip. Pick the variant that matches the active theme; a theme switch takes effect
 * when the webview resolves again.
 */
export function highlightSheetFor(themeKind: number): string {
    return LIGHT_THEME_KINDS.includes(themeKind) ? 'github-light.min.css' : 'github-dark.min.css';
}

/**
 * Build the webview document: `media/chat.html` with its eight placeholder slots filled.
 * Pure apart from reading that file.
 */
export function buildWebviewHtml(input: WebviewHtmlInput): string {
    const html = fs.readFileSync(input.htmlPath, 'utf-8');
    const uri = input.resourceUri;

    if (!uri) {
        return html
            .replace('{{LOCALE_JSON}}', '{}')
            .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER);
    }

    return html
        .replace('{{MARKED_URI}}', uri('vendor/marked.min.js'))
        .replace('{{HIGHLIGHT_URI}}', uri('vendor/highlight.min.js'))
        .replace('{{HIGHLIGHT_CSS_URI}}', uri('vendor/' + highlightSheetFor(input.themeKind)))
        .replace('{{PURIFY_URI}}', uri('vendor/purify.min.js'))
        .replace('{{CHAT_CSS_URI}}', uri('chat.css'))
        .replace('{{CHAT_JS_URI}}', uri('chat.js'))
        .replace('{{LOCALE_JSON}}', JSON.stringify(input.locale).replace(/</g, '\\u003c'))
        .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER);
}
