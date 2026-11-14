#!/usr/bin/env node
/**
 * Compile, then copy the build into every extension copy VSCodium actually loads.
 *
 * The installed directory is a third artefact: it does not follow the repo, and it does
 * not follow the VSIX either. Missing any of the three groups below fails silently —
 * a stale `out/` runs old host code, a stale manifest declares commands the new JS no
 * longer registers, and a stale `media/` leaves the webview running the previous UI while
 * the log says nothing. Copy all of them, then prove each file landed.
 *
 * There can be two installed copies: the primary and the secondant. Which ones exist is read
 * from the extensions folder itself — a scan, not a signal from either extension, so a copy
 * someone installed by hand is served as well. Each gets the files its own identity declares:
 * the primary's manifest for the primary, the retagged one from `packaging/secondant/` for the
 * secondant, and the secondant's own icon in its `media/`.
 *
 *   npm run deploy
 */
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync, rmdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repo = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));

// The local entry points, run through this Node. `npx` is a shell shim: on Windows spawnSync
// cannot start it without `shell: true`, and the script failed there before running anything.
const localBin = (...parts) => path.join(repo, 'node_modules', ...parts);

// Clean build first. tsc never deletes the output of a file that moved or went away, so a
// stale .js left in out/ would be copied and kept — the exact failure the prune below exists
// to catch, caught one layer too late. Wiping makes the repo's out/ the truth: whatever is in
// it after the compile is exactly what src/ produces.
rmSync(path.join(repo, 'out'), { recursive: true, force: true });
const build = spawnSync(process.execPath, [localBin('typescript', 'bin', 'tsc'), '-p', './'], { cwd: repo, stdio: 'inherit' });
if (build.status !== 0) {
    console.error('deploy: compile failed, nothing copied (out/ was wiped; run npm run compile)');
    process.exit(1);
}

// The webview bundle: src/pane/*.ts becomes the single file the pane loads.
// Through the Node API rather than the `esbuild` package's bin: that file is the platform
// binary on some installs and a JS shim on others, so there is no one path to spawn.
try {
    buildSync({
        entryPoints: [path.join(repo, 'src/pane/main.ts')],
        bundle: true,
        format: 'iife',
        target: 'es2020',
        outfile: path.join(repo, 'media/pane.js'),
        logLevel: 'info',
    });
} catch {
    console.error('deploy: pane build failed, nothing copied');
    process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

function walk(rel, out = []) {
    const abs = path.join(repo, rel);
    if (!existsSync(abs)) return out;
    if (statSync(abs).isDirectory()) {
        for (const entry of readdirSync(abs)) walk(path.join(rel, entry), out);
        return out;
    }
    out.push(rel);
    return out;
}

/** The user-data homes this deploy looks in: VSCodium first, plain VS Code second. */
function userDataHomes() {
    return process.platform === 'darwin'
        ? [path.join(homedir(), 'Library', 'Application Support', 'VSCodium'), path.join(homedir(), 'Library', 'Application Support', 'Code')]
        : process.platform === 'win32'
            ? ['VSCodium', 'Code'].map(name => path.join(process.env.APPDATA || '', name))
            : ['VSCodium', 'Code'].map(name => path.join(homedir(), '.config', name));
}

/**
 * Folder paths each registry claims, with the profile that claims them. Profiles keep their own
 * extensions.json beside their state; the file in the extensions directory belongs to the default
 * profile only, so reading that one alone says "not installed" for everything a named profile uses.
 */
function registryFiles() {
    const files = [];
    for (const home of userDataHomes()) {
        if (!home) continue;
        const profiles = path.join(home, 'User', 'profiles');
        if (!existsSync(profiles)) continue;
        for (const id of readdirSync(profiles)) {
            const file = path.join(profiles, id, 'extensions.json');
            if (existsSync(file)) files.push({ file, label: `profile ${id}` });
        }
    }
    const own = path.join(extensionsDir, 'extensions.json');
    if (existsSync(own)) files.push({ file: own, label: 'default profile' });
    return files;
}

/**
 * Where installed extensions live. VSCodium defaults to ~/.vscode-oss, plain VS Code to
 * ~/.vscode, and a portable or re-homed install says so in VSCODE_EXTENSIONS.
 */
function resolveExtensionsDir() {
    const override = process.env.VSCODE_EXTENSIONS;
    if (override) return { dir: path.resolve(override), source: 'VSCODE_EXTENSIONS' };
    const codium = path.join(homedir(), '.vscode-oss', 'extensions');
    if (existsSync(codium)) return { dir: codium, source: 'VSCodium default' };
    const code = path.join(homedir(), '.vscode', 'extensions');
    if (existsSync(code)) return { dir: code, source: 'VS Code default' };
    return { dir: '', source: '' };
}

const { dir: extensionsDir, source: extensionsSource } = resolveExtensionsDir();
if (!extensionsDir) {
    console.error(
        'deploy: no extension directory found — looked at ~/.vscode-oss/extensions and ' +
        '~/.vscode/extensions. Set VSCODE_EXTENSIONS to the directory the editor loads from.'
    );
    process.exit(1);
}
console.log(`deploy: extensions in ${extensionsDir} (${extensionsSource})`);

/** Folders the editor has queued for deletion on its next start. Copying into one is wasted work. */
function obsoleteFolders() {
    const file = path.join(extensionsDir, '.obsolete');
    if (!existsSync(file)) return new Set();
    try {
        return new Set(Object.keys(JSON.parse(readFileSync(file, 'utf8'))));
    } catch {
        return new Set();
    }
}

const obsolete = obsoleteFolders();

/** Installed copies, by folder — the editor lowercases the publisher in the directory name. */
function installed(prefix) {
    if (!existsSync(extensionsDir)) return [];
    return readdirSync(extensionsDir)
        .filter(name => name.toLowerCase().startsWith(prefix.toLowerCase()))
        .filter(name => !obsolete.has(name))
        .map(name => path.join(extensionsDir, name))
        .filter(dir => statSync(dir).isDirectory());
}

const publisher = pkg.publisher.toLowerCase();
for (const name of obsolete) {
    if (name.toLowerCase().startsWith(`${publisher}.`)) {
        console.log(`deploy: skipping ${name} — queued for deletion by the editor (.obsolete)`);
    }
}
const primaryDirs = installed(`${publisher}.${pkg.name}-`);
const secondantDirs = installed(`${publisher}.tommys-hermes-secondant-`);

const { PRIMARY } = require(path.join(repo, 'out', 'shared', 'extensionId.js'));

// out/ is compiled; skip the test harness, which is noise in the diff. The secondant's icon is
// packaging, not media, and it only belongs in the secondant's copy.
const shared = [
    ...walk('out').filter(rel => !rel.startsWith(path.join('out', 'tests'))),
    ...walk('media').filter(rel => rel !== path.join('media', 'activitybar-secondant.svg')),
];
const bundledSecondant = walk('secondant');
const secondantPackaging = path.join('packaging', 'secondant');

/** dest (relative to the installed copy) -> absolute source. */
function planFor(role) {
    const plan = new Map(shared.map(rel => [rel, path.join(repo, rel)]));
    if (role === 'primary') {
        plan.set('package.json', path.join(repo, 'package.json'));
        plan.set('package.nls.json', path.join(repo, 'package.nls.json'));
        plan.set('package.nls.zh-cn.json', path.join(repo, 'package.nls.zh-cn.json'));
        // secondant/ carries the secondant's own VSIX so "Install secondant" works from a
        // deploy too, not only from a packaged build.
        for (const rel of bundledSecondant) plan.set(rel, path.join(repo, rel));
        return plan;
    }
    plan.set('package.json', path.join(repo, secondantPackaging, 'package.json'));
    plan.set('package.nls.json', path.join(repo, secondantPackaging, 'package.nls.en.json'));
    plan.set('package.nls.zh-cn.json', path.join(repo, secondantPackaging, 'package.nls.zh-cn.json'));
    plan.set(
        path.join('media', 'activitybar-secondant.svg'),
        path.join(repo, secondantPackaging, 'activitybar-secondant.svg')
    );
    return plan;
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every byte under a folder — how the editor measures an installed extension's size. */
function folderSize(dir) {
    let total = 0;
    const measure = (current) => {
        for (const entry of readdirSync(current)) {
            const abs = path.join(current, entry);
            if (statSync(abs).isDirectory()) measure(abs);
            else total += statSync(abs).size;
        }
    };
    measure(dir);
    return total;
}

/**
 * Write the manifest with a fresh install record.
 *
 * The editor writes `__metadata` — `installedTimestamp`, `targetPlatform`, `size` — when it
 * extracts an extension, and `installedTimestamp` is what its cleanup pass filters on: a folder
 * without it is never deleted, however it is marked in `.obsolete`. Deploy copies files instead of
 * extracting, so it writes the same three fields itself: now, as the timestamp; the size of the
 * finished copy; and `undefined` as the target platform, which is what a build that is not
 * platform-specific declares. Called after the copy and the prune, so the size is the real one.
 */
function writeManifest(target, role) {
    const source = role === 'primary'
        ? path.join(repo, 'package.json')
        : path.join(repo, 'packaging', 'secondant', 'package.json');
    const manifest = JSON.parse(readFileSync(source, 'utf8'));
    // The editor merges into whatever the folder already carries: `__metadata = {...old, ...new}`.
    let previous;
    try {
        previous = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).__metadata;
    } catch {
        previous = undefined;
    }
    manifest.__metadata = { ...previous, installedTimestamp: Date.now(), targetPlatform: 'undefined', size: folderSize(target) };
    writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * The copy is additive, so a moved or deleted source leaves its old compiled twin behind — a
 * stale module in out/ is the same silent failure this script exists to prevent. Anything the
 * repo no longer compiles comes out of the installed copy, and empty directories with it.
 */
function pruneTarget(target, wanted, roots) {
    const pruned = [];
    const sweep = (relDir) => {
        const abs = path.join(target, relDir);
        if (!existsSync(abs)) return;
        for (const entry of readdirSync(abs)) {
            const rel = path.join(relDir, entry);
            const absEntry = path.join(target, rel);
            if (statSync(absEntry).isDirectory()) {
                sweep(rel);
                if (readdirSync(absEntry).length === 0) rmdirSync(absEntry);
            } else if (!wanted.has(rel)) {
                unlinkSync(absEntry);
                pruned.push(rel);
            }
        }
    };
    for (const root of roots) sweep(root);
    return pruned;
}

/**
 * Register the installed copy the way an install does.
 *
 * The editor's `addExtensionsToProfile` re-reads the profile's `extensions.json`, drops entries of
 * this extension that name another version, replaces or appends `{identifier, version, location,
 * relativeLocation, metadata}` for this one, and writes the array back compact — `JSON.stringify`,
 * two-space indent is not what it writes. The entry's `metadata` is the one already in the file with
 * `installedTimestamp` replaced by the value written into the folder's manifest (an install stamps
 * both from one object); no other field of it is dropped. Nothing else is touched: every other entry
 * in the file is carried over as it was read.
 *
 * An install writes the one profile it installs into. Deploy has no profile, so it writes each
 * registry that already lists this extension — the folders are shared, the registries are not.
 */
function registerInstall(target) {
    const manifest = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
    const version = manifest.version;
    const folder = path.basename(target);
    const written = [];

    for (const { file, label } of registryFiles()) {
        let entries;
        try {
            entries = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            continue;
        }
        if (!Array.isArray(entries)) continue;
        const mine = entries.filter(entry => (entry.identifier?.id || '').toLowerCase() === id);
        if (mine.length === 0) continue;

        const kept = entries.filter(entry => (entry.identifier?.id || '').toLowerCase() !== id || entry.version === version);
        const entry = {
            identifier: { id },
            version,
            location: { $mid: 1, path: target, scheme: 'file' },
            relativeLocation: folder,
            metadata: {
                ...mine[0].metadata,
                installedTimestamp: manifest.__metadata.installedTimestamp,
            },
        };
        const index = kept.findIndex(item => (item.identifier?.id || '').toLowerCase() === id && item.version === version);
        if (index === -1) kept.push(entry);
        else kept.splice(index, 1, entry);

        writeFileSync(file, JSON.stringify(kept));
        written.push(label);
    }
    return written;
}

/** The manifest must name a file that exists, and the view the host registers. */
function checkTarget(target, role) {
    const manifest = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    const viewIds = Object.values(manifest.contributes?.views ?? {}).flat().map(v => v.id);
    const identity = role === 'primary' ? PRIMARY : require(path.join(repo, 'out', 'shared', 'extensionId.js')).SECONDANT;
    const entryFile = (manifest.main || '').replace(/^\.\//, '');
    const entryExists = !!entryFile && existsSync(path.join(target, entryFile));
    const registersChat = readFileSync(path.join(target, 'out', 'host', 'activate.js'), 'utf8')
        .includes('registerWebviewViewProvider(id.chatViewId');
    const manifestMatches = viewIds.includes(identity.chatViewId);
    const entryMatches = entryFile === (role === 'primary' ? 'out/host/extension.js' : 'out/host/extensionSecondant.js');

    console.log(
        `deploy: [${role}] ${path.basename(target)} — view '${identity.chatViewId}' ` +
            `(declared: ${manifestMatches}, registered: ${registersChat}); ` +
            `entry ${manifest.main || '(none)'} (present: ${entryExists}, expected: ${entryMatches})`
    );
    if (!manifestMatches || !registersChat || !entryExists || !entryMatches) {
        console.error(`deploy: [${role}] manifest and host build disagree — this copy will not run`);
        return false;
    }
    const written = registerInstall(target);
    console.log(
        written.length
            ? `deploy: [${role}] registered in ${written.join(', ')}`
            : `deploy: [${role}] no registry lists this extension — nothing to update, the editor adds it when it scans`
    );
    return true;
}

const targets = [
    ...primaryDirs.map(dir => ({ role: 'primary', dir, roots: ['out', 'media', 'secondant'] })),
    ...secondantDirs.map(dir => ({ role: 'secondant', dir, roots: ['out', 'media'] })),
];

/**
 * Profile names in this install, for the hint below.
 *
 * The CLI installs into the default profile unless `--profile` names another one, and the default
 * profile is not where everyone works: the second install lands in a different registry file
 * entirely. The names are read from the same user-data homes `registryFiles()` scans, so the hint
 * stays true whichever editor the machine runs.
 */
function profileNames() {
    const names = ['Default'];
    for (const home of userDataHomes()) {
        if (!home) continue;
        try {
            const storage = JSON.parse(readFileSync(path.join(home, 'User', 'globalStorage', 'storage.json'), 'utf8'));
            for (const profile of storage.userDataProfiles || []) {
                if (profile.name && !names.includes(profile.name)) names.push(profile.name);
            }
        } catch {
            // No storage.json in that install: nothing to name from it.
        }
    }
    return names;
}

if (targets.length === 0) {
    console.error(`deploy: no installed copy found under ${extensionsDir}`);
    console.error('deploy: install it once, in the profile you work in:');
    console.error('deploy:   Extensions view → "Install from VSIX…" in a window of that profile, or');
    console.error(
        `deploy:   codium --profile "<name>" --install-extension dist/${pkg.name}-${pkg.version}.vsix --force  ` +
            `(profiles here: ${profileNames().join(', ')})`
    );
    process.exit(1);
}
if (secondantDirs.length === 0) {
    console.log('deploy: secondant not installed (scanned the extensions folder); only the primary will be updated');
}

let failures = 0;

for (const { role, dir, roots } of targets) {
    const plan = planFor(role);
    const wanted = new Set(plan.keys());
    console.log(`deploy: [${role}] ${plan.size} files -> ${dir}`);

    if (dryRun) {
        const stale = [];
        for (const root of roots) {
            const sweep = (relDir) => {
                const abs = path.join(dir, relDir);
                if (!existsSync(abs)) return;
                for (const entry of readdirSync(abs)) {
                    const rel = path.join(relDir, entry);
                    const absEntry = path.join(dir, rel);
                    if (statSync(absEntry).isDirectory()) sweep(rel);
                    else if (!wanted.has(rel)) stale.push(rel);
                }
            };
            sweep(root);
        }
        console.log(`deploy: [${role}] (dry run) ${stale.length} stale file(s) would be pruned`);
        continue;
    }

    let copied = 0;
    const mismatched = [];
    let manifestPending = false;
    for (const [rel, from] of plan) {
        const to = path.join(dir, rel);
        if (!existsSync(from)) continue;
        mkdirSync(path.dirname(to), { recursive: true });
        // The manifest is written last: its install record carries the size of the finished copy.
        if (rel === 'package.json') {
            manifestPending = true;
            continue;
        }
        copyFileSync(from, to);
        copied += 1;
        if (sha(from) !== sha(to)) mismatched.push(rel);
    }

    const pruned = pruneTarget(dir, wanted, roots);
    if (manifestPending) {
        writeManifest(dir, role);
        copied += 1;
    }
    console.log(
        `deploy: [${role}] verified ${copied}/${plan.size} files by sha256; ` +
            `pruned ${pruned.length} stale file(s)` +
            (pruned.length
                ? ': ' + pruned.slice(0, 5).join(', ') + (pruned.length > 5 ? `, … ${pruned.length - 5} more` : '')
                : '')
    );
    if (manifestPending) {
        const written = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).__metadata;
        console.log(
            `deploy: [${role}] manifest written with a fresh install record — ` +
                `installedTimestamp ${written.installedTimestamp}, size ${written.size}, targetPlatform ${written.targetPlatform}`
        );
    }
    if (mismatched.length) {
        console.error(`deploy: [${role}] these did not land byte-identical:\n  ` + mismatched.join('\n  '));
        failures += 1;
        continue;
    }
    if (!checkTarget(dir, role)) {
        failures += 1;
    }
}

if (failures > 0) {
    process.exit(1);
}
if (!dryRun) {
    console.log('deploy: reload the window (Developer: Reload Window) to run it.');
}
