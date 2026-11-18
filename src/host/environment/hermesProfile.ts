/** Hermes built-in default profile id (`hermes --profile default`). */
export const HERMES_DEFAULT_PROFILE = 'default';

/** Normalize settings / UI values into a Hermes CLI `--profile` argument. */
export function normalizeHermesCliProfile(profile?: string | null): string {
    const trimmed = (profile ?? '').trim();
    if (!trimmed || trimmed === HERMES_DEFAULT_PROFILE) {
        return HERMES_DEFAULT_PROFILE;
    }
    return trimmed;
}

/** Map a CLI profile id to a stable on-disk storage scope key. */
export function scopeKeyForCliProfile(profile?: string | null): string {
    const normalized = normalizeHermesCliProfile(profile);
    if (normalized === HERMES_DEFAULT_PROFILE) {
        return '__default__';
    }
    return normalized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || '__default__';
}

/**
 * The CLI profile a storage scope key stands for: the inverse of `scopeKeyForCliProfile`.
 *
 * Needed when a folder in our data home is the only trace of a profile — the seed gives each of
 * them a row, and the row carries the name Hermes would use, not the folder.
 */
export function cliProfileForScopeKey(scopeKey: string): string {
    return scopeKey === '__default__' ? HERMES_DEFAULT_PROFILE : scopeKey;
}
