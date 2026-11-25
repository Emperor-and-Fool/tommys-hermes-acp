/**
 * Which patches in `packaging/hermes-patches/` a given Hermes version needs, and what each one is.
 *
 * The table is `packaging/hermes-patches/README.md`'s, in code because the extension has to *name*
 * and *find* the patches: when Hermes does not answer the session catalog the failure is a missing
 * set, and when the checkout carries the wrong set the fix is to reverse it. Pure — no editor, no
 * Hermes, no disk — so the mapping is testable without any of them.
 */
export interface HermesPatch {
    /** As the docs and the notices name it: `0001`. */
    id: string;
    /** The file inside the patch folder. */
    file: string;
}

export interface HermesPatchSet {
    /** The set as a notice names it: `0003`, or `0001 + 0002`. */
    label: string;
    /** The patches in the order they have to be applied. */
    patches: HermesPatch[];
    /** The files inside the patch folder, in application order. */
    files: string[];
}

/** Where the patches live inside an installed extension. */
export const PATCH_FOLDER = 'packaging/hermes-patches';

export const PATCH_0001: HermesPatch = {
    id: '0001',
    file: '0001-acp-session-catalog-hidden-title.patch',
};
export const PATCH_0002: HermesPatch = {
    id: '0002',
    file: '0002-acp-gateway-ext-methods.patch',
};
export const PATCH_0003: HermesPatch = {
    id: '0003',
    file: '0003-acp-023x-session-catalog-hidden-title.patch',
};

/** Every patch this extension ships. A wrong set is reversed in the reverse of this order. */
export const ALL_PATCHES: readonly HermesPatch[] = [PATCH_0001, PATCH_0002, PATCH_0003];

/**
 * The patches one Hermes version needs, or `[]` for a version no patch was cut against.
 *
 * Empty is an answer, not a failure: 0.22.0/0.22.1 and 0.24 and later have no set, and the notice
 * says so instead of pointing at a patch that would not apply.
 */
export function requiredPatches(hermesVersion: string): readonly HermesPatch[] {
    const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(hermesVersion || '');
    if (!match) {
        return [];
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const fix = Number(match[3]);
    if (major !== 0) {
        return [];
    }
    if (minor === 22 && fix >= 2 && fix <= 4) {
        return [PATCH_0001];
    }
    if (minor === 22 && fix >= 5) {
        return [PATCH_0001, PATCH_0002];
    }
    if (minor === 23) {
        return [PATCH_0003];
    }
    return [];
}

/**
 * The set for one Hermes version, or undefined for a version no patch was cut against.
 *
 * This is the notice's form: a label to name, and the files behind it.
 */
export function patchSetFor(hermesVersion: string): HermesPatchSet | undefined {
    const patches = [...requiredPatches(hermesVersion)];
    if (!patches.length) {
        return undefined;
    }
    return {
        label: patches.map(patch => patch.id).join(' + '),
        patches,
        files: patches.map(patch => patch.file),
    };
}
