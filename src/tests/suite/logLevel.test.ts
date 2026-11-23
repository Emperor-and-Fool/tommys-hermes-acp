import * as assert from 'assert';
import { describe, it } from 'mocha';
import { classifyLogLevel } from '../../host/logLevel';

describe('logLevel', () => {
    it('classifies error lines', () => {
        assert.strictEqual(classifyLogLevel('ERROR: connection refused'), 'error');
        assert.strictEqual(classifyLogLevel('Connect failed: timeout'), 'error');
        assert.strictEqual(classifyLogLevel('Process exited (code: 1, signal: null)'), 'error');
        assert.strictEqual(classifyLogLevel('Connection lost'), 'error');
    });

    it('classifies warning lines', () => {
        assert.strictEqual(classifyLogLevel('WARNING: deprecated API'), 'warning');
        assert.strictEqual(classifyLogLevel('[WARN] retrying'), 'warning');
    });

    it('ignores informational lines', () => {
        assert.strictEqual(classifyLogLevel('session/new cwd=/tmp mcpServers=0'), null);
        assert.strictEqual(classifyLogLevel('Status: ready'), null);
    });

    /**
     * A method this Hermes does not implement is not a fault: 0.22.6 and 0.23.3 have no
     * `model.options`, and the session model list is the answer they do give. The line is written
     * once per process (AcpClient), and it has to stay out of the pane's error list.
     */
    it('keeps an unimplemented method out of the error list', () => {
        const line = 'model.options is not implemented by this Hermes (Method not found); using the session model list';
        assert.strictEqual(classifyLogLevel(line), null);
    });
});
