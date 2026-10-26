import { byId, modelBtn, modelPicker } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { pickerRowReserve } from '../composer/composer';
import { closeAllDropdowns, setMenuOpen } from '../modals/modal';


const VENDOR_NAMES = {
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    xai: 'xAI',
    zai: 'Z.ai',
    'z-ai': 'Z.ai',
    huggingface: 'HuggingFace'
};

function vendorLabel(slug) {
    const raw = String(slug || '').trim().replace(/^custom:/i, '');
    if (!raw) return '';
    const known = VENDOR_NAMES[raw.toLowerCase()];
    if (known) return known;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function currentProviderVendor() {
    const payload = state.lastModelPayload;
    if (!payload) return '';
    const current = String(payload.currentValueId || '');
    if (!current) return '';
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const usable = function(g) {
        const name = String((g && (g.name || g.slug)) || '').trim();
        return name && name.toLowerCase() !== 'other' ? name : '';
    };
    for (let i = 0; i < groups.length; i++) {
        const gModels = Array.isArray(groups[i].models) ? groups[i].models : [];
        for (let j = 0; j < gModels.length; j++) {
            if (gModels[j] && gModels[j].valueId === current) {
                const label = usable(groups[i]);
                if (label) return label;
            }
        }
    }
    const models = Array.isArray(payload.models) ? payload.models : [];
    for (let k = 0; k < models.length; k++) {
        if (!models[k] || models[k].valueId !== current) continue;
        const display = String(models[k].name || '');
        const cut = display.indexOf(' · ');
        if (cut > 0) return display.slice(0, cut).trim();
        break;
    }
    const prefix = current.split(':')[0];
    return prefix && prefix !== current ? vendorLabel(prefix) : '';
}

const modelLabelEl = byId('modelLabel');

const modelDropdown = byId('modelDropdown');

export function initModelBtnClick(): void {
    modelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = modelPicker.dataset.open !== 'true';
        closeAllDropdowns();
        if (open) {
            setMenuOpen(modelPicker, true);
            post({ type: 'getModels' });
        }
    });
}

export function initModelDropdownClick(): void {
    modelDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
}

function shouldShowModelPlaceholder(payload) {
    if (!payload) {
        return true;
    }
    const models = payload.models || [];
    if (!models.length) {
        return true;
    }
    if (!payload.currentValueId) {
        return true;
    }
    return !models.some(function(m) {
        return m.valueId === payload.currentValueId;
    });
}

export function updateModelButtonDisplay(payload) {
    if (!modelLabelEl || !modelBtn) {
        return;
    }
    if (shouldShowModelPlaceholder(payload)) {
        modelLabelEl.textContent = locale.modelPlaceholder || '';
        modelBtn.classList.add('is-placeholder');
        modelBtn.title = locale.modelPlaceholder || locale.switchModel || '';
        return;
    }
    modelLabelEl.textContent = payload.currentLabel || payload.currentValueId || '';
    modelBtn.classList.remove('is-placeholder');
    modelBtn.title = payload.fromAgent
        ? locale.modelFromAgent
        : locale.modelLocalPreference;
    pickerRowReserve();
}

export function renderModelList(payload) {
    const list = byId('modelList');
    state.lastModelPayload = payload;
    state.modelConfigId = payload.configId || '';
    updateModelButtonDisplay(payload);

    const groups = Array.isArray(payload.groups) ? payload.groups.filter(function(g) {
        return g && Array.isArray(g.models) && g.models.length > 0;
    }) : [];
    const models = payload.models || [];

    if (!models.length) {
        list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.noModels) + '</div>';
        return;
    }

    if (groups.length > 1) {
        list.innerHTML = groups.map(function(group) {
            const header = '<div class="dropdown-group-label">' + escapeHtml(group.name || group.slug || '') + '</div>';
            const items = group.models.map(function(m) {
                const active = m.valueId === payload.currentValueId;
                return '<div class="dropdown-item' + (active ? ' active' : '') + '" data-value="' + escapeHtml(m.valueId) + '">' +
                    escapeHtml(m.name) + (active ? ' ✓' : '') + '</div>';
            }).join('');
            return header + items;
        }).join('');
    } else {
        list.innerHTML = models.map(function(m) {
            const active = m.valueId === payload.currentValueId;
            return '<div class="dropdown-item' + (active ? ' active' : '') + '" data-value="' + escapeHtml(m.valueId) + '">' +
                escapeHtml(m.name) + (active ? ' ✓' : '') + '</div>';
        }).join('');
    }
    list.querySelectorAll('.dropdown-item[data-value]').forEach(function(item) {
        item.addEventListener('click', function() {
            post({
                type: 'switchModel',
                configId: state.modelConfigId,
                valueId: this.dataset.value
            });
            closeAllDropdowns();
        });
    });
}
