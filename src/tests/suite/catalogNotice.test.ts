/**
 * The notice a failed session catalog earns: once per connect, both shapes of the failure, and the
 * two buttons that make it actionable.
 *
 * The failure this covers is Hermes without the ACP patch: `_session/catalog` raises an error, or
 * answers nothing at all. Both used to be silent — the connect carried on as if the profile had no
 * sessions — so the notice is the whole answer the user gets.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import { CatalogNotice } from '../../host/workspace/catalogNotice';
import type { CatalogNoticeHost } from '../../host/workspace/catalogNotice';
import { t } from '../../host/i18n';
import type { EditorChoiceItem, EditorChoices } from '../../shared/editor';

/** A notice over a fake editor: what it asked, what it showed, and the answer to give. */
const noticeOver = (version: string, answer?: string) => {
    const asked: Array<{ message: string; actions: string[] }> = [];
    const infos: string[] = [];
    const logs: string[] = [];
    const shown: string[] = [];
    const host: CatalogNoticeHost = {
        hermesVersion: () => version,
        patchFolder: () => '/ext/packaging/hermes-patches',
        info: (message) => { infos.push(message); },
        log: (line) => { logs.push(line); },
        choices: {
            pick: async (_title: string, _items: EditorChoiceItem[]) => undefined,
            prompt: async () => undefined,
            pickFolder: async () => undefined,
            home: () => '/home',
            showInFileManager: async (folderPath) => { shown.push(folderPath); },
            ask: async (message, actions) => {
                asked.push({ message, actions });
                return answer;
            },
        } as EditorChoices,
    };
    return { notice: new CatalogNotice(host), asked, infos, logs, shown };
};

describe('the session catalog notice: a Hermes that does not answer', () => {
    it('is told once per connect, however many reads fail', async () => {
        const { notice, asked, logs } = noticeOver('0.23.3');
        notice.beginConnect();
        await notice.failed('Internal error');
        await notice.failed('Internal error');
        await notice.failed('Internal error');
        assert.strictEqual(asked.length, 1, 'one notice for the connect');
        assert.strictEqual(logs.length, 3, 'but every failed read still leaves a log line');

        notice.beginConnect();
        await notice.failed('Internal error');
        assert.strictEqual(asked.length, 2, 'a new connect may say it again');
    });

    it('names the patch this Hermes needs, and offers the folder', async () => {
        const { notice, asked } = noticeOver('0.23.3');
        await notice.failed('Internal error');
        assert.strictEqual(asked.length, 1);
        const { message, actions } = asked[0];
        assert.ok(message.includes('0.23.3'), `the version is named: ${message}`);
        assert.ok(message.includes('0003'), `the set is named: ${message}`);
        assert.deepStrictEqual(actions, [t('catalogOpenPatchFolder'), t('catalogDetails')]);
        assert.ok(!message.includes('Internal error'), 'the error text belongs in Details, not the notice');
    });

    it('says the same for the other shape: an agent that answers no catalog at all', async () => {
        const { notice, asked } = noticeOver('0.22.6');
        await notice.failed('the agent answered no session catalog (is the patch applied?)');
        assert.strictEqual(asked.length, 1);
        assert.ok(asked[0].message.includes('0.22.6'), asked[0].message);
        assert.ok(asked[0].message.includes('0001 + 0002'), asked[0].message);
    });

    it('says so instead of guessing when no patch set is known for the version', async () => {
        const { notice, asked } = noticeOver('0.24.0');
        await notice.failed('Internal error');
        assert.strictEqual(asked.length, 1);
        assert.strictEqual(asked[0].message, t('catalogNoPatchKnown', '0.24.0'));
    });

    it('opens the installed extension\'s patch folder', async () => {
        const { notice, asked, shown } = noticeOver('0.23.3', t('catalogOpenPatchFolder'));
        await notice.failed('Internal error');
        assert.strictEqual(asked.length, 1);
        assert.deepStrictEqual(shown, ['/ext/packaging/hermes-patches']);
    });

    it('shows what Hermes answered, the log line, and the files in Details', async () => {
        const { notice, infos, logs } = noticeOver('0.23.3', t('catalogDetails'));
        await notice.failed('Internal error');
        assert.strictEqual(infos.length, 1);
        const body = infos[0];
        assert.ok(body.includes('Internal error'), `the error text is there: ${body}`);
        assert.ok(body.includes(logs[0]), `the log line is there: ${body}`);
        assert.ok(body.includes('0003-acp-023x-session-catalog-hidden-title.patch'), `the files are there: ${body}`);
    });
});
