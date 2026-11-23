/**
 * DeepSeek's balance endpoint: one GET, and nothing of the editor (F6).
 *
 * The key arrives as an argument and leaves only as a header. Everything that can go wrong comes
 * back as words the item may show — an HTTP status, a timeout, an answer that was not a balance —
 * and none of those words is the key. `fetch` is injectable, so a test needs no network and no
 * account.
 */
export interface DeepSeekBalanceInfo {
    /** `USD`, `CNY`: as the endpoint spells it, upper-cased. */
    currency: string;
    total: number;
    granted: number;
    toppedUp: number;
}

export interface DeepSeekReading {
    available: boolean;
    infos: DeepSeekBalanceInfo[];
}

/** A reading, or the reason there is none. The reason never carries the key. */
export type DeepSeekResult = { ok: true; reading: DeepSeekReading } | { ok: false; reason: string };

export const DEEPSEEK_BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';

/** Ten seconds, which is the order's number and longer than the endpoint has ever needed. */
const TIMEOUT_MS = 10_000;

export interface DeepSeekOptions {
    /** The network: a test hands it a fake, and the extension hands nothing. */
    fetch?: typeof fetch;
    endpoint?: string;
    timeoutMs?: number;
}

/**
 * Read the account's balance.
 *
 * Never throws: a refusal, a dead endpoint, a timeout and an answer that is not a balance are all
 * answers, so the caller has one shape to draw.
 */
export async function fetchDeepSeekBalance(
    apiKey: string,
    options: DeepSeekOptions = {}
): Promise<DeepSeekResult> {
    const doFetch = options.fetch ?? fetch;
    const endpoint = options.endpoint ?? DEEPSEEK_BALANCE_ENDPOINT;
    const timeoutMs = Math.max(250, options.timeoutMs ?? TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await doFetch(endpoint, {
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
        });
        if (!response.ok) {
            return { ok: false, reason: `HTTP ${response.status}` };
        }
        const body: unknown = await response.json();
        const reading = parseReading(body);
        return reading ? { ok: true, reading } : { ok: false, reason: 'not a balance answer' };
    } catch (error) {
        return {
            ok: false,
            reason: controller.signal.aborted
                ? `timed out after ${Math.round(timeoutMs / 1000)}s`
                : (error instanceof Error ? error.message : String(error)),
        };
    } finally {
        clearTimeout(timer);
    }
}

/** The endpoint's answer, when it is one: `is_available` and a list of per-currency balances. */
function parseReading(value: unknown): DeepSeekReading | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const body = value as Record<string, unknown>;
    if (typeof body.is_available !== 'boolean') {
        return undefined;
    }
    const list = Array.isArray(body.balance_infos) ? body.balance_infos : [];
    const infos: DeepSeekBalanceInfo[] = [];
    for (const raw of list) {
        const info = parseInfo(raw);
        if (info) {
            infos.push(info);
        }
    }
    return { available: body.is_available, infos };
}

/** One currency's line. The amounts arrive as decimal strings and are numbers from here on. */
function parseInfo(value: unknown): DeepSeekBalanceInfo | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const row = value as Record<string, unknown>;
    const currency = typeof row.currency === 'string' ? row.currency.toUpperCase() : '';
    const total = amountOf(row.total_balance);
    if (!currency || total === undefined) {
        return undefined;
    }
    return {
        currency,
        total,
        granted: amountOf(row.granted_balance) ?? 0,
        toppedUp: amountOf(row.topped_up_balance) ?? 0,
    };
}

function amountOf(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
}
