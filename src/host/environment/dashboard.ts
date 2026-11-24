import * as http from 'http';

/**
 * The dashboard on this machine: one port, and one honest question about it.
 *
 * Hermes' dashboard listens on 127.0.0.1:9119 unless told otherwise (`HERMES_DASHBOARD_PORT`). Both
 * platforms start it the same way and both read the same fact — does it answer — so the check lives
 * here rather than in two branches that would drift.
 */
export const DASHBOARD_PORT = 9119;

/**
 * Whether something answers on the dashboard port.
 *
 * Any HTTP answer counts: a page, a redirect or an error page all mean a server is listening, which
 * is what "already running" means. A refused connection, or no answer in time, means it is not.
 */
export function isDashboardServing(port: number = DASHBOARD_PORT, timeoutMs = 1200): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (answer: boolean): void => {
            if (!settled) {
                settled = true;
                resolve(answer);
            }
        };
        const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (response) => {
            response.resume();
            finish(true);
        });
        request.on('timeout', () => {
            request.destroy();
            finish(false);
        });
        request.on('error', () => finish(false));
    });
}
