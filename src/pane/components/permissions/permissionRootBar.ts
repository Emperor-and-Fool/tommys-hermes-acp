import { byId } from '../../dom';
import { post } from '../../post';

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
            post({ type: 'openPermissionRoot' });
        });
    }
    const close = byId('permissionRootClose');
    if (close) {
        close.addEventListener('click', function () {
            const bar = byId('permissionRootBar');
            if (bar) {
                bar.hidden = true;
            }
        });
    }
}

/** The host's answer: what the root is, which folders it may be, and whether to open the row. */
export function applyPermissionRootState(msg: {
    root: string;
    folders: string[];
    offered: string[];
    open: boolean;
    profile: string;
    notice?: 'lastRootRemoved' | 'appliesNextRun';
}): void {
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
        const text = msg.notice === 'lastRootRemoved'
            ? (locale.permissionRootLastRemoved
                || 'Last root removed: projects are no longer reachable from this window. Their '
                    + 'sessions stay untagged, available only through the Hermes TUI or by reopening the folder.')
            : msg.notice === 'appliesNextRun'
                ? (locale.permissionRootNextRun || 'Applies from the next run.')
                : '';
        notice.textContent = text;
        notice.hidden = !text;
    }

    const options = byId('permissionRootOptions');
    if (options) {
        options.textContent = '';
        msg.offered.forEach(function (folder) {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'permission-root-option' + (folder === msg.root ? ' is-current' : '');
            choice.dataset.root = folder;
            choice.textContent = baseName(folder);
            choice.title = folder;
            choice.setAttribute('aria-pressed', folder === msg.root ? 'true' : 'false');
            choice.addEventListener('click', function () {
                post({ type: 'setPermissionRoot', root: folder });
            });
            options.appendChild(choice);
        });
    }

    const bar = byId('permissionRootBar');
    if (bar) {
        bar.hidden = !(msg.open && msg.offered.length > 0) && !msg.notice;
        if (!bar.hidden) {
            bar.dataset.open = 'true';
        } else {
            delete bar.dataset.open;
        }
    }
}

/** The folder's own name: what a reader calls it, and what fits in a rail button. */
function baseName(folder: string): string {
    const parts = (folder || '').replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || folder;
}
