/**
 * Package the secondant from the same source tree, and put the result where the primary ships it.
 *
 * `vsce` only reads `package.json` and `package.nls*.json` from the project root, so the build
 * writes the secondant's identity in place of the primary's, packages, and puts the originals
 * back. The restore is in a `finally`: a failed package must not leave the repo declared as the
 * secondant.
 *
 * The VSIX is written to `secondant/` at the root, which the primary's package includes, so
 * "Install secondant" installs from a file that travelled with the primary. It is packaged from
 * `packaging/secondant/out/` (ignored by the VSIX) and copied afterwards, so a previous bundle
 * can never nest inside the new one.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

// The local entry points, run through this Node: `npx` is a shell shim that spawnSync cannot
// start on Windows without `shell: true`.
const localBin = (...parts) => join(repo, 'node_modules', ...parts);
const secondantDir = join(repo, 'packaging', 'secondant');
const buildDir = join(secondantDir, 'out');
const shipDir = join(repo, 'secondant');
const NAME = 'tommys-hermes-secondant.vsix';

/** Files the secondant manifest replaces at the root, with the content to restore afterwards. */
const rootFiles = [
    { name: 'package.json', source: 'package.json' },
    { name: 'package.nls.json', source: 'package.nls.en.json' },
    { name: 'package.nls.zh-cn.json', source: 'package.nls.zh-cn.json' },
];

const iconSource = join(secondantDir, 'activitybar-secondant.svg');
const iconTarget = join(repo, 'media', 'activitybar-secondant.svg');

const saved = new Map();
let iconCopied = false;

function install() {
    for (const file of rootFiles) {
        const target = join(repo, file.name);
        saved.set(target, readFileSync(target));
        copyFileSync(join(secondantDir, file.source), target);
        console.log(`secondant: ${file.name} <- packaging/secondant/${file.source}`);
    }
    copyFileSync(iconSource, iconTarget);
    iconCopied = true;
    console.log('secondant: media/activitybar-secondant.svg');
}

function restore() {
    for (const [target, contents] of saved) {
        writeFileSync(target, contents);
        console.log(`secondant: restored ${target.slice(repo.length + 1)}`);
    }
    saved.clear();
    if (iconCopied && existsSync(iconTarget)) {
        unlinkSync(iconTarget);
        iconCopied = false;
    }
}

// A SIGINT during tsc or vsce never reaches the `finally` below, and the repo would keep the
// secondant's manifests. Restore first, then exit with the conventional code for the signal.
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
        console.log(`\nsecondant: ${signal} — restoring the primary's manifests`);
        restore();
        process.exit(exitCode);
    });
}

/** A stale bundle in the ship folder would be packed into the new one. */
function clearShipped() {
    if (!existsSync(shipDir)) {
        return;
    }
    for (const name of readdirSync(shipDir)) {
        if (name.endsWith('.vsix')) {
            rmSync(join(shipDir, name), { force: true });
        }
    }
}

let code = 1;
try {
    clearShipped();
    mkdirSync(buildDir, { recursive: true });
    install();

    const compile = spawnSync(process.execPath, [localBin('typescript', 'bin', 'tsc'), '-p', './'], { cwd: repo, stdio: 'inherit' });
    if (compile.status !== 0) {
        throw new Error('compile failed; nothing packaged');
    }

    const built = join(buildDir, NAME);
    const vsce = spawnSync(
        process.execPath,
        [
            localBin('@vscode', 'vsce', 'vsce'),
            'package',
            '--allow-missing-repository',
            // Its own ignore list: `--ignoreFile` replaces the root one, so the secondant can
            // leave out the primary's entry points while keeping everything it needs.
            '--ignoreFile',
            join(secondantDir, '.vscodeignore'),
            '-o',
            built,
        ],
        { cwd: repo, stdio: 'inherit' }
    );
    code = vsce.status ?? 1;
    if (code === 0) {
        mkdirSync(shipDir, { recursive: true });
        copyFileSync(built, join(shipDir, NAME));
        console.log(`secondant: packaged secondant/${NAME}`);
    }
} catch (err) {
    console.error('secondant:', err instanceof Error ? err.message : String(err));
    code = 1;
} finally {
    restore();
}

process.exit(code);
