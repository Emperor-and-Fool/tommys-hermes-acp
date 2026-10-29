import { describe, it } from 'mocha';
import assert from 'assert';
import {
    PRIMARY,
    SECONDANT,
    commandId,
    identity,
    setActiveIdentity,
    setting,
    settingsSection,
} from '../../shared/extensionId';

describe('extension identity', () => {
    it('names the primary exactly as it is shipped today', () => {
        assert.strictEqual(PRIMARY.prefix, 'tommys');
        assert.strictEqual(PRIMARY.extensionId, 'EmperorAndFool.tommys-hermes-acp');
        assert.strictEqual(PRIMARY.chatViewId, 'tommysChat');
        assert.strictEqual(PRIMARY.sidebarId, 'tommys-sidebar');
        assert.strictEqual(PRIMARY.chatPanelType, 'tommys.chatPanel');
        assert.strictEqual(PRIMARY.historyViewerType, 'tommys.historyViewer');
        assert.strictEqual(PRIMARY.cmd('openChat'), 'tommys.openChat');
    });

    it('gives the secondant its own id everywhere the primary has one', () => {
        assert.strictEqual(SECONDANT.prefix, 'tommys2');
        assert.strictEqual(SECONDANT.extensionId, 'EmperorAndFool.tommys-hermes-secondant');
        assert.strictEqual(SECONDANT.chatViewId, 'tommys2Chat');
        assert.strictEqual(SECONDANT.sidebarId, 'tommys2-sidebar');
        assert.strictEqual(SECONDANT.chatPanelType, 'tommys2.chatPanel');
        assert.strictEqual(SECONDANT.historyViewerType, 'tommys2.historyViewer');
        assert.strictEqual(SECONDANT.cmd('openChat'), 'tommys2.openChat');
    });

    it('shares nothing between the two identities', () => {
        const primaryValues = new Set(Object.values(PRIMARY).filter(v => typeof v === 'string'));
        for (const value of Object.values(SECONDANT)) {
            if (typeof value === 'string') {
                assert.ok(!primaryValues.has(value), `secondant reuses "${value}"`);
            }
        }
        assert.notStrictEqual(PRIMARY.role, SECONDANT.role);
    });

    it('resolves settings and commands against the active identity', () => {
        setActiveIdentity(SECONDANT);
        assert.strictEqual(identity().role, 'secondant');
        assert.strictEqual(settingsSection(), 'tommys2');
        assert.strictEqual(setting('path'), 'tommys2.path');
        assert.strictEqual(commandId('openChat'), 'tommys2.openChat');

        setActiveIdentity(PRIMARY);
        assert.strictEqual(identity().role, 'primary');
        assert.strictEqual(settingsSection(), 'tommys');
        assert.strictEqual(setting('path'), 'tommys.path');
        assert.strictEqual(commandId('openChat'), 'tommys.openChat');
    });
});
