import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ACP_TRACE_ENV, acpTraceEnabled, appendAcpTrace, traceFilePath } from '../../host/acp/acpTrace';

describe('ACP wire trace', () => {
    let home: string;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'acptrace-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('is off unless the env var is exactly 1', () => {
        assert.strictEqual(acpTraceEnabled({ [ACP_TRACE_ENV]: '1' }), true);
        assert.strictEqual(acpTraceEnabled({ [ACP_TRACE_ENV]: '0' }), false);
        assert.strictEqual(acpTraceEnabled({ [ACP_TRACE_ENV]: 'yes' }), false);
        assert.strictEqual(acpTraceEnabled({}), false);
    });

    it('names the file after the profile, safely', () => {
        assert.strictEqual(path.basename(traceFilePath('/h', 'dev-vsc')), 'trace-dev-vsc.ndjson');
        assert.strictEqual(path.basename(traceFilePath('/h', 'pa/one two')), 'trace-pa_one_two.ndjson');
        assert.strictEqual(path.basename(traceFilePath('/h', '')), 'trace-unknown.ndjson');
    });

    it('appends one update per line, in the pane-mail folder', () => {
        const first = appendAcpTrace(home, 'pa', { sessionUpdate: 'agent_message_chunk', messageId: 'm1' });
        const second = appendAcpTrace(home, 'pa', { sessionUpdate: 'tool_call', title: 'Read' });

        assert.strictEqual(first, '{"sessionUpdate":"agent_message_chunk","messageId":"m1"}');
        assert.ok(second);

        const lines = fs
            .readFileSync(traceFilePath(home, 'pa'), 'utf8')
            .split('\n')
            .filter(Boolean);
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(JSON.parse(lines[0]).messageId, 'm1');
        assert.strictEqual(JSON.parse(lines[1]).title, 'Read');
    });

    it('keeps the two panes apart', () => {
        appendAcpTrace(home, 'pa', { n: 1 });
        appendAcpTrace(home, 'dev-vsc', { n: 2 });
        assert.notStrictEqual(traceFilePath(home, 'pa'), traceFilePath(home, 'dev-vsc'));
        assert.strictEqual(fs.readFileSync(traceFilePath(home, 'dev-vsc'), 'utf8').trim(), '{"n":2}');
    });

    it('never throws on an unserialisable update', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        assert.strictEqual(appendAcpTrace(home, 'pa', cyclic), null);
    });
});
