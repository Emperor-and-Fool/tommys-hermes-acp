/**
 * Which URLs a message body may open in the user's browser.
 *
 * The pane only renders `http(s)` links as clickable, but the host is the trust boundary and the same
 * message channel carries anything: `command:`, `vscode:` and `file:` all reach
 * `vscode.env.openExternal`, which dispatches them. Allowlist, not denylist.
 */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** True only for an absolute URL on a scheme that belongs outside the editor. */
export function isExternalLinkAllowed(url: string): boolean {
    if (!url) {
        return false;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // Relative, protocol-relative or malformed: nothing to vouch for.
        return false;
    }
    return EXTERNAL_SCHEMES.has(parsed.protocol.toLowerCase());
}
