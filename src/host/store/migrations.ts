import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Project, SessionInfo } from '../../shared/chat';
import { legacySecondantHome, writeAtomic } from './connection';
import { activeSessionPathFor, profileDir, sessionsPathFor } from './paths';
import { ProfilesStore } from './profiles';

/**
 * The one-time fixes to the data home, run at every activation and safe to re-run.
 *
 * Each step below is written as "make the new shape true if it is not already": a first run moves
 * or copies, a second run finds nothing to do and writes nothing. That is what lets the extension
 * run these on startup without a schema version to bump and without a half-applied state to
 * recover from.
 *
 * The order matters and is not the order of the commit that added each step:
 *
 *   1. a backup of the whole home, before anything below touches it;
 *   2. the old global `sessions.json` into the default profile's folder;
 *   3. our own profile folders from a name to `sessionProfileId`;
 *   4. the secondant's own home, merged in by session;
 *   5. the attachments index from a profile name to `sessionProfileId`;
 *   6. the permission roots out of `workspaces.json` into the profile.
 */

/** What a step needs to know about a folder that is only a name: which agent it belonged to. */
export type AgentResolver = (scopeKey: string, sessionIds: string[]) => string | undefined;

/** A step says what it did, in the output log. Silence means there was nothing to do. */
export type MigrationsLog = (line: string) => void;

/** A `sessionProfileId` is a UUID; a folder named like one is already migrated. */
const ID_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Today as `yyyymmdd`, for the backup's folder name. */
export function backupStamp(now = new Date()): string {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

/**
 * Copy the whole data home to `<home>.backup-<yyyymmdd>`, once.
 *
 * A copy, not a move: every migration below can then be judged against it by hand. An existing
 * backup is never overwritten — the first one is the state before the first migration, and a later
 * activation must not replace it with a state that is already half migrated.
 */
export function backupDataHome(home: string, log: MigrationsLog, now = new Date()): string | undefined {
    const target = `${home}.backup-${backupStamp(now)}`;
    if (fs.existsSync(target)) {
        log(`Backup: ${path.basename(target)} exists, left as it is`);
        return target;
    }
    if (!fs.existsSync(home)) {
        return undefined;
    }
    try {
        fs.cpSync(home, target, { recursive: true, force: false, errorOnExist: true });
        log(`Backup: ${path.basename(target)} written`);
        return target;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Backup failed: ${message}`);
        return undefined;
    }
}

/**
 * Move the pre-profile `sessions.json` into the default profile's folder, once.
 *
 * It lived at the root of the data home before tabs were per profile. The folder it lands in is
 * still named by a scope key here; the folder migration that follows renames it.
 */
function migrateLegacySessionLayout(home: string, log: MigrationsLog): void {
    const legacySessions = path.join(home, 'sessions.json');
    if (!fs.existsSync(legacySessions)) {
        return;
    }
    const defaultScopeKey = '__default__';
    const targetSessions = sessionsPathFor(home, defaultScopeKey);
    if (fs.existsSync(targetSessions)) {
        return;
    }
    profileDir(home, defaultScopeKey);
    fs.renameSync(legacySessions, targetSessions);
    const legacyActive = path.join(home, 'active-session.txt');
    if (fs.existsSync(legacyActive)) {
        fs.renameSync(legacyActive, activeSessionPathFor(home, defaultScopeKey));
    }
    log('Migration: the root sessions.json moved into the default profile');
}

/**
 * Our own profile folders, from a name to the agent's `sessionProfileId`.
 *
 * A name changes when Hermes renames a profile; the id never does, so a folder is renamed once and
 * then keyed by something that cannot move. The name→agent question is the caller's: it owns the
 * table and the two fallbacks that find a renamed profile.
 *
 * The folder is moved when the id folder does not exist yet. When it does (an earlier partial run,
 * or the same agent connected in both extensions) the two are merged, which never overwrites a tag
 * with an empty one.
 */
function migrateProfileFolders(
    home: string,
    store: ProfilesStore,
    agentForScope: AgentResolver,
    log: MigrationsLog,
): void {
    const root = path.join(home, 'profiles');
    for (const name of folderNames(root)) {
        if (ID_FOLDER.test(name)) {
            continue;
        }
        const source = path.join(root, name);
        const agent = agentForScope(name, sessionIdsIn(source));
        if (!agent) {
            log(`Migration: profiles/${name} names no agent, left as it is`);
            continue;
        }
        const id = store.idFor(agent);
        if (id === name) {
            continue;
        }
        const target = path.join(root, id);
        if (!fs.existsSync(target)) {
            fs.renameSync(source, target);
            log(`Migration: profiles/${name} moved to ${agent}'s id folder`);
            continue;
        }
        mergeProfileFolder(source, target, log, `profiles/${name}`);
    }
}

/**
 * Put everything in `source` into `target`, one record at a time.
 *
 * The rules are the same whether the source is a folder of ours from before the rename or a folder
 * from the secondant's own home:
 *   - a tab is the same tab when both carry the same Hermes session id (or the same local id);
 *     an existing tab takes only the fields it does not have, so a tag is never replaced by an
 *     empty one, and a field both sides set keeps the target's (logged);
 *   - projects are a union on name and workspace, and the source's project ids are mapped onto the
 *     merged ones so moved tabs keep their group;
 *   - every other file is copied when the target does not have it, never overwritten.
 *
 * Nothing is written unless the merged value differs: a second run over the same folder is a no-op.
 */
export function mergeProfileFolder(source: string, target: string, log: MigrationsLog, label?: string): void {
    const name = label || path.basename(source);
    fs.mkdirSync(target, { recursive: true });

    const sourceProjects = readJson<Project[]>(path.join(source, 'projects.json'), []);
    const targetProjects = readJson<Project[]>(path.join(target, 'projects.json'), []);
    const { projects, bySourceId } = mergeProjects(sourceProjects, targetProjects, name, log);
    if (JSON.stringify(projects) !== JSON.stringify(targetProjects)) {
        writeAtomic(path.join(target, 'projects.json'), projects);
        const added = projects.length - targetProjects.length;
        log(`Migration: ${name} projects merged (${added > 0 ? added + ' added' : 'ids mapped'})`);
    }

    const sourceTabs = readJson<SessionInfo[]>(path.join(source, 'sessions.json'), []);
    const targetTabs = readJson<SessionInfo[]>(path.join(target, 'sessions.json'), []);
    const { tabs: mergedTabs, conflicts } = mergeTabs(sourceTabs, targetTabs, bySourceId, name);
    if (JSON.stringify(mergedTabs) !== JSON.stringify(targetTabs)) {
        writeAtomic(path.join(target, 'sessions.json'), mergedTabs);
        log(`Migration: ${name} tabs merged (${mergedTabs.length - targetTabs.length} added)`);
        // A conflict is only news when this run actually changed the file: a second run over the
        // same folder would otherwise repeat it at every activation.
        for (const line of conflicts) {
            log(line);
        }
    }

    const activeSource = path.join(source, 'active-session.txt');
    const activeTarget = path.join(target, 'active-session.txt');
    if (fs.existsSync(activeSource) && !fs.existsSync(activeTarget)) {
        fs.copyFileSync(activeSource, activeTarget);
    }

    let copied = 0;
    for (const file of fs.readdirSync(source, { withFileTypes: true })) {
        if (!file.isFile()) {
            continue;
        }
        if (file.name === 'sessions.json' || file.name === 'projects.json' || file.name === 'active-session.txt') {
            continue;
        }
        const destination = path.join(target, file.name);
        if (!fs.existsSync(destination)) {
            fs.copyFileSync(path.join(source, file.name), destination);
            copied += 1;
        }
    }
    if (copied > 0) {
        log(`Migration: ${name} ${copied} file(s) copied in`);
    }
}

/** Projects as a union on (name, workspace). A moved tab's project id is mapped, never lost. */
function mergeProjects(
    source: Project[],
    target: Project[],
    label: string,
    log: MigrationsLog,
): { projects: Project[]; bySourceId: Map<string, string> } {
    const projects = target.slice();
    const bySourceId = new Map<string, string>();
    for (const project of source) {
        if (!project || typeof project.name !== 'string') {
            continue;
        }
        const existing = projects.find(entry => entry.name === project.name && entry.workspaceId === project.workspaceId);
        if (existing) {
            bySourceId.set(project.id, existing.id);
            continue;
        }
        const id = projects.some(entry => entry.id === project.id) ? randomUUID() : project.id;
        projects.push({ ...project, id });
        bySourceId.set(project.id, id);
        log(`Migration: ${label} project "${project.name}" taken over`);
    }
    return { projects, bySourceId };
}

/**
 * Tabs as a union on the Hermes session.
 *
 * The same conversation connected in two places is one tab: the target keeps its title, order and
 * tags, and takes what it is missing from the source. Two different values for a tag or a workspace
 * are a conflict the target wins — logged, never silently overruled.
 */
function mergeTabs(
    source: SessionInfo[],
    target: SessionInfo[],
    bySourceProjectId: Map<string, string>,
    label: string,
): { tabs: SessionInfo[]; conflicts: string[] } {
    const tabs = target.slice();
    const conflicts: string[] = [];
    for (const incomingRaw of source) {
        if (!incomingRaw || typeof incomingRaw.id !== 'string') {
            continue;
        }
        const incoming: SessionInfo = {
            ...incomingRaw,
            project: incomingRaw.project ? bySourceProjectId.get(incomingRaw.project) || incomingRaw.project : incomingRaw.project,
        };
        const existing = tabs.find(tab =>
            (incoming.hermesSessionId && tab.hermesSessionId === incoming.hermesSessionId) || tab.id === incoming.id);
        if (!existing) {
            tabs.push(incoming);
            continue;
        }
        for (const field of ['workspaceId', 'project', 'cwd', 'hermesSessionId', 'modelId', 'modelLabel'] as const) {
            const have = existing[field];
            const theirs = incoming[field];
            if ((have === undefined || have === '') && theirs) {
                (existing as unknown as Record<string, unknown>)[field] = theirs;
                continue;
            }
            if (have && theirs && have !== theirs) {
                conflicts.push(`Migration: ${label} tab ${existing.id} keeps its ${field} ("${have}" over "${theirs}")`);
            }
        }
        if (incoming.sticky && !existing.sticky) {
            existing.sticky = true;
        }
    }
    return { tabs, conflicts };
}

/** The folders under `profiles/`, sorted, so a run always visits them in the same order. */
function folderNames(root: string): string[] {
    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
    } catch {
        return [];
    }
}

/** The Hermes session ids a profile folder holds: the second fallback's question. */
function sessionIdsIn(folder: string): string[] {
    return readJson<SessionInfo[]>(path.join(folder, 'sessions.json'), [])
        .map(tab => (tab && typeof tab.hermesSessionId === 'string' ? tab.hermesSessionId : ''))
        .filter(Boolean);
}

function readJson<T>(target: string, fallback: T): T {
    try {
        const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
        return Array.isArray(parsed) ? parsed as T : fallback;
    } catch {
        return fallback;
    }
}

/**
 * The secondant's own home, merged in by session. Its folder is read, never written, never removed:
 * it also keeps the secondant's documents, and a copy is the only thing this migration makes.
 *
 * The centre wins where both have something: the same tab keeps its tags and its project, and takes
 * only what it is missing. The secondant's `workspaces.json` and `pending_*.json` are not merged —
 * a pending turn is a live fact of that window, not a record to copy.
 */
function mergeSecondantHome(
    home: string,
    store: ProfilesStore,
    agentForScope: AgentResolver,
    log: MigrationsLog,
    sourceHome: string,
): void {
    const root = path.join(sourceHome, 'profiles');
    for (const name of folderNames(root)) {
        const source = path.join(root, name);
        const agent = agentForScope(name, sessionIdsIn(source));
        if (!agent) {
            log(`Migration: secondant profiles/${name} names no agent, left as it is`);
            continue;
        }
        mergeProfileFolder(source, path.join(home, 'profiles', store.idFor(agent)), log, `secondant profiles/${name}`);
    }
    // The images themselves are content-addressed files, not rows: copy the ones the centre does
    // not have, so a tab moved in from the secondant still shows what it carried. The secondant's
    // own index is not copied — its rows are converted where the rows live (the attachments step).
    const images = path.join(sourceHome, 'attachments');
    let copied = 0;
    try {
        fs.mkdirSync(path.join(home, 'attachments'), { recursive: true });
        for (const file of fs.readdirSync(images, { withFileTypes: true })) {
            if (!file.isFile() || file.name === 'index.json') {
                continue;
            }
            const destination = path.join(home, 'attachments', file.name);
            if (!fs.existsSync(destination)) {
                fs.copyFileSync(path.join(images, file.name), destination);
                copied += 1;
            }
        }
    } catch { /* no attachments folder, or one this process cannot read: nothing to copy */ }
    if (copied > 0) {
        log(`Migration: ${copied} attachment file(s) copied in from the secondant`);
    }
}

/**
 * The attachments index: a row names its agent by our id, not by Hermes' name.
 *
 * Entries written before the key moved carry `profile` (the name). A name that is in the table is
 * converted here and dropped; a name nobody answers for is left exactly as it is — it matches no
 * conversation now, which is the honest state of a row whose agent we cannot name.
 */
function migrateAttachmentsIndex(home: string, store: ProfilesStore, log: MigrationsLog): void {
    const indexPath = path.join(home, 'attachments', 'index.json');
    if (!fs.existsSync(indexPath)) {
        return;
    }
    const entries = readJson<Array<Record<string, unknown>>>(indexPath, []);
    const rows = store.all();
    const unknown = new Set<string>();
    let converted = 0;
    const next = entries.map(entry => {
        if (!entry || typeof entry !== 'object') {
            return entry;
        }
        const name = typeof entry.profile === 'string' ? entry.profile : '';
        if (!name || typeof entry.sessionProfileId === 'string') {
            return entry;
        }
        const id = rows.find(row => row.agentName === name)?.sessionProfileId;
        if (!id) {
            unknown.add(name);
            return entry;
        }
        const { profile: _legacyName, ...rest } = entry;
        converted += 1;
        return { ...rest, sessionProfileId: id };
    });
    if (converted > 0) {
        writeAtomic(indexPath, next);
        log(`Migration: ${converted} attachment row(s) re-keyed by the agent id`);
    }
    for (const name of unknown) {
        log(`Migration: attachment rows for "${name}" name no agent, left as they are`);
    }
}

/**
 * Run every step, in order, from the composition root at activation.
 *
 * Nothing here throws: a migration that cannot finish logs and leaves the file as it found it, so a
 * broken migration costs the migration, never the extension.
 */
export function runMigrations(
    home: string,
    agentForScope: AgentResolver,
    log: MigrationsLog,
    /** Where the secondant kept its own data; a caller with a temp home passes its own. */
    secondantHome = legacySecondantHome(),
): void {
    backupDataHome(home, log);
    migrateLegacySessionLayout(home, log);
    const store = new ProfilesStore(home);
    migrateProfileFolders(home, store, agentForScope, log);
    if (secondantHome && secondantHome !== home && fs.existsSync(secondantHome)) {
        mergeSecondantHome(home, store, agentForScope, log, secondantHome);
    }
    migrateAttachmentsIndex(home, store, log);
}
