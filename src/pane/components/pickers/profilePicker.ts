import { byId, profileBtn, profilePicker, required } from '../../dom';
import { post } from '../../post';
import { escapeHtml } from '../../util/html';
import { closeAllDropdowns, setMenuOpen, wirePickerButton } from '../modals/modal';


export function profileDisplayName() {
    const el = required('profileLabel');
    const text = el && el.textContent ? el.textContent.trim() : '';
    return text || 'hermes';
}

const profileDropdown = required('profileDropdown');

/** Opened by the host: the profile this pane was using is not available any more. */
export function openProfilePicker(): void {
    closeAllDropdowns();
    setMenuOpen(profilePicker, true);
    post({ type: 'getProfiles' });
}

export function initProfileBtnClick(): void {
    wirePickerButton(profileBtn, profilePicker, function() {
        post({ type: 'getProfiles' });
    });
}

export function initProfileDropdownClick(): void {
    profileDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
}

export function renderProfileList(profiles) {
    const list = required('profileList');
    const current = required('profileLabel').textContent;
    const entries = (profiles || []).map(function(item) {
        if (item && typeof item === 'object' && item.id) {
            return { id: String(item.id), label: String(item.label || item.id) };
        }
        const name = String(item || '');
        return { id: name, label: name };
    });
    if (!entries.length) {
        list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.configureAgents) + '</div>';
        return;
    }
    list.innerHTML = entries.map(function(entry) {
        const active = entry.label === current ? ' active' : '';
        return '<div class="dropdown-item' + active + '" data-profile="' + escapeHtml(entry.id) + '">' +
            escapeHtml(entry.label) + (active ? ' ✓' : '') + '</div>';
    }).join('');
    list.querySelectorAll('.dropdown-item[data-profile]').forEach(function(item) {
        item.addEventListener('click', function(this: HTMLElement) {
            const agentName = this.dataset.profile;
            if (!agentName) return;
            post({ type: 'switchAgent', agentName });
            closeAllDropdowns();
        });
    });
}
