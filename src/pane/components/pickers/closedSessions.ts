import { byId, closedPicker, closedPickerBtn, closedPickerLabel, openTabBtn } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { newChat } from '../messages/messageList';
import { closeAllDropdowns, setMenuOpen, wirePickerButton } from '../modals/modal';


const closedDropdown = byId('closedDropdown');

const closedList = byId('closedList');

export function initOpenTabBtnClick(): void {
    openTabBtn.addEventListener('click', function() {
        post({ type: 'openTab', sessionId: state.pendingOpenSessionId || undefined });
        state.pendingOpenSessionId = null;
        renderClosedList();
    });
}

export function initClosedPickerBtnClick(): void {
    wirePickerButton(closedPickerBtn, closedPicker, function() {
        post({ type: 'getHiddenSessions' });
        renderClosedList();
    });
}

export function initClosedDropdownClick(): void {
    closedDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
}

export function renderClosedList() {
    if (!closedList) return;
    // Picking a session closes this menu, so the toolbar has to carry the choice or
    // nothing on screen changes until Open Tab is pressed.
    const picked = state.pendingOpenSessionId !== null;
    if (closedPicker) closedPicker.classList.toggle('is-empty', !picked);
    if (closedPickerLabel) {
        closedPickerLabel.textContent = picked
            ? state.pendingOpenTitle + (state.pendingOpenCount ? ' · ' + state.pendingOpenCount : '')
            : locale.chooseChat;
    }
    if (closedPickerBtn) {
        closedPickerBtn.title = picked && state.pendingOpenTitle
            ? locale.openTab + ': ' + state.pendingOpenTitle
            : locale.chooseChat;
    }
    const rows = [
        '<div class="dropdown-item' + (state.pendingOpenSessionId === null ? ' active' : '') + '" data-closed="new">' +
            escapeHtml(locale.newChat) + (state.pendingOpenSessionId === null ? ' ✓' : '') + '</div>'
    ];
    if (!state.closedSessions.length) {
        rows.push('<div class="dropdown-divider"></div>');
        rows.push('<div class="dropdown-item disabled">' + escapeHtml(locale.noClosedSessions) + '</div>');
    } else {
        rows.push('<div class="dropdown-group-label">' + escapeHtml(locale.closedSessionsHeader) + '</div>');
        for (const session of state.closedSessions) {
            const active = state.pendingOpenSessionId === session.sessionId;
            const title = String(session.title || session.sessionId.slice(0, 8));
            const meta = session.messageCount ? ' · ' + session.messageCount : '';
            rows.push('<div class="dropdown-item' + (active ? ' active' : '') + '" data-closed="' + escapeHtml(session.sessionId) + '">' +
                escapeHtml(title) + '<span class="meta">' + escapeHtml(meta) + '</span>' +
                (active ? ' ✓' : '') + '</div>');
        }
    }
    closedList.innerHTML = rows.join('');
    closedList.querySelectorAll('.dropdown-item[data-closed]').forEach(function(item) {
        item.addEventListener('click', function(this: HTMLElement) {
            const pickedId = this.dataset.closed === 'new' ? null : this.dataset.closed;
            const picked = pickedId
                ? state.closedSessions.find(function(s) { return s.sessionId === pickedId; })
                : null;
            state.pendingOpenSessionId = pickedId;
            state.pendingOpenTitle = picked ? String(picked.title || picked.sessionId.slice(0, 8)) : '';
            state.pendingOpenCount = picked && picked.messageCount ? picked.messageCount : 0;
            setMenuOpen(closedPicker, false);
            renderClosedList();
        });
    });
}
