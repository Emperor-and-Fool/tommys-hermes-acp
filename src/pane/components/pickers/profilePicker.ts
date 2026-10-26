import { byId, profileBtn, profilePicker } from '../../dom';
import { post } from '../../post';
import { escapeHtml } from '../../util/html';
import { closeAllDropdowns, setMenuOpen } from '../modals/modal';


export function profileDisplayName() {
    const el = byId('profileLabel');
    const text = el && el.textContent ? el.textContent.trim() : '';
    return text || 'hermes';
}

const profileDropdown = byId('profileDropdown');

export function initProfileBtnClick(): void {
    profileBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = profilePicker.dataset.open !== 'true';
        closeAllDropdowns();
        if (open) {
            setMenuOpen(profilePicker, true);
            post({ type: 'getProfiles' });
        }
    });
}

export function initProfileDropdownClick(): void {
    profileDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
}

export function renderProfileList(profiles) {
    const list = byId('profileList');
    const current = byId('profileLabel').textContent;
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
        item.addEventListener('click', function() {
            post({ type: 'switchAgent', agentName: this.dataset.profile });
            closeAllDropdowns();
        });
    });
}
