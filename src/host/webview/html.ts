import * as fs from 'fs';
import * as path from 'path';
import { WEBVIEW_LOCALE_HELPER } from '../i18n/format';
import type { LocaleStrings } from '../../shared/i18n';
import { identity } from '../../shared/extensionId';

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
 * The artwork each identity loads while connecting: the secondant is orange by definition, the
 * primary gets the full-colour art. One file per role, both resolved through the same slot.
 */
function loadingIconFor(role: 'primary' | 'secondant'): string {
    return role === 'secondant' ? 'icon_orange.svg' : 'icon_fullcolor.png';
}

/**
 * Build the webview document: `media/chat.html` with its placeholder slots filled.
 * Pure apart from reading that file.
 */
export function buildWebviewHtml(input: WebviewHtmlInput): string {
    const html = fs.readFileSync(input.htmlPath, 'utf-8');
    const uri = input.resourceUri;

    if (!uri) {
        return html
            .replace('{{LOCALE_JSON}}', '{}')
            .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER)
            .replace('{{SECONDANT_ICON_URI}}', '')
            .replace('{{LOADING_ICON_URI}}', '');
    }

    // A rebuilt file must get a new URL: the webview caches what it loads, and a stable
    // `pane.js` address is how a freshly built bundle keeps running as the old one.
    const mediaDir = path.dirname(input.htmlPath);
    const versioned = (relativeToMedia: string): string => {
        const uriBase = uri(relativeToMedia);
        try {
            const stamp = fs.statSync(path.join(mediaDir, relativeToMedia)).mtimeMs;
            return uriBase + (uriBase.includes('?') ? '&' : '?') + 'v=' + Math.round(stamp);
        } catch {
            return uriBase;
        }
    };

    return html
        .replace('{{MARKED_URI}}', versioned('vendor/marked.min.js'))
        .replace('{{HIGHLIGHT_URI}}', versioned('vendor/highlight.min.js'))
        .replace('{{HIGHLIGHT_CSS_URI}}', versioned('vendor/' + highlightSheetFor(input.themeKind)))
        .replace('{{PURIFY_URI}}', versioned('vendor/purify.min.js'))
        .replace('{{CHAT_CSS_URI}}', versioned('chat.css'))
        .replace('{{CHAT_JS_URI}}', versioned('pane.js'))
        .replace('{{SECONDANT_ICON_URI}}', versioned('icon_orange.svg'))
        .replace('{{LOADING_ICON_URI}}', versioned(loadingIconFor(identity().role)))
        .replace('{{LOCALE_JSON}}', JSON.stringify(input.locale).replace(/</g, '\\u003c'))
        .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER);
}
