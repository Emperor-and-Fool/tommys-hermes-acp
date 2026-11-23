import * as assert from 'assert';
import { DEEPSEEK_BALANCE_ENDPOINT, fetchDeepSeekBalance } from '../../host/budget/providers/deepseek';

/** The endpoint's real answer: `is_available`, and amounts as decimal strings. */
const ANSWER = {
    is_available: true,
    balance_infos: [
        { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: '12.34', granted_balance: '0.00', topped_up_balance: '12.34' },
    ],
};

/** A fetch that answers once, and records what it was asked. */
function responder(body: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = (async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchFn, calls };
}

describe('the DeepSeek balance call', () => {
    it('reads the currencies, with the amounts as numbers', async () => {
        const fake = responder(ANSWER);
        const result = await fetchDeepSeekBalance('sk-test', { fetch: fake.fetchFn });

        assert.strictEqual(result.ok, true);
        if (!result.ok) {
            return;
        }
        assert.strictEqual(result.reading.available, true);
        assert.deepStrictEqual(result.reading.infos, [
            { currency: 'CNY', total: 110, granted: 10, toppedUp: 100 },
            { currency: 'USD', total: 12.34, granted: 0, toppedUp: 12.34 },
        ]);
    });

    it('asks the endpoint once, with the key in the header and nowhere else', async () => {
        const fake = responder(ANSWER);
        await fetchDeepSeekBalance('sk-test', { fetch: fake.fetchFn });

        assert.strictEqual(fake.calls.length, 1);
        assert.strictEqual(fake.calls[0].url, DEEPSEEK_BALANCE_ENDPOINT);
        assert.strictEqual(fake.calls[0].init?.method, 'GET');
        const headers = fake.calls[0].init?.headers as Record<string, string>;
        assert.strictEqual(headers.Authorization, 'Bearer sk-test');
    });

    it('reports a refusal as its status, without the key', async () => {
        const fake = responder({ error: 'no' }, 401);
        const result = await fetchDeepSeekBalance('sk-test', { fetch: fake.fetchFn });

        assert.strictEqual(result.ok, false);
        if (result.ok) {
            return;
        }
        assert.strictEqual(result.reason, 'HTTP 401');
        assert.ok(!result.reason.includes('sk-test'), 'the key is never in a reason');
    });

    it('reports an answer that is not a balance', async () => {
        const fake = responder({ is_available: 'yes' });
        const result = await fetchDeepSeekBalance('sk-test', { fetch: fake.fetchFn });

        assert.strictEqual(result.ok, false);
        if (result.ok) {
            return;
        }
        assert.strictEqual(result.reason, 'not a balance answer');
    });

    it('gives up on its own deadline instead of hanging', async () => {
        // The fake never answers; only the abort ends it.
        const fetchFn = ((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch;

        const result = await fetchDeepSeekBalance('sk-test', { fetch: fetchFn, timeoutMs: 250 });

        assert.strictEqual(result.ok, false);
        if (result.ok) {
            return;
        }
        assert.match(result.reason, /timed out/);
    });
});
