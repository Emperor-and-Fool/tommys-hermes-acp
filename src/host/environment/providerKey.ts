import * as fs from 'fs';
import * as path from 'path';
import { HERMES_DEFAULT_PROFILE } from './hermesProfile';
import { resolveHermesRoot } from './hermesPaths';
import { profileConfigPathFor } from './profileMemory';

/**
 * A profile's provider, and the key its agent would use — read from Hermes' own files (H1, H2).
 *
 * Two facts, both Hermes': the `model.provider` of the profile's `config.yaml`, and the value of one
 * variable in its `.env`. Nothing here writes. And no value of a key leaves this module except to
 * the balance call that needs it: `credentialFor` is the one door, and its answer is never logged,
 * never drawn and never put in a message.
 */

/** The variable Hermes reads a DeepSeek key from. */
export const DEEPSEEK_KEY = 'DEEPSEEK_API_KEY';

/**
 * Where a profile's `.env` lives.
 *
 * The same shape as its `config.yaml` and its `MEMORY.md`: a named profile keeps everything under
 * `profiles/<name>/`, and the default profile has no folder of its own — its `.env` sits at the root
 * of the home, beside `state.db`.
 */
export function profileEnvPathFor(profileName: string, hermesHome = resolveHermesRoot()): string {
    const name = (profileName || '').trim();
    return name === HERMES_DEFAULT_PROFILE
        ? path.join(hermesHome, '.env')
        : path.join(hermesHome, 'profiles', name, '.env');
}

/**
 * One variable of a profile's `.env`, or `''`.
 *
 * A hand-written file, so: blank lines and `#` comments are skipped, a leading `export ` is allowed,
 * quotes are stripped, and an unquoted value ends at an inline comment.
 */
export function envValueFor(profileName: string, name: string, hermesHome = resolveHermesRoot()): string {
    let text: string;
    try {
        text = fs.readFileSync(profileEnvPathFor(profileName, hermesHome), 'utf-8');
    } catch {
        return '';
    }
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
        const equals = body.indexOf('=');
        if (equals <= 0 || body.slice(0, equals).trim() !== name) {
            continue;
        }
        return unquote(body.slice(equals + 1));
    }
    return '';
}

/** A value without the quotes a hand-written file may carry. */
function unquote(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        if ((first === '"' || first === "'") && trimmed[trimmed.length - 1] === first) {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed.replace(/\s+#.*$/, '').trim();
}

/**
 * The provider a profile runs: the `provider:` key of its `model:` block, `''` when it has none.
 *
 * A scan of the one key, not a YAML dependency — the same decision `memoryLimitFor` makes for its
 * number. `provider` is also a key other blocks may carry, so only the `model:` block is read.
 */
export function providerForProfile(profileName: string, hermesHome = resolveHermesRoot()): string {
    let text: string;
    try {
        text = fs.readFileSync(profileConfigPathFor(profileName, hermesHome), 'utf-8');
    } catch {
        return '';
    }
    let inModelBlock = false;
    for (const line of text.split(/\r?\n/)) {
        const inline = line.match(/^model:\s*\{[^}]*provider:\s*([^,}\s]+)/);
        if (inline) {
            return unquote(inline[1]);
        }
        if (/^model:\s*$/.test(line)) {
            inModelBlock = true;
            continue;
        }
        if (inModelBlock && /^\S/.test(line)) {
            // Another top-level key: the model block is over.
            inModelBlock = false;
        }
        if (!inModelBlock) {
            continue;
        }
        const match = line.match(/^\s+provider:\s*(.+?)\s*(?:#.*)?$/);
        if (match) {
            return unquote(match[1]);
        }
    }
    return '';
}

/** What a profile's balance may be read with: its provider, and the key of that provider. */
export interface Credentials {
    /** `deepseek`, `custom:hgsene`, … `''` when the profile names none. */
    provider: string;
    /** The key's value, never logged. `''` when neither file holds one. */
    key: string;
    /** The variable the key was read from, which the item may name when the value is missing. */
    keyName: string;
}

/**
 * The provider and key of a profile.
 *
 * The key is the profile's own; when its `.env` does not carry one, the default profile's is used —
 * a machine often keeps its one key there and the profiles beside it empty.
 */
export function credentialFor(profileName: string, hermesHome = resolveHermesRoot()): Credentials {
    const name = (profileName || '').trim();
    const own = name ? envValueFor(name, DEEPSEEK_KEY, hermesHome) : '';
    const fallback = own || name === HERMES_DEFAULT_PROFILE
        ? ''
        : envValueFor(HERMES_DEFAULT_PROFILE, DEEPSEEK_KEY, hermesHome);
    return {
        provider: name ? providerForProfile(name, hermesHome) : '',
        key: own || fallback,
        keyName: DEEPSEEK_KEY,
    };
}
