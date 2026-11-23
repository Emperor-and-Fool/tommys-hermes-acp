/**
 * Which patches in `packaging/hermes-patches/` a given Hermes version needs.
 *
 * The table is `packaging/hermes-patches/README.md`'s, in code because the extension has to *name*
 * the patch when Hermes does not answer the session catalog: the failure is the patch's absence,
 * and "Internal error" on its own leaves the user with nothing to do. Pure — no editor, no Hermes —
 * so the mapping is testable without either.
 */
export interface HermesPatchSet {
    /** The set as a notice names it: `0003`, or `0001 + 0002`. */
    label: string;
    /** The files inside the patch folder, in the order they have to be applied. */
    files: string[];
}

/** Where the patches live inside an installed extension. */
export const PATCH_FOLDER = 'packaging/hermes-patches';

const PATCH_0001 = '0001-acp-session-catalog-hidden-title.patch';
const PATCH_0002 = '0002-acp-gateway-ext-methods.patch';
const PATCH_0003 = '0003-acp-023x-session-catalog-hidden-title.patch';

/**
 * The set for one Hermes version, or undefined for a version no patch was cut against.
 *
 * Undefined is an answer, not a failure: 0.22.0/0.22.1 and 0.24 and later have no set, and the
 * notice says so instead of pointing at a patch that would not apply.
 */
export function patchSetFor(hermesVersion: string): HermesPatchSet | undefined {
    const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(hermesVersion || '');
    if (!match) {
        return undefined;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const fix = Number(match[3]);
    if (major !== 0) {
        return undefined;
    }
    if (minor === 22 && fix >= 2 && fix <= 4) {
        return { label: '0001', files: [PATCH_0001] };
    }
    if (minor === 22 && fix >= 5) {
        return { label: '0001 + 0002', files: [PATCH_0001, PATCH_0002] };
    }
    if (minor === 23) {
        return { label: '0003', files: [PATCH_0003] };
    }
    return undefined;
}
