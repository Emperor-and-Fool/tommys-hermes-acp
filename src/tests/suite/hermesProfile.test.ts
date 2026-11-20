import { describe, it } from 'mocha';
import assert from 'assert';
import { HERMES_DEFAULT_PROFILE, cliProfileForScopeKey, normalizeHermesCliProfile, scopeKeyForCliProfile } from '../../host/environment/hermesProfile';

describe('hermesProfile', () => {
    it('normalizeHermesCliProfile maps empty values to default', () => {
        assert.strictEqual(normalizeHermesCliProfile(undefined), HERMES_DEFAULT_PROFILE);
        assert.strictEqual(normalizeHermesCliProfile(''), HERMES_DEFAULT_PROFILE);
        assert.strictEqual(normalizeHermesCliProfile('default'), HERMES_DEFAULT_PROFILE);
    });

    it('normalizeHermesCliProfile preserves named profiles', () => {
        assert.strictEqual(normalizeHermesCliProfile('jove'), 'jove');
        assert.strictEqual(normalizeHermesCliProfile('  rina  '), 'rina');
    });

    it('scopeKeyForCliProfile maps default profile to __default__', () => {
        assert.strictEqual(scopeKeyForCliProfile('default'), '__default__');
        assert.strictEqual(scopeKeyForCliProfile(''), '__default__');
        assert.strictEqual(scopeKeyForCliProfile('jove'), 'jove');
    });

    it('cliProfileForScopeKey is the inverse the seed needs', () => {
        assert.strictEqual(cliProfileForScopeKey('__default__'), HERMES_DEFAULT_PROFILE);
        assert.strictEqual(cliProfileForScopeKey('dev-vsc'), 'dev-vsc');
        assert.strictEqual(cliProfileForScopeKey(scopeKeyForCliProfile('kitt')), 'kitt');
        assert.strictEqual(cliProfileForScopeKey(scopeKeyForCliProfile('default')), 'default');
    });
});
