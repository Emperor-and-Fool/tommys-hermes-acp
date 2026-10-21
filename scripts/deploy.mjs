#!/usr/bin/env node
/**
 * Compile, then copy the build into the extension copy VSCodium actually loads.
 *
 * The installed directory is a third artefact: it does not follow the repo, and it does
 * not follow the VSIX either. Missing any of the three groups below fails silently —
 * a stale `out/` runs old host code, a stale manifest declares commands the new JS no
 * longer registers, and a stale `media/` leaves the webview running the previous UI while
 * the log says nothing. Copy all of them, then prove each file landed.
 *
 *   npm run deploy
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repo = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));

// VSCodium lowercases the publisher in the folder name.
const folder = `${pkg.publisher.toLowerCase()}.${pkg.name}-${pkg.version}`;
const target = path.join(homedir(), '.vscode-oss', 'extensions', folder);

const build = spawnSync('npx', ['tsc', '-p', './'], { cwd: repo, stdio: 'inherit' });
if (build.status !== 0) {
    console.error('deploy: compile failed, nothing copied');
    process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

if (!existsSync(target)) {
    if (dryRun) {
        console.log(`deploy: (dry run) would target ${target}, which does not exist yet`);
    } else {
        console.error(`deploy: ${target} does not exist.`);
        console.error('Install that version once first: codium --install-extension ./' + folder + '.vsix --force');
        process.exit(1);
    }
}

/** Every file the extension host or the webview reads at runtime. */
const files = [
    'package.json',
    'package.nls.json',
    'package.nls.zh-cn.json',
    'media/chat.html',
    'media/chat.css',
    'media/chat.js',
];

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

// out/ is compiled; skip the test harness, which is noise in the diff.
for (const rel of walk('out')) {
    if (rel.startsWith(path.join('out', 'tests'))) continue;
    files.push(rel);
}
for (const rel of walk(path.join('media', 'vendor'))) files.push(rel);

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
let copied = 0;
const mismatched = [];

if (dryRun) {
    const present = files.filter((rel) => existsSync(path.join(repo, rel)));
    console.log(`deploy: (dry run) ${present.length} files would be copied to ${target}`);
    console.log('deploy: ' + present.slice(0, 6).join(', ') + `, … ${present.length - 6} more`);
    process.exit(0);
}

for (const rel of files) {
    const from = path.join(repo, rel);
    const to = path.join(target, rel);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied += 1;
    if (sha(from) !== sha(to)) mismatched.push(rel);
}

// The installed manifest must declare the views the JS registers.
const installedPkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
const views = Object.values(installedPkg.contributes?.views ?? {}).flat();
const viewIds = views.map((v) => v.id);
const chatView = 'tommysChat';
// The view is registered in extension.ts, not in the provider.
const entry = readFileSync(path.join(target, 'out', 'extension.js'), 'utf8');
const registersChat = entry.includes(`registerWebviewViewProvider('${chatView}'`);

console.log(`deploy: ${copied} files -> ${target}`);
if (mismatched.length) {
    console.error('deploy: these did not land byte-identical:\n  ' + mismatched.join('\n  '));
    process.exit(1);
}
console.log(`deploy: verified ${copied}/${files.length} files by sha256`);
console.log(`deploy: manifest declares views [${viewIds.join(', ')}]; host registers '${chatView}': ${registersChat}`);
if (viewIds.length === 0 || !registersChat) {
    console.error('deploy: manifest and host build disagree about the view — the pane will not resolve');
    process.exit(1);
}
console.log('deploy: reload the window (Developer: Reload Window) to run it.');
