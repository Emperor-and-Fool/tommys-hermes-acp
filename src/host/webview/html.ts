import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WEBVIEW_LOCALE_HELPER } from '../i18n/format';
import type { LocaleStrings } from '../../shared/i18n';
import type { EditorEnv, EditorSettings } from '../../shared/editor';
import type { HostToPane } from '../../shared/webview';
import { identity } from '../../shared/extensionId';

/**
 * A file in the extension's `media/`, as one webview may load it.
 *
 * Kept here rather than in `editor/`: the answer is per webview, and a webview is one of our own
 * views, which is what this folder is for (F6).
 */
export function mediaUri(extensionUri: vscode.Uri, webview: vscode.Webview, relativeToMedia: string): string {
    return webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', relativeToMedia))
        .toString();
}

/**
 * The two things a webview contributes to its own document: the origin its CSP names, and the
 * function that turns a `media/` path into a URI it may load. Absent without a webview, which is
 * why the document's slots stay unfilled then.
 */
export function webviewResources(
    extensionUri: vscode.Uri,
    webview?: vscode.Webview
): Pick<WebviewHtmlInput, 'resourceUri' | 'cspSource'> {
    if (!webview) {
        return {};
    }
    return {
        resourceUri: (relativeToMedia: string) => mediaUri(extensionUri, webview, relativeToMedia),
        cspSource: webview.cspSource,
    };
}

/** Everything the page needs as inputs; nothing here reads the provider's state. */
export interface WebviewHtmlInput {
    /** Absolute path of `media/chat.html`, the template with the placeholder slots. */
    htmlPath: string;
    /**
     * Turns a path relative to `media/` into a URI the webview may load. Absent when the
     * document is built before a webview exists, which is why the slots stay unfilled then.
     */
    resourceUri?: (relativeToMedia: string) => string;
    /** `vscode.Webview.cspSource`: the one origin the CSP lets load images, styles and fonts. */
    cspSource?: string;
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
 * The artwork each identity wears — loading block, About panel, anywhere a picture is posted.
 *
 * **The secondant is orange by definition.** `icon_orange.svg` is its mark and must not be
 * "unified" with the primary's `icon_fullcolor.png`; the two panes are told apart by that colour
 * before a word is read. One function so the rule lives in one place.
 */
export function identityArtwork(role: 'primary' | 'secondant'): string {
    return role === 'secondant' ? 'icon_orange.svg' : 'icon_fullcolor.png';
}

/**
 * The two settings the pane draws with, as one message.
 *
 * They are a pair — "show what the agent thought" and "show what it ran" — and the pane asks for
 * both at once, on start and whenever either changes, so they travel together.
 */
export function configMessage(settings: EditorSettings): HostToPane {
    return {
        type: 'config',
        showThoughts: settings.get<boolean>('showThoughts', true),
        showToolCalls: settings.get<boolean>('showToolCalls', true),
    };
}

/**
 * The About panel's facts, as the pane is sent them.
 *
 * Two sources and no state: the manifest is the editor's own answer (`env.extensionInfo`), and the
 * mark is the identity's — the secondant is orange by definition, so a fixed file name would be
 * wrong on one of the two panes.
 */
export function pluginInfoMessage(input: {
    env: EditorEnv;
    extensionId: string;
    role: 'primary' | 'secondant';
    extensionUri: vscode.Uri;
    iconWebview: vscode.Webview | undefined;
}): HostToPane {
    const info = input.env.extensionInfo(input.extensionId);
    const iconUri = input.iconWebview
        ? mediaUri(input.extensionUri, input.iconWebview, identityArtwork(input.role))
        : '';
    return {
        type: 'pluginInfo',
        displayName: info.displayName || 'Tommys Hermes ACP',
        version: info.version,
        publisher: info.publisher,
        description: info.description,
        repository: info.repository,
        iconUri,
    };
}

/**
 * Fill a placeholder by split/join rather than `String.prototype.replace`.
 *
 * `replace` reads `$&`, `$'`, `` $` `` and `$1` in the *replacement* as patterns, and one of the
 * values here is a serialised locale — a translation containing `$&` would quietly corrupt the
 * document. Split/join has no pattern language.
 */
function fillSlots(document: string, slots: Array<[string, string]>): string {
    let out = document;
    for (const [slot, value] of slots) {
        out = out.split(slot).join(value);
    }
    return out;
}

/** Bytes behind the CSP nonce; 16 is the usual floor for "cannot be guessed ahead of time". */
const CSP_NONCE_BYTES = 16;

/**
 * Build the webview document: `media/chat.html` with its placeholder slots filled.
 *
 * A fresh nonce goes into every `<script>` and into the CSP, so markup that reaches the page from a
 * message body cannot execute even if it slips past the sanitiser.
 */
export function buildWebviewHtml(input: WebviewHtmlInput): string {
    const template = fs.readFileSync(input.htmlPath, 'utf-8');
    const uri = input.resourceUri;
    const slots: Array<[string, string]> = [
        ['{{CSP_SOURCE}}', input.cspSource ?? ''],
        ['{{CSP_NONCE}}', crypto.randomBytes(CSP_NONCE_BYTES).toString('base64')],
        ['{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER],
    ];

    if (!uri) {
        return fillSlots(template, [
            ...slots,
            ['{{LOCALE_JSON}}', '{}'],
            ['{{SECONDANT_ICON_URI}}', ''],
            ['{{LOADING_ICON_URI}}', ''],
        ]);
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

    return fillSlots(template, [
        ...slots,
        ['{{MARKED_URI}}', versioned('vendor/marked.min.js')],
        ['{{HIGHLIGHT_URI}}', versioned('vendor/highlight.min.js')],
        ['{{HIGHLIGHT_CSS_URI}}', versioned('vendor/' + highlightSheetFor(input.themeKind))],
        ['{{PURIFY_URI}}', versioned('vendor/purify.min.js')],
        ['{{CHAT_CSS_URI}}', versioned('chat.css')],
        ['{{PANE_CSS_URI}}', versioned('pane.css')],
        ['{{CHAT_JS_URI}}', versioned('pane.js')],
        ['{{SECONDANT_ICON_URI}}', versioned('icon_orange.svg')],
        ['{{LOADING_ICON_URI}}', versioned(identityArtwork(identity().role))],
        // A `<` inside the payload must not be able to close the inline script it sits in.
        ['{{LOCALE_JSON}}', JSON.stringify(input.locale).replace(/</g, '\\u003c')],
    ]);
}
