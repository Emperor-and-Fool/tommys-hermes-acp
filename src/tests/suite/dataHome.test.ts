import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { dataHome, legacySecondantHome } from '../../host/store/connection';

describe('the data home', () => {
    it('is one folder for both extensions, named once', () => {
        assert.strictEqual(path.basename(dataHome()), 'emperorandfool.tommys-hermes-acp');
        // The same call from either extension resolves here: no extension id is asked for.
        assert.strictEqual(dataHome(), dataHome());
    });

    it('keeps the secondant home apart as a migration source only', () => {
        const legacy = legacySecondantHome();
        assert.strictEqual(path.basename(legacy), 'emperorandfool.tommys-hermes-secondant');
        assert.strictEqual(path.dirname(legacy), path.dirname(dataHome()));
    });

    it('never sits inside the editor user-data directory', () => {
        // globalStorageUri would be something like ~/.config/VSCodium/User/globalStorage/<id>.
        assert.strictEqual(dataHome().startsWith(os.homedir()), true);
        assert.strictEqual(dataHome().includes('globalStorage'), false);
    });
});
