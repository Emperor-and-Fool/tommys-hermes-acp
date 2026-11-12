/**
 * The one writer of `approvals.mode`, and the only place that runs the CLI for it.
 *
 * Storage of record is Hermes' own `config.yaml`; this holds no truth of its own, just the last
 * answer so a surface can render before the read returns. The cache is refreshed per card rather
 * than kept for a session, because the mode can be changed in a terminal and a stale answer would
 * make the switch lie about what Hermes will do next.
 *
 * No `vscode` import: the CLI runner is injected (default: the real one), so the whole thing is
 * testable without an editor.
 */
import { runHermesCommand } from '../environment/profileDiscovery';
import { normalizeHermesCliProfile } from '../environment/hermesProfile';
import { parseApprovalMode, type SettableApprovalMode } from './approvalModeRules';
import type { ApprovalMode } from '../../shared/webview';

/** Same shape as `runHermesCommand`: executable plus args, stdout back, reject on a non-zero exit. */
export type HermesRunner = (executable: string, args: string[]) => Promise<string>;

export class ApprovalModeControl {
    private readonly _last = new Map<string, ApprovalMode>();
    private readonly _inflight = new Map<string, Promise<ApprovalMode>>();
    /** How many glob patterns `approvals.deny` holds, as last read. */
    private readonly _denyCount = new Map<string, number>();

    constructor(private readonly _run: HermesRunner = runHermesCommand) {}

    /** What the last read returned, or `unknown`. Cheap: never spawns. */
    last(profile: string): ApprovalMode {
        return this._last.get(profile) ?? 'unknown';
    }

    /**
     * Re-read the profile's mode from Hermes. Callers asking at the same time share one spawn, so
     * a card opening while the row is fetching costs one CLI call, not two.
     */
    read(executable: string, profile: string): Promise<ApprovalMode> {
        const running = this._inflight.get(profile);
        if (running) {
            return running;
        }
        const pending = (async () => {
            let mode: ApprovalMode = 'unknown';
            try {
                const raw = await this._run(executable, [
                    '--profile', normalizeHermesCliProfile(profile),
                    'config', 'get', 'approvals.mode',
                ]);
                mode = parseApprovalMode(raw);
            } catch {
                mode = 'unknown';
            }
            this._last.set(profile, mode);
            return mode;
        })().finally(() => {
            this._inflight.delete(profile);
        });
        this._inflight.set(profile, pending);
        return pending;
    }

    /** Write the profile's mode. True when the CLI took it, and the cache follows on success. */
    async write(executable: string, profile: string, mode: SettableApprovalMode): Promise<boolean> {
        try {
            await this._run(executable, [
                '--profile', normalizeHermesCliProfile(profile),
                'config', 'set', 'approvals.mode', mode,
            ]);
        } catch {
            return false;
        }
        this._last.set(profile, mode);
        return true;
    }

    /** What the last read said about the user's own block list. 0 with no read is the honest default. */
    lastDenyCount(profile: string): number {
        return this._denyCount.get(profile) ?? 0;
    }

    /**
     * The entries in `approvals.deny`. A list key, so the CLI prints YAML: `[]`, or one
     * `- pattern` line per entry. A failed read reports none — which the UI treats as "nothing of
     * yours is blocking", the state a cleared list produces anyway.
     */
    async readDenyList(executable: string, profile: string): Promise<string[]> {
        let patterns: string[] = [];
        try {
            const raw = await this._run(executable, [
                '--profile', normalizeHermesCliProfile(profile),
                'config', 'get', 'approvals.deny',
            ]);
            const text = (raw || '').trim();
            if (text.startsWith('[')) {
                const parsed = JSON.parse(text);
                patterns = Array.isArray(parsed) ? parsed.filter((item: unknown) => typeof item === 'string') : [];
            } else {
                patterns = text
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.startsWith('- '))
                    .map(line => line.slice(2).trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean);
            }
        } catch {
            patterns = [];
        }
        this._denyCount.set(profile, patterns.length);
        return patterns;
    }

    /** How many entries `approvals.deny` holds, as last read. */
    async readDenyCount(executable: string, profile: string): Promise<number> {
        await this.readDenyList(executable, profile);
        return this.lastDenyCount(profile);
    }

    /** Put patterns back into `approvals.deny` — the restore half of the red action. */
    async writeDenyList(executable: string, profile: string, patterns: string[]): Promise<boolean> {
        try {
            await this._run(executable, [
                '--profile', normalizeHermesCliProfile(profile),
                'config', 'set', 'approvals.deny', JSON.stringify(patterns),
            ]);
        } catch {
            return false;
        }
        this._denyCount.set(profile, patterns.length);
        return true;
    }

    /**
     * Clear `approvals.deny`. This overwrites the list in `config.yaml` and Hermes keeps no history
     * of it, so the entries are gone afterwards — the caller has to say so before calling this.
     */
    async clearDeny(executable: string, profile: string): Promise<boolean> {
        try {
            await this._run(executable, [
                '--profile', normalizeHermesCliProfile(profile),
                'config', 'set', 'approvals.deny', '[]',
            ]);
        } catch {
            return false;
        }
        this._denyCount.set(profile, 0);
        return true;
    }

    /** Another profile, or a reload: forget every cached answer. */
    clear(): void {
        this._last.clear();
        this._inflight.clear();
        this._denyCount.clear();
    }
}
