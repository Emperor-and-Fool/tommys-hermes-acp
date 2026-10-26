import { byId, messagesEl, statusText } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { createGroup, maybeScrollToBottom } from './messageList';
import { enableStopAfterAgentOutput, finalizeAssistantBubble } from './streaming';


const PERM_COLLAPSED_LINES = 3;

const PERM_LINE_HEIGHT_EM = 1.45;

function permissionBodyText(title, detail) {
    const parts = [];
    if (title) parts.push(String(title));
    if (detail && String(detail).trim()) parts.push(String(detail).trim());
    return parts.join('\n\n');
}

function permissionOptionLabel(opt) {
    const kind = String(opt.kind || '').toLowerCase().replace(/-/g, '_');
    const id = String(opt.optionId || '').toLowerCase().replace(/-/g, '_');
    const map = {
        allow_once: 'permissionAllowOnce',
        allow_always: 'permissionAllowAlways',
        allow_session: 'permissionAllowSession',
        reject_once: 'permissionRejectOnce',
        reject_always: 'permissionRejectAlways',
        deny_once: 'permissionRejectOnce',
        deny_always: 'permissionRejectAlways',
        deny: 'permissionDeny',
    };
    let key = map[id] || map[kind];
    const tokens = [id, kind].filter(Boolean);
    if (!key) {
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].indexOf('allow') >= 0 && tokens[i].indexOf('session') >= 0) {
                key = 'permissionAllowSession';
                break;
            }
        }
    }
    if (!key) {
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].indexOf('allow') >= 0 && tokens[i].indexOf('always') >= 0) {
                key = 'permissionAllowAlways';
                break;
            }
        }
    }
    if (!key) {
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].indexOf('allow') >= 0) {
                key = 'permissionAllowOnce';
                break;
            }
        }
    }
    if (!key) {
        for (let i = 0; i < tokens.length; i++) {
            if ((tokens[i].indexOf('reject') >= 0 || tokens[i].indexOf('deny') >= 0)
                && tokens[i].indexOf('always') >= 0) {
                key = 'permissionRejectAlways';
                break;
            }
        }
    }
    if (!key) {
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].indexOf('reject') >= 0 || tokens[i].indexOf('deny') >= 0) {
                key = tokens[i].indexOf('once') >= 0 ? 'permissionRejectOnce' : 'permissionDeny';
                break;
            }
        }
    }
    if (key && locale[key]) return locale[key];
    return opt.name || opt.optionId;
}

function getPermissionCollapsedMaxHeight() {
    return (PERM_LINE_HEIGHT_EM * PERM_COLLAPSED_LINES) + 'em';
}

function permissionDetailOverflows(scrollEl, text) {
    if (!scrollEl) return false;
    if (text && text.split('\n').length > PERM_COLLAPSED_LINES) return true;
    return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
}

export function syncPermissionDetailView(group) {
    const state = group._permissionState;
    if (!state || !state.scrollEl) return;
    state.textEl.textContent = state.text || '';
    state.wrapEl.style.display = state.cardCollapsed ? 'none' : '';
    state.scrollEl.classList.toggle('is-collapsed', !state.detailExpanded);
    state.scrollEl.classList.toggle('is-expanded', state.detailExpanded);
    if (!state.detailExpanded) {
        state.scrollEl.style.maxHeight = getPermissionCollapsedMaxHeight();
        state.scrollEl.scrollTop = state.scrollEl.scrollHeight;
    } else {
        state.scrollEl.style.maxHeight = '';
    }
    const overflow = permissionDetailOverflows(state.scrollEl, state.text);
    state.moreBtn.hidden = state.detailExpanded || !overflow;
    state.lessBtn.hidden = !state.detailExpanded || !overflow;
    state.cardToggle.title = state.cardCollapsed
        ? (locale.permissionCardExpand || 'Expand details')
        : (locale.permissionCardCollapse || 'Collapse details');
    state.cardToggle.setAttribute('aria-expanded', state.cardCollapsed ? 'false' : 'true');
}

function updatePermissionContent(group, title, detail) {
    if (!group._permissionState) return;
    group._permissionState.text = permissionBodyText(title, detail);
    syncPermissionDetailView(group);
}

export function refreshPermissionOptionLabels(group) {
    if (!group._permissionState) return;
    group._permissionState.options.forEach(function(opt) {
        const btn = group.querySelector('.permission-btn[data-option-id="' + opt.optionId.replace(/"/g, '\\"') + '"]');
        if (btn) btn.textContent = permissionOptionLabel(opt);
    });
}

function buildPermissionActions(id, options, readOnly) {
    const actions = document.createElement('div');
    actions.className = 'permission-actions';
    if (readOnly) {
        actions.style.display = 'none';
        return actions;
    }
    (options || []).forEach(function(opt) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'permission-btn button';
        btn.dataset.optionId = opt.optionId;
        const kind = String(opt.kind || '').toLowerCase();
        const idLower = String(opt.optionId || '').toLowerCase();
        if (kind.indexOf('allow') === 0 || idLower.indexOf('allow') === 0) {
            btn.classList.add('allow', 'button--primary');
        } else if (kind.indexOf('reject') === 0 || kind.indexOf('deny') === 0
            || idLower.indexOf('reject') >= 0 || idLower.indexOf('deny') >= 0) {
            btn.classList.add('reject', 'button--reject');
        }
        btn.textContent = permissionOptionLabel(opt);
        btn.addEventListener('click', function() {
            resolvePermission(id, opt.optionId, permissionOptionLabel(opt));
        });
        actions.appendChild(btn);
    });
    return actions;
}

function applyPermissionResolvedUI(group, statusText) {
    const div = group.querySelector('.message');
    if (!div) {
        return;
    }
    div.classList.remove('pending');
    div.classList.add('resolved');
    group.querySelectorAll('.permission-btn').forEach(function(btn) {
        btn.disabled = true;
    });
    const actions = group.querySelector('.permission-actions');
    if (actions) {
        actions.style.display = 'none';
    }
    let status = div.querySelector('.permission-status');
    if (!status) {
        status = document.createElement('div');
        status.className = 'permission-status';
        div.appendChild(status);
    }
    status.textContent = statusText;
}

function buildPermissionCard(id, msg, cardOptions) {
    const readOnly = !!(cardOptions && cardOptions.readOnly);

    const div = document.createElement('div');
    div.className = 'message permission' + (readOnly || msg.resolved ? ' resolved' : ' pending');

    const header = document.createElement('div');
    header.className = 'permission-header';

    const label = document.createElement('div');
    label.className = 'label permission-label';
    label.textContent = locale.permissionTitle || 'Permission required';
    header.appendChild(label);

    const cardToggle = document.createElement('button');
    cardToggle.type = 'button';
    cardToggle.className = 'permission-card-toggle';
    cardToggle.innerHTML = '<span class="permission-card-arrow">▼</span>';
    header.appendChild(cardToggle);
    div.appendChild(header);

    const wrap = document.createElement('div');
    wrap.className = 'permission-detail-wrap';

    const scrollEl = document.createElement('div');
    scrollEl.className = 'permission-detail-scroll is-collapsed';
    const textEl = document.createElement('div');
    textEl.className = 'permission-detail-text';
    scrollEl.appendChild(textEl);
    wrap.appendChild(scrollEl);

    const controls = document.createElement('div');
    controls.className = 'permission-detail-controls';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'permission-detail-toggle';
    moreBtn.textContent = locale.permissionShowMore || 'Show more';
    const lessBtn = document.createElement('button');
    lessBtn.type = 'button';
    lessBtn.className = 'permission-detail-toggle';
    lessBtn.textContent = locale.permissionCollapse || 'Collapse';
    lessBtn.hidden = true;
    controls.appendChild(moreBtn);
    controls.appendChild(lessBtn);
    wrap.appendChild(controls);
    div.appendChild(wrap);

    const options = msg.options || [];
    div.appendChild(buildPermissionActions(id, options, readOnly));

    const state = {
        text: permissionBodyText(msg.title, msg.detail),
        detailExpanded: !!(readOnly || msg.resolved),
        cardCollapsed: false,
        options: options,
        wrapEl: wrap,
        scrollEl: scrollEl,
        textEl: textEl,
        moreBtn: moreBtn,
        lessBtn: lessBtn,
        cardToggle: cardToggle,
        readOnly: readOnly,
    };

    return { card: div, state: state };
}

function mountPermissionCard(id, msg, cardOptions?) {
    const group = createGroup('permission', 'perm-' + id);
    group.dataset.permissionId = id;
    const built = buildPermissionCard(id, msg, cardOptions);
    const card = built.card;
    group._permissionState = built.state;
    const readOnly = built.state.readOnly;

    built.state.cardToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        group._permissionState.cardCollapsed = !group._permissionState.cardCollapsed;
        card.classList.toggle('is-card-collapsed', group._permissionState.cardCollapsed);
        syncPermissionDetailView(group);
    });
    built.state.moreBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        group._permissionState.detailExpanded = true;
        syncPermissionDetailView(group);
    });
    built.state.lessBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        group._permissionState.detailExpanded = false;
        syncPermissionDetailView(group);
    });

    // Same shape as every other message: container, stack, card.
    const container = document.createElement('div');
    container.className = 'message-container';
    const stack = document.createElement('div');
    stack.className = 'message-stack';
    stack.appendChild(card);
    container.appendChild(stack);
    group.appendChild(container);
    updatePermissionContent(group, msg.title, msg.detail);
    if (readOnly || msg.resolved) {
        let statusText = locale.permissionCancelled || 'Cancelled';
        if (msg.outcome === 'selected' && (msg.selectedLabel || msg.selectedOptionId)) {
            statusText = localeText('permissionSelected', msg.selectedLabel || msg.selectedOptionId);
        } else if (msg.selectedLabel) {
            statusText = localeText('permissionSelected', msg.selectedLabel);
        }
        applyPermissionResolvedUI(group, statusText);
    }
    return group;
}

export function restorePermissionMessage(m) {
    const id = m.permissionId || ('perm_hist_' + (m.timestamp || Date.now()));
    const group = mountPermissionCard(id, {
        title: m.title || m.text || '',
        detail: m.detail || '',
        options: m.options || [],
        resolved: true,
        outcome: m.outcome,
        selectedLabel: m.selectedLabel,
        selectedOptionId: m.selectedOptionId,
    }, { readOnly: true });
    messagesEl.appendChild(group);
}

export function showPermissionRequest(msg) {
    finalizeAssistantBubble();
    state.placeholder.style.display = 'none';
    enableStopAfterAgentOutput();
    const id = msg.id;
    if (!id) {
        return;
    }
    if (pendingPermissions.has(id)) {
        updatePermissionContent(pendingPermissions.get(id), msg.title, msg.detail);
        return;
    }
    const group = mountPermissionCard(id, msg);
    messagesEl.appendChild(group);
    pendingPermissions.set(id, group);
    maybeScrollToBottom();
}

function resolvePermission(id, optionId, selectedLabel) {
    const group = pendingPermissions.get(id);
    if (!group) {
        return;
    }
    pendingPermissions.delete(id);
    applyPermissionResolvedUI(group, localeText('permissionSelected', selectedLabel || optionId));
    post({ type: 'permissionResponse', id: id, optionId: optionId });
}

export function dismissPermissionRequest(id, statusText) {
    const group = pendingPermissions.get(id);
    if (!group) {
        return;
    }
    pendingPermissions.delete(id);
    applyPermissionResolvedUI(group, statusText || locale.permissionCancelled || 'Cancelled');
}
