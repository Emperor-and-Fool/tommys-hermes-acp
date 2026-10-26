/* Session memory: the dropdown of other sessions, and the chip of the staged pick.
 *
 * The list needs no host message: the pane already holds the open tabs (sessionList) and the
 * hidden ones (hiddenSessions). Picking one opens the read-only viewer; what comes back is a
 * staged ref, which turns into the block the next send carries.
 */
import { contextAttachBtn, contextAttachLabel, contextAttachPicker, historyChip, historyChipClear, historyChipPending, historyChipText, historySessionList } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import type { HistoryRef } from '../../../shared/chat';

/** One row of the dropdown: a session the viewer can be opened on. */
interface PickerRow {
    sessionId: string;
    title: string;
    hidden: boolean;
}

/** The staged pick, as the host last stated it. */
let staged: HistoryRef | null = null;

let pending = false;

function currentSessionIds(): Set<string> {
    const ids = new Set<string>();
    if (state.lastActiveSessionId) {
        ids.add(state.lastActiveSessionId);
    }
    return ids;
}

/** Open tabs first, then what Hermes flagged hidden; the current session is never offered. */
function sessionRows(): PickerRow[] {
    const rows: PickerRow[] = [];
    const seen = new Set<string>();
    const excluded = currentSessionIds();

    (state.lastSessions || []).forEach(function(session) {
        if (!session || !session.id) {
            return;
        }
        const hermesId = session.hermesSessionId || session.id;
        if (excluded.has(session.id) || excluded.has(hermesId) || seen.has(hermesId)) {
            return;
        }
        seen.add(hermesId);
        rows.push({ sessionId: hermesId, title: session.title || '', hidden: false });
    });

    (state.closedSessions || []).forEach(function(session) {
        const id = session && session.sessionId;
        if (!id || excluded.has(id) || seen.has(id)) {
            return;
        }
        seen.add(id);
        rows.push({ sessionId: id, title: session.title || '', hidden: true });
    });

    return rows;
}

function setPickerOpen(open: boolean): void {
    if (!contextAttachPicker) {
        return;
    }
    contextAttachPicker.dataset.open = open ? 'true' : 'false';
    contextAttachPicker.classList.toggle('is-open', open);
    if (open) {
        // The other pickers are the modal module's business, but only one may be open.
        document.querySelectorAll('.picker.is-open').forEach(function(other) {
            if (other !== contextAttachPicker) {
                other.classList.remove('is-open');
                (other as HTMLElement).dataset.open = 'false';
            }
        });
    }
}

function closePicker(): void {
    setPickerOpen(false);
}

function pickSession(row: PickerRow): void {
    closePicker();
    post({
        type: 'openHistoryViewer',
        sessionId: row.sessionId,
        title: row.title || locale.newChat || '',
    });
}

/** Draw the dropdown from the two lists the pane already has. */
export function renderHistorySessionList(): void {
    if (!historySessionList) {
        return;
    }
    historySessionList.textContent = '';
    const rows = sessionRows();
    if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'history-session-empty';
        empty.textContent = locale.historyPickerEmpty || '';
        historySessionList.appendChild(empty);
        return;
    }
    rows.forEach(function(row) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'dropdown-item history-session-item';
        item.dataset.sessionId = row.sessionId;
        const title = document.createElement('span');
        title.className = 'history-session-title';
        title.textContent = row.title || locale.newChat || '';
        item.appendChild(title);
        if (row.hidden) {
            const flag = document.createElement('span');
            flag.className = 'history-session-flag';
            flag.textContent = locale.historyPickerHidden || '';
            item.appendChild(flag);
        }
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            pickSession(row);
        });
        historySessionList.appendChild(item);
    });
}

/** The chip: "{n} messages from {title}", a looking-up state, and the X. */
function renderHistoryChip(): void {
    if (!historyChip) {
        return;
    }
    if (!staged) {
        historyChip.hidden = true;
        return;
    }
    historyChip.hidden = false;
    historyChip.classList.toggle('is-pending', pending);
    if (historyChipText) {
        historyChipText.textContent = (locale.historyChipSummary || '{0} messages from {1}')
            .replace('{0}', String(staged.count))
            .replace('{1}', staged.title || '');
    }
    if (historyChipPending) {
        historyChipPending.hidden = !pending;
        historyChipPending.textContent = locale.historyChipPending || '';
    }
    if (historyChipClear) {
        historyChipClear.title = locale.historyChipClear || '';
        historyChipClear.setAttribute('aria-label', locale.historyChipClear || 'X');
    }
}

export function applyHistoryStaged(ref: HistoryRef, isPending: boolean): void {
    staged = ref;
    pending = isPending;
    renderHistoryChip();
}

export function applyHistoryCleared(): void {
    staged = null;
    pending = false;
    renderHistoryChip();
}

/** Restart one of the picker's motions; the class comes off when its animation ends. */
function replayMotion(picker: HTMLElement, cls: string, animationName: string): void {
    picker.classList.remove(cls);
    void picker.offsetWidth;
    picker.classList.add(cls);
    const done = function(e: AnimationEvent) {
        if (e.animationName !== animationName) {
            return;
        }
        picker.classList.remove(cls);
        picker.removeEventListener('animationend', done);
    };
    picker.addEventListener('animationend', done);
}

/** An empty session: the full label moves in and glows three times, when there is a session to pick. */
export function playHistoryPickerIntro(): void {
    if (!contextAttachPicker || document.body.classList.contains('is-viewer') || sessionRows().length === 0) {
        return;
    }
    replayMotion(contextAttachPicker, 'is-entering', 'context-attach-enter');
    replayMotion(contextAttachPicker, 'is-attention', 'context-attach-attention-pulse');
}

/** Labels, tooltip and list on every locale change (and at boot). */
export function applyHistoryPickerLocale(): void {
    const placeholder = locale.historyPickerPlaceholder || 'Select session memory';
    if (contextAttachLabel) {
        contextAttachLabel.textContent = placeholder;
    }
    if (contextAttachBtn) {
        contextAttachBtn.title = placeholder;
        contextAttachBtn.setAttribute('aria-label', placeholder);
    }
    const header = document.getElementById('historyPickerHeader');
    if (header) {
        header.textContent = locale.historyPickerHeader || '';
    }
    renderHistorySessionList();
    renderHistoryChip();
}

export function initHistoryAttach(): void {
    if (contextAttachBtn && contextAttachPicker) {
        contextAttachBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = contextAttachPicker.dataset.open !== 'true';
            renderHistorySessionList();
            setPickerOpen(open);
        });
        const dropdown = document.getElementById('contextAttachDropdown');
        if (dropdown) {
            dropdown.addEventListener('click', function(e) { e.stopPropagation(); });
        }
    }
    if (historyChipClear) {
        historyChipClear.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!staged) {
                return;
            }
            post({ type: 'clearHistoryStaged' });
        });
    }
    applyHistoryPickerLocale();
}
