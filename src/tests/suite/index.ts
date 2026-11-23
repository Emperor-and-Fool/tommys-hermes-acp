import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';
import { initI18n } from '../../host/i18n';

export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
    });

    /**
     * Every test starts in the default language.
     *
     * `t()` reads one module-level string table, so a test that switches the language hands its
     * choice to every file that runs after it — `i18n.test.js` ends on zh-cn, and the suites whose
     * assertions name English words (`'About +800 tokens'`, `'at least 2,210'`, `'no Hermes
     * session'`) then fail while the code is right. Reset here, once, instead of asking each such
     * test to translate its own expectations.
     */
    mocha.rootHooks({
        beforeEach: () => {
            initI18n('en');
        },
    });

    const suiteDir = __dirname;
    for (const file of fs.readdirSync(suiteDir)) {
        if (file.endsWith('.test.js')) {
            mocha.addFile(path.join(suiteDir, file));
        }
    }

    return new Promise((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
