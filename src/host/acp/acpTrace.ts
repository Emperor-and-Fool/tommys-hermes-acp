/**
 * A dev-only wire trace for ACP `session/update` traffic.
 *
 * Purpose is observation: to build the session-load behaviour on what Hermes actually sends,
 * not on assumptions about order, shape or metadata presence. Off unless `HERMES_ACP_TRACE=1`
 * in the shell that launched the editor.
 *
 * Two sinks on purpose. The OutputChannel is per extension instance, so the secondant cannot
 * see the primary's; the shared file lets either pane tail the other's traffic. No rotation,
 * no cap, no cleanup — delete it by hand when it gets in the way.
 */
import * as fs from 'fs';
import path from 'path';

export const ACP_TRACE_ENV = 'HERMES_ACP_TRACE';

export function acpTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[ACP_TRACE_ENV] === '1';
}

/** `<hermesHome>/pane-mail/trace-<profile>.ndjson` — next to the mailbox, out of the way. */
export function traceFilePath(hermesHome: string, profile: string): string {
    const safe = (profile || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
    return path.join(hermesHome, 'pane-mail', `trace-${safe}.ndjson`);
}

/**
 * Append one update as one line. Returns the line, or null when the write failed — a dev tool
 * must never break the stream it is watching.
 */
export function appendAcpTrace(hermesHome: string, profile: string, update: unknown): string | null {
    let line: string;
    try {
        line = JSON.stringify(update);
    } catch {
        return null;
    }
    if (typeof line !== 'string') {
        return null;
    }
    try {
        fs.mkdirSync(path.dirname(traceFilePath(hermesHome, profile)), { recursive: true });
        fs.appendFileSync(traceFilePath(hermesHome, profile), line + '\n', 'utf8');
        return line;
    } catch {
        return null;
    }
}
