import { describe, it } from 'mocha';
import assert from 'assert';
import type * as vscode from 'vscode';
import { HistoryViewer } from '../../host/webview/historyViewer';
import type { HistoryViewerHost } from '../../host/webview/historyViewer';
import type { HostToPane } from '../../shared/webview';

/** The viewer fetches in the background; let both microtask and timer queues drain. */
const settled = async (): Promise<void> => {
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
};

const fakePanel = (posted: HostToPane[]): vscode.WebviewPanel => ({
    title: '',
    webview: {
        options: {},
        html: '',
        postMessage: (msg: unknown) => {
            posted.push(msg as HostToPane);
            return Promise.resolve(true);
        },
        onDidReceiveMessage: () => ({ dispose: () => {} }),
    },
    reveal: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
    dispose: () => {},
}) as unknown as vscode.WebviewPanel;

const viewerFor = (loadRemote: HistoryViewerHost['loadRemote']) => {
    const posted: HostToPane[] = [];
    const logs: string[] = [];
    const host: HistoryViewerHost = {
        html: () => '',
        localResourceRoots: () => [],
        tabs: () => [],
        profile: () => 'work',
        loadRemote,
        otherPane: () => ({ live: false, profile: '' }),
        onPicked: () => {},
        onForwarded: () => {},
        focusComposer: () => {},
        log: (line: string) => { logs.push(line); },
    };
    const viewer = new HistoryViewer(host, () => fakePanel(posted));
    return { viewer, posted, logs };
};

const failureOf = (posted: HostToPane[]) =>
    posted.find((msg): msg is Extract<HostToPane, { type: 'historyFetchFailed' }> =>
        msg.type === 'historyFetchFailed');

describe('history viewer: empty and failed are different answers', () => {
    it('shows a session Hermes returned with no rows as empty', async () => {
        const { viewer, posted } = viewerFor(async () => []);

        viewer.open('s1', 'Title');
        await settled();

        assert.ok(posted.some(msg => msg.type === 'historyFetchEmpty'), 'the pane is told it is empty');
        assert.strictEqual(failureOf(posted), undefined, 'and not that it failed');
    });

    it('reports a failed export as failed, with the reason, and never as empty', async () => {
        const { viewer, posted, logs } = viewerFor(async () => {
            throw new Error('hermes sessions export failed: exit 1');
        });

        viewer.open('s1', 'Title');
        await settled();

        const failed = failureOf(posted);
        assert.ok(failed, 'the pane is told it failed');
        assert.strictEqual(failed.reason, 'hermes sessions export failed: exit 1');
        assert.ok(!posted.some(msg => msg.type === 'historyFetchEmpty'), 'a failure is not an empty conversation');
        assert.ok(logs.some(line => line.includes('fetch failed')), 'the reason reaches the log');
    });
});
