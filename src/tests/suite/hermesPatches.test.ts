/**
 * Which patch set a Hermes version needs, as the notice names it.
 *
 * The table has to agree with `packaging/hermes-patches/README.md`; a wrong row here sends the user
 * to a patch that does not apply, which is worse than saying nothing.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import { patchSetFor } from '../../host/environment/hermesPatches';

describe('the patch set for a Hermes version', () => {
    it('names 0003 for any 0.23.x', () => {
        for (const version of ['0.23.0', '0.23.3', 'v0.23.3', '0.23.3.dev7']) {
            const set = patchSetFor(version);
            assert.ok(set, `${version} has a set`);
            assert.strictEqual(set.label, '0003', version);
            assert.deepStrictEqual(set.files, ['0003-acp-023x-session-catalog-hidden-title.patch'], version);
        }
    });

    it('names 0001 + 0002 from 0.22.5, in that order', () => {
        for (const version of ['0.22.5', '0.22.6', '0.22.12']) {
            const set = patchSetFor(version);
            assert.ok(set, `${version} has a set`);
            assert.strictEqual(set.label, '0001 + 0002', version);
            assert.deepStrictEqual(
                set.files,
                ['0001-acp-session-catalog-hidden-title.patch', '0002-acp-gateway-ext-methods.patch'],
                `${version}: 0002 builds on 0001, so the order is part of the answer`,
            );
        }
    });

    it('names 0001 alone for 0.22.2 - 0.22.4', () => {
        for (const version of ['0.22.2', '0.22.3', '0.22.4']) {
            const set = patchSetFor(version);
            assert.ok(set, `${version} has a set`);
            assert.strictEqual(set.label, '0001', version);
            assert.deepStrictEqual(set.files, ['0001-acp-session-catalog-hidden-title.patch'], version);
        }
    });

    it('answers undefined — not a guess — for a version no patch was cut against', () => {
        for (const version of ['0.22.0', '0.22.1', '0.24.0', '1.0.0', '', 'unknown', 'not a version']) {
            assert.strictEqual(patchSetFor(version), undefined, JSON.stringify(version));
        }
    });
});
