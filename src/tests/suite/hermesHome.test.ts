import * as assert from 'assert';
import { expandHermesHome, resolveDefaultHermesHome } from '../../host/environment/hermesPaths';

/**
 * Hermes' home, the way Hermes builds it (hermes_constants.py:52-64).
 *
 * The platform, the environment and the user's home are injected, so the Windows spellings run here
 * on Linux and are compared with what `os.path.expanduser(os.path.expandvars(path))` would produce.
 */
describe('the Hermes home', () => {
    it('expands what Hermes expands, and leaves what it cannot', () => {
        assert.strictEqual(
            expandHermesHome('%USERPROFILE%\\.hermes', { platform: 'win32', env: { USERPROFILE: 'C:\\Users\\t' } }),
            'C:\\Users\\t\\.hermes',
        );
        assert.strictEqual(expandHermesHome('~/.hermes', { platform: 'linux', home: '/home/t' }), '/home/t/.hermes');
        assert.strictEqual(
            expandHermesHome('${HOME}/.hermes', { platform: 'linux', env: { HOME: '/home/t' } }),
            '/home/t/.hermes',
        );
        assert.strictEqual(
            expandHermesHome('$HOME/.hermes', { platform: 'linux', env: { HOME: '/home/t' } }),
            '/home/t/.hermes',
        );
        assert.strictEqual(
            expandHermesHome('%NOPE%\\x', { platform: 'win32', env: {} }),
            '%NOPE%\\x',
            'an unknown variable is left as it was written, as expandvars does',
        );
        assert.strictEqual(
            expandHermesHome('$HOME/.hermes', { platform: 'win32', env: { HOME: 'C:\\t' } }),
            '$HOME/.hermes',
            '$VAR is not Windows syntax',
        );
    });

    it('appends HERMES_DATA_DIR_SUFFIX to the platform default', () => {
        assert.strictEqual(
            resolveDefaultHermesHome({ platform: 'linux', env: { HERMES_DATA_DIR_SUFFIX: '-test' }, home: '/home/t' }),
            '/home/t/.hermes-test',
        );
        assert.strictEqual(
            resolveDefaultHermesHome({
                platform: 'win32',
                env: { HERMES_DATA_DIR_SUFFIX: '-test', LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' },
                home: 'C:\\Users\\t',
            }),
            'C:\\Users\\t\\AppData\\Local\\hermes-test',
        );
    });

    it('expands HERMES_HOME and never appends the suffix to it', () => {
        assert.strictEqual(
            resolveDefaultHermesHome({
                platform: 'linux',
                env: { HERMES_HOME: '~/.hermes-alt', HERMES_DATA_DIR_SUFFIX: '-test' },
                home: '/home/t',
            }),
            '/home/t/.hermes-alt',
        );
        assert.strictEqual(
            resolveDefaultHermesHome({
                platform: 'win32',
                env: { HERMES_HOME: '%USERPROFILE%\\.hermes-alt', USERPROFILE: 'C:\\Users\\t', HERMES_DATA_DIR_SUFFIX: '-test' },
                home: 'C:\\Users\\t',
            }),
            'C:\\Users\\t\\.hermes-alt',
        );
    });
});
