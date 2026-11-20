import * as assert from 'assert';
import { Connection, type ConnectionHost } from '../../host/chat/connection';

/**
 * The guarantee runs before anything is started: these hosts carry only what it reads, so a test
 * that gets past it stops at the next need instead of spawning Hermes.
 */
describe('the connect guarantee: a profile another window runs', () => {
    function harness(excluded: Array<{ cliProfile: string; holder: string }>) {
        const posts: Array<{ type: string; status?: string }> = [];
        const logs: string[] = [];
        const target = {
            sessionProfileId: 'id-dev',
            agentName: 'dev-vsc',
            selectionId: 'dev-vsc',
            displayName: 'dev',
            cliProfile: 'dev-vsc',
        };
        const host = {
            profiles: {
                connectTarget: () => ({ target, missing: false }),
                selectionId: '',
                displayName: '',
            },
            session: { sessionProfileId: 'id-dev', tabs: [], bindProfileScope: () => undefined },
            projects: { bindProfileScope: () => undefined },
            resolveCwd: () => '',
            excludedProfiles: () => excluded,
            post: (msg: { type: string; status?: string }) => {
                posts.push(msg);
            },
            log: (line: string) => {
                logs.push(line);
            },
        } as unknown as ConnectionHost;
        return { connection: new Connection(host), posts, logs };
    }

    it('refuses it, says who holds it, and opens the picker', async () => {
        const h = harness([{ cliProfile: 'dev-vsc', holder: 'another window' }]);
        await h.connection.connect();

        assert.strictEqual(h.connection.acp, undefined, 'no agent was started');
        assert.ok(h.logs.some(line => line.includes('it belongs to another window')), 'the log names the holder');
        assert.ok(h.posts.some(msg => msg.type === 'openProfilePicker'), 'the picker opens');
        assert.ok(h.posts.some(msg => msg.type === 'status' && msg.status === 'error'), 'and the pill says so');
    });

    it('names the primary or the secondant when that is who holds it', async () => {
        for (const holder of ['the primary', 'the secondant']) {
            const h = harness([{ cliProfile: 'dev-vsc', holder }]);
            await h.connection.connect();
            assert.ok(h.logs.some(line => line.includes(`it belongs to ${holder}`)), `log says ${holder}`);
        }
    });

    it('announces nothing when it refuses: the signal the presence writes on stays quiet', async () => {
        const h = harness([{ cliProfile: 'dev-vsc', holder: 'another window' }]);
        let landed = 0;
        h.connection.profileActive.on(() => {
            landed += 1;
        });

        await h.connection.connect();
        assert.strictEqual(landed, 0, 'a refused connect never says a profile became active');
    });

    it('lets a profile no one else holds through to the next check', async () => {
        const h = harness([{ cliProfile: 'kitt', holder: 'the secondant' }]);
        await h.connection.connect();

        assert.ok(!h.logs.some(line => line.includes('Refusing')), 'dev-vsc is not excluded');
        assert.ok(h.posts.some(msg => msg.type === 'status'), 'it got as far as the folder check');
    });
});
