import type { PaneToHost } from '../shared/webview';

/** The one handle on the host. */
const vscode = acquireVsCodeApi();

/** Send one message to the extension host. */
export function post(msg: PaneToHost): void {
    vscode.postMessage(msg as any);
}

/** Report one line to the extension host's output channel (no devtools needed). */
export function hostLog(line: string): void {
    try {
        post({ type: 'webviewLog', line: String(line) } as any);
    } catch (err) {
        /* ignore */
    }
}
