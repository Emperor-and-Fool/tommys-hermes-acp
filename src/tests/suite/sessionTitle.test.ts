import { describe, it } from 'mocha';
import assert from 'assert';
import { renameSessionArgs, stripCliError } from '../../host/environment/sessionTitle';

describe('session title via the CLI', () => {
    it('passes the title as one argument, after --', () => {
        assert.deepStrictEqual(renameSessionArgs('dev-vsc', 'sess-1', 'Earlier work'), [
            '--profile', 'dev-vsc',
            'sessions', 'rename',
            '--', 'sess-1', 'Earlier work',
        ]);
    });

    it('keeps a title that starts with - on the title side of --', () => {
        const args = renameSessionArgs('dev-vsc', 'sess-1', '-draft: whale icon');
        const dashes = args.indexOf('--');
        assert.ok(dashes > 0);
        assert.strictEqual(args[dashes + 1], 'sess-1');
        assert.strictEqual(args[dashes + 2], '-draft: whale icon');
        assert.strictEqual(args.length, dashes + 3);
    });

    it('normalises an empty profile to the default one', () => {
        assert.strictEqual(renameSessionArgs('', 'sess-1', 'x')[1], 'default');
    });

    it('strips the CLI Error: prefix from a refusal', () => {
        assert.strictEqual(
            stripCliError('Error: A session with that title already exists'),
            'A session with that title already exists'
        );
        assert.strictEqual(stripCliError('  error:   title too long  '), 'title too long');
    });

    it('leaves anything that is not an Error: line alone', () => {
        assert.strictEqual(stripCliError('hermes exited with code 1'), 'hermes exited with code 1');
        assert.strictEqual(stripCliError('ERROR-nothing'), 'ERROR-nothing');
        assert.strictEqual(stripCliError(''), '');
    });
});
