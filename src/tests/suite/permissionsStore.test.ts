import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionsStore } from '../../host/permissions/store';

/** The red action's record and the deny backups it makes: one door, in the profile's own folder. */
describe('permissions store', () => {
    const store = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-store-'));
        return { dir, permissions: new PermissionsStore(dir, () => 'dev-vsc') };
    };

    it('records whether the red action is engaged, and says when it could not', () => {
        const { dir, permissions } = store();
        assert.strictEqual(permissions.openAccess(), false, 'nothing recorded yet reads as off');

        assert.strictEqual(permissions.setOpenAccess(true), true);
        assert.strictEqual(permissions.openAccess(), true);
        assert.ok(permissions.statePath.endsWith(path.join('profiles', 'dev-vsc', 'permissions-state.json')));

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('saves a deny list with its profile and reads it back', () => {
        const { dir, permissions } = store();
        const file = permissions.saveDenyBackup('dev-vsc', ['echo probe']);
        assert.ok(file && fs.existsSync(file), 'a backup is a file on disk');
        assert.deepStrictEqual(permissions.readDenyBackup(file!), ['echo probe']);

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('hands back the newest backup, and nothing when there is none', () => {
        const { dir, permissions } = store();
        assert.strictEqual(permissions.newestDenyBackup(), undefined);

        permissions.saveDenyBackup('dev-vsc', ['first']);
        const newest = permissions.saveDenyBackup('dev-vsc', ['second']);
        assert.strictEqual(permissions.newestDenyBackup(), newest);
        assert.deepStrictEqual(permissions.readDenyBackup(permissions.newestDenyBackup()!), ['second']);

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('restores nothing from a file it cannot read, rather than guessing', () => {
        const { dir, permissions } = store();
        const broken = path.join(dir, 'deny-backup-broken.json');
        fs.writeFileSync(broken, '{ not json');
        assert.deepStrictEqual(permissions.readDenyBackup(broken), []);

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
