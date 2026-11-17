import { spawn } from 'child_process';
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

function makeStream(proc) {
    const childInput = new WritableStream({
        write(chunk) {
            proc.stdin.write(Buffer.from(chunk));
        },
        close() {
            proc.stdin.end();
        },
    });
    const childOutput = new ReadableStream({
        start(controller) {
            proc.stdout.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            proc.stdout.on('end', () => controller.close());
        },
    });
    return ndJsonStream(childInput, childOutput);
}

async function run(label, mcpServers) {
    const proc = spawn('hermes', ['acp'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const stream = makeStream(proc);
    const app = client({ name: 'test' });
    const conn = app.connect(stream);
    try {
        await conn.agent.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            // The extension advertises nothing: no filesystem, no terminal (both removed with the
            // same change that took the fs/terminal client capability out of the client).
            clientCapabilities: {},
        });
        const session = await conn.agent
            .buildSession({ cwd: process.cwd(), mcpServers })
            .start();
        console.log(`${label}: OK sessionId=${session.sessionId} mcpCount=${mcpServers.length}`);
    } catch (err) {
        console.error(`${label}: FAIL`, err?.message || err);
        if (stderr.trim()) console.error('stderr:', stderr.trim().slice(0, 800));
        process.exitCode = 1;
    } finally {
        proc.kill();
    }
}

// No MCP servers are resolved for a session any more — mcpConfig.ts is gone and the client sends
// an empty list. The script proves that path, which is the one the extension now takes.
await run('empty mcpServers', []);
