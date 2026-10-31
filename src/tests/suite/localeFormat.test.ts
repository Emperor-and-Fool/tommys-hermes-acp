import { describe, it } from 'mocha';
import assert from 'assert';
import { formatLocaleString, WEBVIEW_LOCALE_HELPER } from '../../host/i18n/format';

/** The injected helper, built the way the webview builds it, against a locale table. */
function webviewHelper(table: Record<string, string>): (...args: unknown[]) => string {
    const factory = new Function(
        'locale',
        `${WEBVIEW_LOCALE_HELPER}\nreturn localeText;`
    ) as (locale: unknown) => (...args: unknown[]) => string;
    return factory(table);
}

describe('formatLocaleString', () => {
    it('fills each placeholder from its own argument', () => {
        assert.strictEqual(formatLocaleString('{0} sent {1}', 'Ann', 3), 'Ann sent 3');
    });

    it('does not substitute into text an earlier argument inserted', () => {
        // A sequential replace fills {0} with "{1}" and then matches that inserted text for {1}.
        assert.strictEqual(formatLocaleString('{0} and {1}', '{1}', 'second'), '{1} and second');
    });

    it('treats $& and $$ in an argument as text, not a replacement pattern', () => {
        assert.strictEqual(formatLocaleString('x {0}', '$&'), 'x $&');
        assert.strictEqual(formatLocaleString('x {0}', '$$'), 'x $$');
    });

    it('fills every occurrence of a repeated placeholder', () => {
        assert.strictEqual(formatLocaleString('{0}/{0}', 'a'), 'a/a');
    });

    it('reads a multi-digit index whole', () => {
        const args = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ten'];
        assert.strictEqual(formatLocaleString('{10} {1}', ...args), 'ten 1');
    });

    it('leaves a placeholder that has no argument alone', () => {
        assert.strictEqual(formatLocaleString('{0} {5}', 'a'), 'a {5}');
    });
});

describe('WEBVIEW_LOCALE_HELPER', () => {
    it('matches formatLocaleString on both edges', () => {
        const text = webviewHelper({ k: '{0} and {1}' });
        assert.strictEqual(text('k', '{1}', 'second'), '{1} and second');
        assert.strictEqual(text('k', '$&', 'x'), '$& and x');
    });

    it('leaves a placeholder with no argument alone', () => {
        const text = webviewHelper({ k: '{0} {3}' });
        assert.strictEqual(text('k', 'a'), 'a {3}');
    });
});
