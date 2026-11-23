import * as assert from 'assert';
import { Budget } from '../../host/budget/budget';
import type { BudgetItem, BudgetView } from '../../host/budget/budget';
import type { DeepSeekResult } from '../../host/budget/providers/deepseek';
import type { Credentials } from '../../host/environment/providerKey';
import type { PresenceRow } from '../../host/store/presence';
import { PRIMARY, SECONDANT, setActiveIdentity } from '../../shared/extensionId';

/** The item, as a test sees it: what it was told, and whether it is on screen. */
class FakeItem implements BudgetItem {
    view?: BudgetView;
    shown = false;
    disposed = false;
    private _clicked?: () => void;

    show(): void { this.shown = true; }
    set(view: BudgetView): void { this.view = view; }
    onClick(handler: () => void): void { this._clicked = handler; }
    click(): void { this._clicked?.(); }
    dispose(): void { this.disposed = true; }
}

/** A reading the item can draw: one currency, plenty of money. */
function reading(total: number, currency = 'USD'): DeepSeekResult {
    return { ok: true, reading: { available: true, infos: [{ currency, total, granted: 0, toppedUp: total }] } };
}

/** One row of the presence table, with a moment of use the test chooses. */
function row(profile: string, activeAt: number): PresenceRow {
    return { instanceId: `id-${profile}`, role: 'secondant', cliProfile: profile, liveAt: Date.now(), activeAt };
}

interface HarnessOptions {
    connected?: boolean;
    other?: PresenceRow;
    credentials?: Credentials;
    balance?: (key: string) => Promise<DeepSeekResult>;
}

function harness(options: HarnessOptions = {}) {
    const item = new FakeItem();
    const state = {
        connected: options.connected ?? true,
        other: options.other,
        credentials: options.credentials ?? { provider: 'deepseek', key: 'sk-test', keyName: 'DEEPSEEK_API_KEY' },
        answer: options.balance ?? (async () => reading(42.5)),
    };
    const calls: string[] = [];
    let watched = 0;
    const budget = new Budget({
        item,
        own: () => ({ profile: 'dev-vsc', label: 'dev-vsc', connected: state.connected }),
        other: () => state.other,
        watch: () => {
            watched += 1;
            return () => undefined;
        },
        credentials: () => state.credentials,
        balance: (key) => {
            calls.push(key);
            return state.answer(key);
        },
        log: () => undefined,
    });
    return { item, budget, state, calls, watched: () => watched };
}

/** The item's text, once something has been drawn. */
function textOf(item: FakeItem): string {
    assert.ok(item.view, 'the item was told what to draw');
    return item.view.text;
}

function tooltipOf(item: FakeItem): string {
    assert.ok(item.view, 'the item was told what to draw');
    return item.view.tooltip;
}

describe('the budget item’s states', () => {
    it('says it is not connected, with no cost beside it', async () => {
        const h = harness({ connected: false });
        try {
            await h.budget.refresh();
            assert.strictEqual(textOf(h.item), '$(circle-slash) dev-vsc');
            assert.strictEqual(h.item.view?.background, 'error');
            assert.ok(!textOf(h.item).includes('42.50'), 'no amount on a pane that is down');
        } finally {
            h.budget.dispose();
        }
    });

    it('spins while a connect is in flight, even when a client object already exists', async () => {
        const h = harness();
        try {
            // `AcpClient` is built before its `start()` resolves: the status is the truth, not the object.
            h.budget.noteStatus('connecting');
            assert.strictEqual(textOf(h.item), '$(sync~spin) dev-vsc');
            assert.strictEqual(h.item.view?.background, undefined);

            h.state.connected = false;
            h.budget.noteStatus('ready');
            assert.strictEqual(textOf(h.item), '$(circle-slash) dev-vsc', 'ready settles it; no client is there');
        } finally {
            h.budget.dispose();
        }
    });

    it('draws the amount and currency in the status bar’s own colour when connected', async () => {
        const h = harness();
        try {
            await h.budget.refresh();
            assert.match(textOf(h.item), /^\$\(dashboard\) dev-vsc · 42\.50 USD \$\((flame|moon)\)$/);
            assert.strictEqual(h.item.view?.background, undefined, 'no background of its own');
            assert.ok(tooltipOf(h.item).includes('connected'));
        } finally {
            h.budget.dispose();
        }
    });

    it('warns under ten, on the warning background', async () => {
        const h = harness({ balance: async () => reading(3.2) });
        try {
            await h.budget.refresh();
            assert.match(textOf(h.item), /^\$\(warning\) dev-vsc · 3\.20 USD \$\((flame|moon)\)$/);
            assert.strictEqual(h.item.view?.background, 'warning');
        } finally {
            h.budget.dispose();
        }
    });

    it('shows the agent alone when the provider has no balance API', async () => {
        const h = harness({ credentials: { provider: 'custom:hgsene', key: '', keyName: 'DEEPSEEK_API_KEY' } });
        try {
            await h.budget.refresh();
            assert.strictEqual(textOf(h.item), '$(dashboard) dev-vsc');
            assert.ok(tooltipOf(h.item).includes('no balance API for the "custom:hgsene" provider'));
            assert.deepStrictEqual(h.calls, [], 'nothing is asked of an endpoint that does not exist');
        } finally {
            h.budget.dispose();
        }
    });

    it('keeps the connection when the balance call fails, and says why in the tooltip', async () => {
        const h = harness({ balance: async () => ({ ok: false, reason: 'HTTP 401' }) });
        try {
            await h.budget.refresh();
            assert.strictEqual(textOf(h.item), '$(dashboard) dev-vsc');
            assert.ok(tooltipOf(h.item).includes('balance unavailable: HTTP 401'));
        } finally {
            h.budget.dispose();
        }
    });

    it('names the missing variable, never a value, when no key is in the profile', async () => {
        const h = harness({ credentials: { provider: 'deepseek', key: '', keyName: 'DEEPSEEK_API_KEY' } });
        try {
            await h.budget.refresh();
            assert.strictEqual(textOf(h.item), '$(dashboard) dev-vsc');
            assert.ok(tooltipOf(h.item).includes('no DEEPSEEK_API_KEY in the profile'));
            assert.deepStrictEqual(h.calls, [], 'no key, no call');
        } finally {
            h.budget.dispose();
        }
    });

    it('answers for the pane used last, and follows a switch back', async () => {
        const h = harness();
        try {
            h.budget.touch();
            assert.ok(textOf(h.item).includes('dev-vsc'), 'this pane is the used one');

            h.state.other = row('kitt', Date.now() + 1_000);
            await h.budget.tick();
            assert.match(textOf(h.item), /kitt/, 'the other pane was used later');

            h.state.other = row('kitt', 0);
            h.budget.touch();
            assert.match(textOf(h.item), /dev-vsc/, 'and this one takes it back');
        } finally {
            h.budget.dispose();
        }
    });

    it('names both agents in the tooltip, each with its own link', async () => {
        const h = harness({ other: row('kitt', 0) });
        try {
            await h.budget.refresh();
            const tooltip = tooltipOf(h.item);
            assert.ok(tooltip.includes('primary agent · dev-vsc · connected'), tooltip);
            assert.ok(tooltip.includes('secondant agent · kitt · connected'), tooltip);
            assert.ok(tooltip.includes('Click to refresh'), tooltip);
        } finally {
            h.budget.dispose();
        }
    });

    it('reads a key once a minute: a click, or a new key, is what asks again', async () => {
        const h = harness();
        try {
            await h.budget.tick();
            await h.budget.tick();
            assert.strictEqual(h.calls.length, 1, 'the reading is cached by key');

            await h.budget.refresh();
            assert.strictEqual(h.calls.length, 2, 'a click is a fresh read');

            h.state.credentials = { provider: 'deepseek', key: 'sk-other', keyName: 'DEEPSEEK_API_KEY' };
            await h.budget.tick();
            assert.deepStrictEqual(h.calls, ['sk-test', 'sk-test', 'sk-other']);
        } finally {
            h.budget.dispose();
        }
    });

    it('is drawn by the primary only, and watches the table for the other pane', async () => {
        const h = harness();
        try {
            setActiveIdentity(SECONDANT);
            h.budget.start();
            assert.strictEqual(h.item.shown, false, 'the secondant draws no item');
            assert.strictEqual(h.watched(), 0);

            setActiveIdentity(PRIMARY);
            h.budget.start();
            await h.budget.tick();
            assert.strictEqual(h.item.shown, true);
            assert.strictEqual(h.watched(), 1, 'the table is watched for the other pane');
            assert.strictEqual(h.calls.length, 1, 'start reads the balance once');
        } finally {
            setActiveIdentity(PRIMARY);
            h.budget.dispose();
            assert.strictEqual(h.item.disposed, true);
        }
    });

    it('never puts the key in the text or the tooltip', async () => {
        const secret = 'sk-very-secret-value';
        const h = harness({
            credentials: { provider: 'deepseek', key: secret, keyName: 'DEEPSEEK_API_KEY' },
            balance: async () => ({ ok: false, reason: 'HTTP 500' }),
        });
        try {
            await h.budget.refresh();
            assert.ok(!textOf(h.item).includes(secret));
            assert.ok(!tooltipOf(h.item).includes(secret));
        } finally {
            h.budget.dispose();
        }
    });
});
