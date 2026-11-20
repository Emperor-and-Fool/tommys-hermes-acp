import { byId } from '../../dom';
import { post } from '../../post';
import { pressRootButton, shouldShowRow, type RootFacts } from './rootRow';

/** The row is open because this surface's own button was pressed, or the host asked. */
let open = false;
/** The last facts the host sent, so a click can draw before the answer arrives. */
let facts: RootFacts | undefined;

/**
 * The permission root in the pane: a button in the rail showing the folder Hermes works in, and the
 * row it opens — which the host also opens by itself whenever the folder list changes and there is
 * something to choose between.
 *
 * A single-folder window has no choice to offer, so the button stays hidden; a window with no folder
 * has nothing at all, and the warning the host sends is the only thing to say.
 */
export function initPermissionRoot(): void {
    const btn = byId('permissionRootBtn');
    if (btn) {
        btn.addEventListener('click', function () {
            // The button toggles, like the permission-mode one: a closed row opens, an open one
            // closes through the X's path. This surface owns that; the host only hears the message.
            open = pressRootButton(open, msg => post(msg));
            drawRow();
        });
    }
    const close = byId('permissionRootClose');
    if (close) {
        close.addEventListener('click', function () {
            // The X is the same press while the row is open: one path, one message.
            open = pressRootButton(true, msg => post(msg));
            drawRow();
        });
    }
}

/** Draw the row from the facts on hand and the local open state. */
function drawRow(): void {
    const btn = byId('permissionRootBtn');
    if (btn) {
        // The button is the row's own switch: what it opened, it closes.
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    const bar = byId('permissionRootBar');
    if (!bar || !facts) {
        return;
    }
    bar.hidden = !shouldShowRow(facts, open);
    if (bar.hidden) {
        delete bar.dataset.open;
    } else {
        bar.dataset.open = 'true';
    }
}

/** The host's answer: what the root is, which folders it may be, and whether to open the row. */
export function applyPermissionRootState(msg: RootFacts & { open: boolean }): void {
    facts = {
        root: msg.root,
        folders: msg.folders,
        offered: msg.offered,
        profile: msg.profile,
        newFolders: msg.newFolders || [],
        missingFolders: msg.missingFolders || [],
        ...(msg.notice ? { notice: msg.notice } : {}),
        ...(msg.noticeFolder ? { noticeFolder: msg.noticeFolder } : {}),
        ...(msg.noticePrevious ? { noticePrevious: msg.noticePrevious } : {}),
    };
    // `open` is the host's automatic open, and it is only ever sent to a surface meant to show it.
    if (msg.open) {
        open = true;
    }
    const btn = byId('permissionRootBtn');
    const label = byId('permissionRootBtnLabel');
    const tip = locale.permissionRootLabel || 'Permission root';
    if (btn) {
        btn.title = tip;
        btn.setAttribute('aria-label', tip);
        // Only a window with folders to choose between has a picker at all.
        btn.hidden = msg.offered.length === 0;
    }
    if (label) {
        label.textContent = msg.root ? baseName(msg.root) : tip;
        label.title = msg.root;
    }

    const title = byId('permissionRootTitle');
    if (title) {
        title.textContent = locale.permissionRootTitle || 'Permission root';
    }
    const body = byId('permissionRootBody');
    if (body) {
        body.textContent = (locale.permissionRootBody
            || 'This workspace opens {folders} folders side by side. Hermes can work in one of them. '
                + 'Choose the folder {profile} works in; outside it, edits ask for permission.')
            .replace('{folders}', String(msg.folders.length))
            .replace('{profile}', msg.profile);
    }

    const notice = byId('permissionRootNotice');
    if (notice) {
        const folder = baseName(msg.noticeFolder || '');
        const previous = baseName(msg.noticePrevious || '');
        const text = msg.notice === 'lastRootRemoved'
            ? (locale.permissionRootLastRemoved
                || 'Last root removed: projects are no longer reachable from this window. Their '
                    + 'sessions stay untagged, available only through the Hermes TUI or by reopening the folder.')
            : msg.notice === 'appliesNextRun'
                ? (locale.appliesNextRun || 'Applies from the next run.')
                : msg.notice === 'moveRefused'
                    ? (locale.permissionRootMoveRefused
                        || 'Hermes could not move this session to {folder}. It stays in {previous}.')
                        .replace('{folder}', folder)
                        .replace('{previous}', previous)
                    : msg.notice === 'rootRemoved'
                        ? (locale.permissionRootRootRemoved
                            || '{folder} left the workspace. This session still works there until '
                                + 'you pick another root.')
                            .replace('{folder}', folder)
                        : '';
        notice.textContent = text;
        notice.hidden = !text;
    }

    const options = byId('permissionRootOptions');
    if (options) {
        const fresh = new Set(msg.newFolders || []);
        const missing = new Set(msg.missingFolders || []);
        options.textContent = '';
        msg.offered.forEach(function (folder) {
            const isNew = fresh.has(folder);
            const isMissing = missing.has(folder);
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'permission-root-option' + (folder === msg.root ? ' is-current' : '')
                + (isNew ? ' is-new' : '')
                + (isMissing ? ' is-missing' : '');
            choice.dataset.root = folder;
            choice.textContent = baseName(folder);
            choice.title = isMissing
                ? `${folder} — ${locale.permissionRootMissing || 'missing'}`
                : folder;
            choice.setAttribute('aria-pressed', folder === msg.root ? 'true' : 'false');
            if (isNew) {
                // Behind the folder's own name: the word says what the colour means.
                const badge = document.createElement('span');
                badge.className = 'permission-root-new';
                badge.textContent = locale.permissionRootNew || 'New';
                choice.appendChild(badge);
            }
            if (isMissing) {
                // Same place as "New": a folder whose path is gone cannot be worked in.
                choice.disabled = true;
                const badge = document.createElement('span');
                badge.className = 'permission-root-missing';
                badge.textContent = locale.permissionRootMissing || 'missing';
                choice.appendChild(badge);
            }
            choice.addEventListener('click', function () {
                post({ type: 'setPermissionRoot', root: folder });
            });
            options.appendChild(choice);
        });
    }

    drawRow();
}

/** The folder's own name: what a reader calls it, and what fits in a rail button. */
function baseName(folder: string): string {
    const parts = (folder || '').replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || folder;
}
