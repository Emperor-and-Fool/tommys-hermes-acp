import { identity } from '../../shared/extensionId';
import type { LocaleKey } from '../../shared/i18n';
import { t } from '../i18n';
import { HERMES_DEFAULT_PROFILE, normalizeHermesCliProfile } from '../environment/hermesProfile';
import type { Credentials } from '../environment/providerKey';
import type { PresenceRow } from '../store/presence';
import { pricingBadge, pricingPeriod } from './pricing';
import type { PricingPeriod } from './pricing';
import type { DeepSeekBalanceInfo, DeepSeekResult } from './providers/deepseek';

/**
 * The window's budget item: which agent, whether it is connected, and what is left on its account.
 *
 * The primary owns the item, because a window shows one; the secondant's pane reaches it through the
 * same presence row every picker already reads — its agent, and when it was last used. The agent the
 * item answers for is the one whose pane was used last, so it follows a switch in either pane.
 *
 * A balance is read on start, on a click, on a switch and once a minute, and each key's reading is
 * kept for a minute: two profiles that share one key cost one call. The key itself stays in the
 * cache's name and nowhere else — not in a line, a tooltip, a notice or a message.
 */

/** How often the balances are read again: DeepSeek's numbers move slowly. */
const REFRESH_MS = 60_000;

/** A reading this fresh is drawn without asking the provider again. */
const CACHE_MS = 60_000;

/** Below this the item warns on its own, before a turn has had to fail to say it. */
const LOW_BALANCE = 10;

/** The one provider this build knows a balance endpoint for. */
const DEEPSEEK_PROVIDER = 'deepseek';

/** Which of the two panes, and how its link stands. */
export type LinkState = 'off' | 'connecting' | 'on';

/** What the item is told: every word decided here, nothing of the editor (F4, F6). */
export interface BudgetView {
    text: string;
    /** Plain markdown, one line per row; the item turns it into the editor's own tooltip. */
    tooltip: string;
    /**
     * A background, and the only two the editor allows. Either one also brings the theme's paired
     * foreground, so nothing here chooses a colour: a connected pane keeps the status bar's own.
     */
    background?: 'error' | 'warning';
}

/** The editor's status bar item, as the feature sees it (`editor/statusBar.ts` answers). */
export interface BudgetItem {
    /** Put it on screen. A window that never calls this never draws one. */
    show(): void;
    set(view: BudgetView): void;
    /** The user clicked the item: the feature decides what that means. */
    onClick(handler: () => void): void;
    dispose(): void;
}

/** A balance, or the words for why there is none to show. */
export interface BudgetLine {
    /** `12.34`, and the currency it is in: empty when there is no amount to show. */
    amount: string;
    currency: string;
    low: boolean;
    /** The billing period now, for a provider whose clock this build knows. */
    period?: PricingPeriod;
    /** Why no amount is shown. Empty when one is. */
    reason: string;
}

/** What the feature asks of the rest of the extension. */
export interface BudgetHost {
    item: BudgetItem;
    /** This pane: the agent it runs, the label the chip shows, whether a client is up. */
    own(): { profile: string; label: string; connected: boolean };
    /** The window's other pane, when the presence table holds a row for it. */
    other(): PresenceRow | undefined;
    /** Told when that table changes: the other pane switched agent or was used. */
    watch(handler: () => void): () => void;
    /** A profile's provider and key, read from Hermes' own files (`environment/providerKey.ts`). */
    credentials(profile: string): Credentials;
    /** One balance call, as `providers/deepseek.ts` makes it. */
    balance(key: string): Promise<DeepSeekResult>;
    log(line: string): void;
}

export class Budget {
    private _timer?: ReturnType<typeof setInterval>;
    private _unwatch?: () => void;
    /** A connect in flight: a status, not a client — the pane is between the two. */
    private _connecting = false;
    /** When this pane was last used. The other pane's row carries its own moment. */
    private _activeAt = 0;
    /** One reading per key, and the key is the map's name and is kept nowhere else. */
    private readonly _cache = new Map<string, { at: number; result: DeepSeekResult }>();
    /** What the item has to say about each profile it may name. */
    private readonly _lines = new Map<string, BudgetLine>();
    private _reading?: Promise<void>;

    constructor(private readonly _host: BudgetHost) {}

    /**
     * Draw the item, and keep it fresh.
     *
     * Only the primary: the secondant draws nothing, because one window shows one item and the two
     * panes share it. This pane counts as used at the start, so the item begins on its own agent.
     */
    start(): void {
        if (!this._owns()) {
            return;
        }
        this._activeAt = Date.now();
        this._host.item.show();
        this._host.item.onClick(() => void this.refresh());
        this._unwatch = this._host.watch(() => this.tick());
        void this.tick();
        this._timer = setInterval(() => void this.refresh(), REFRESH_MS);
    }

    /** This pane was used: the item answers for it until the other pane is used. */
    touch(): void {
        this._activeAt = Date.now();
        void this.tick();
    }

    /** The pane's link moved. `connecting` is a status; every other one settles the item. */
    noteStatus(status: string): void {
        this._connecting = status === 'connecting';
        void this.tick();
    }

    /** Something changed: draw what is known now, then read what is not. */
    tick(): Promise<void> {
        if (!this._owns()) {
            return Promise.resolve();
        }
        this._render();
        return this._read(false);
    }

    /** The user clicked: read the balances again instead of trusting the cache. */
    refresh(): Promise<void> {
        return this._owns() ? this._read(true) : Promise.resolve();
    }

    dispose(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
        this._unwatch?.();
        this._unwatch = undefined;
        this._host.item.dispose();
    }

    /** One item per window, and the primary draws it: a secondant has nothing to draw or to ask. */
    private _owns(): boolean {
        return identity().role === 'primary';
    }

    /** The profiles the item may name: this pane's agent, and the other pane's. */
    private _profiles(): string[] {
        const own = this._host.own().profile;
        const other = this._host.other()?.cliProfile || '';
        return [...new Set([own, other].filter(Boolean))];
    }

    /** Read every profile that has no fresh reading. One read at a time; a second call joins it. */
    private _read(force: boolean): Promise<void> {
        if (this._reading) {
            return this._reading;
        }
        const profiles = this._profiles();
        if (!profiles.length) {
            return Promise.resolve();
        }
        const reading = (async () => {
            try {
                for (const profile of profiles) {
                    await this._load(profile, force);
                }
            } finally {
                this._reading = undefined;
            }
            this._render();
        })();
        this._reading = reading;
        return reading;
    }

    /** One profile's line: from the cache, or from one call to the provider. */
    private async _load(profile: string, force: boolean): Promise<void> {
        const { provider, key, keyName } = this._host.credentials(profile);
        if (provider !== DEEPSEEK_PROVIDER) {
            this._lines.set(profile, {
                amount: '',
                currency: '',
                low: false,
                reason: provider ? t('budgetNoApi', provider) : t('budgetNoProvider'),
            });
            return;
        }
        if (!key) {
            // The variable is named, never the value: there is none to name.
            this._lines.set(profile, { amount: '', currency: '', low: false, reason: t('budgetNoKey', keyName) });
            return;
        }
        const cached = this._cache.get(key);
        if (!force && cached && Date.now() - cached.at < CACHE_MS) {
            this._lines.set(profile, lineOf(cached.result, new Date()));
            return;
        }
        const result = await this._host.balance(key);
        this._cache.set(key, { at: Date.now(), result });
        this._lines.set(profile, lineOf(result, new Date()));
        if (!result.ok) {
            this._host.log(`Budget: balance unavailable for "${profile}": ${result.reason}`);
        }
    }

    /** The pane the item answers for: this one, unless the table says the other one was used later. */
    private _shown(): { profile: string; label: string; link: LinkState } {
        const own = this._host.own();
        const link = this._ownLink();
        const other = this._host.other();
        if (!other || other.activeAt <= this._activeAt) {
            return { profile: own.profile, label: own.label, link };
        }
        return { profile: other.cliProfile, label: labelFor(other.cliProfile), link: 'on' };
    }

    /** This pane's link: a connect in flight, a client that is up, or neither. */
    private _ownLink(): LinkState {
        // The status wins over the client object: `AcpClient` exists while its `start()` is still
        // running, and a pane that is still connecting must not claim to be connected.
        if (this._connecting) {
            return 'connecting';
        }
        return this._host.own().connected ? 'on' : 'off';
    }

    private _render(): void {
        const shown = this._shown();
        const line = this._lines.get(shown.profile);
        const amount = shown.link === 'on' && line && line.amount
            ? ` · ${line.amount} ${line.currency}${line.period ? ` ${pricingBadge(line.period)}` : ''}`
            : '';
        const icon = shown.link === 'connecting'
            ? '$(sync~spin)'
            : shown.link === 'off'
                ? '$(circle-slash)'
                : line && line.low
                    ? '$(warning)'
                    : '$(dashboard)';
        const low = shown.link === 'on' && !!line && line.low;
        this._host.item.set({
            text: `${icon} ${shown.label}${amount}`,
            tooltip: this._tooltip(shown),
            background: shown.link === 'off' ? 'error' : low ? 'warning' : undefined,
        });
    }

    /** Both panes of the window, what is known of each, and what a click does. */
    private _tooltip(shown: { profile: string; label: string; link: LinkState }): string {
        const own = this._host.own();
        const other = this._host.other();
        const rows = [this._paneLine(identity().role, own.label, this._ownLink(), this._lines.get(own.profile))];
        if (other) {
            rows.push(this._paneLine(other.role, labelFor(other.cliProfile), 'on', this._lines.get(other.cliProfile)));
        }
        const line = this._lines.get(shown.profile);
        if (line && line.period) {
            rows.push(`${t(line.period === 'peak' ? 'budgetPeak' : 'budgetOffPeak')} · ${t('budgetPeakHours')}`);
        }
        rows.push(t('budgetClickRefresh'));
        return rows.join('\n');
    }

    /** One pane, as the tooltip reads it: whose it is, how its link stands, and its money. */
    private _paneLine(role: 'primary' | 'secondant', label: string, link: LinkState, line?: BudgetLine): string {
        const state = link === 'on' ? t('budgetConnected') : link === 'connecting' ? t('budgetConnecting') : t('budgetNotConnected');
        const parts = [`${t(ROLE_KEYS[role])} · ${label}`, state];
        if (link !== 'on') {
            // Nothing is spent on a pane that is not connected, so nothing is claimed about it.
            return parts.join(' · ');
        }
        if (line && line.amount) {
            parts.push(`${line.amount} ${line.currency}${line.period ? ` ${pricingBadge(line.period)}` : ''}`);
        } else if (line && line.reason) {
            parts.push(line.reason);
        }
        return parts.join(' · ');
    }
}

/** The two panes, named in the user's language. */
const ROLE_KEYS: Record<'primary' | 'secondant', LocaleKey> = {
    primary: 'budgetPrimary',
    secondant: 'budgetSecondant',
};

/** A profile's name as the user reads it: the default profile has a translated one. */
function labelFor(cliProfile: string): string {
    return normalizeHermesCliProfile(cliProfile) === HERMES_DEFAULT_PROFILE ? t('defaultAgent') : cliProfile;
}

/** The currency to show: dollars when the account has them, then yuan, then whatever is first. */
function preferred(infos: DeepSeekBalanceInfo[]): DeepSeekBalanceInfo | undefined {
    return infos.find(info => info.currency.toUpperCase() === 'USD')
        ?? infos.find(info => info.currency.toUpperCase() === 'CNY')
        ?? infos[0];
}

/** What the item says about a profile, from one reading of its account. */
function lineOf(result: DeepSeekResult, at: Date): BudgetLine {
    if (!result.ok) {
        return { amount: '', currency: '', low: false, reason: t('budgetUnavailable', result.reason) };
    }
    const info = preferred(result.reading.infos);
    if (!result.reading.available || !info) {
        return { amount: '', currency: '', low: false, reason: t('budgetUnavailable', t('budgetNothingToShow')) };
    }
    return {
        amount: info.total.toFixed(2),
        currency: info.currency,
        low: info.total < LOW_BALANCE,
        period: pricingPeriod(at),
        reason: '',
    };
}
