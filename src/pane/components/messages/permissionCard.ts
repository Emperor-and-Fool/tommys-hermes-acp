import { byId, messagesEl, statusText } from '../../dom';
import type { ApprovalMode, HostToPane } from '../../../shared/webview';
import type { PermissionOption } from '../../../shared/acp';
import type { ChatMessage } from '../../../shared/chat';

/** The permissionRequest member of the host-to-pane union. */
type PermissionRequestMsg = Extract<HostToPane, { type: 'permissionRequest' }>;

/** A live request, or the same card restored from the transcript (which carries the outcome). */
type PermissionCardInput = {
    id?: string;
    title: string;
    detail?: string;
    options: PermissionOption[];
} & Partial<Pick<ChatMessage, 'resolved' | 'outcome' | 'selectedLabel' | 'selectedOptionId'>>;

/** What a caller may pass when building the card. */
interface PermissionCardOptions {
    readOnly?: boolean;
}
import { post } from '../../post';
import { state } from '../../state';
import { createGroup, maybeScrollToBottom } from './messageList';
import { enableStopAfterAgentOutput, finalizeAssistantBubble } from './streaming';

/* Permission cards awaiting a decision. Mutated, never reassigned: not state. */
export const pendingPermissions = new Map<string, any>();


const PERM_COLLAPSED_LINES = 3;

const PERM_LINE_HEIGHT_EM = 1.45;

function permissionBodyText(title: string, detail?: string): string {
    const parts = [];
    if (title) parts.push(String(title));
    if (detail && String(detail).trim()) parts.push(String(detail).trim());
    return parts.join('\n\n');
}

function permissionOptionLabel(opt: PermissionOption): string {
    const kind = String(opt.kind || '').toLowerCase().replace(/-/g, '_');
    const id = String(opt.optionId || '').toLowerCase().replace(/-/g, '_');
    const map: Record<string, string> = {
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

function permissionDetailOverflows(scrollEl: HTMLElement, text: string): boolean {
    if (!scrollEl) return false;
    if (text && text.split('\n').length > PERM_COLLAPSED_LINES) return true;
    return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
}

export function syncPermissionDetailView(group: HTMLElement) {
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

function updatePermissionContent(group: HTMLElement, title: string, detail?: string) {
    if (!group._permissionState) return;
    group._permissionState.text = permissionBodyText(title, detail);
    syncPermissionDetailView(group);
}

export function refreshPermissionOptionLabels(group: HTMLElement) {
    if (!group._permissionState) return;
    group._permissionState.options.forEach(function(opt) {
        const btn = group.querySelector('.permission-btn[data-option-id="' + opt.optionId.replace(/"/g, '\\"') + '"]');
        if (btn) btn.textContent = permissionOptionLabel(opt);
    });
}

function buildPermissionActions(id: string, options: PermissionOption[] | undefined, readOnly: boolean) {
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

function applyPermissionResolvedUI(group: HTMLElement, statusText: string) {
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
    const approval = div.querySelector('.permission-approval-block');
    if (approval) {
        approval.style.display = 'none';
    }
    let status = div.querySelector('.permission-status');
    if (!status) {
        status = document.createElement('div');
        status.className = 'permission-status';
        div.appendChild(status);
    }
    status.textContent = statusText;
}

/** The modes the switch offers, in the order it shows them. */
const APPROVAL_MODE_CHOICES: Array<Exclude<ApprovalMode, 'unknown'>> = ['manual', 'smart', 'off'];

/** The last `approvalMode` message, and why a write did not take. */
let approvalMode: ApprovalMode = 'unknown';

let approvalModeError = '';

function approvalModeLabel(mode: ApprovalMode): string {
    if (mode === 'manual') return locale.approvalModeManual || 'Manual';
    if (mode === 'smart') return locale.approvalModeSmart || 'Smart';
    return locale.approvalModeOff || 'Off';
}

/**
 * The switch: Manual · Smart · Off, for Hermes' approvals.mode.
 *
 * It is a setting, not an answer: it changes the whole profile and leaves the card in front of
 * you untouched, which is why it sits above the buttons rather than among them.
 */
function buildApprovalBlock() {
    const block = document.createElement('div');
    block.className = 'permission-approval-block';
    const tip = locale.approvalModeTooltip || '';
    const row = document.createElement('div');
    row.className = 'permission-approval';
    row.setAttribute('role', 'group');
    row.title = tip;
    if (tip) {
        row.setAttribute('aria-label', tip);
    }
    APPROVAL_MODE_CHOICES.forEach(function(mode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'permission-approval-btn';
        btn.dataset.approvalMode = mode;
        btn.textContent = approvalModeLabel(mode);
        btn.setAttribute('aria-pressed', 'false');
        btn.title = tip;
        btn.disabled = true;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (btn.disabled) {
                return;
            }
            post({ type: 'setApprovalMode', mode: mode });
        });
        row.appendChild(btn);
    });
    block.appendChild(row);
    const error = document.createElement('div');
    error.className = 'permission-approval-error';
    error.hidden = true;
    block.appendChild(error);
    return block;
}

/**
 * One card's switch follows the module state. `withError` is false for a card that is being
 * mounted: a failure that happened before it existed is not its error to show.
 */
function syncApprovalRow(group: HTMLElement, withError = true) {
    const block = group.querySelector('.permission-approval-block');
    if (!block) {
        return;
    }
    const row = block.querySelector('.permission-approval');
    // Anything the host could not read arrives as `unknown`: nothing is pressed then.
    const known = approvalMode !== 'unknown';
    if (row) {
        row.dataset.mode = approvalMode;
        row.querySelectorAll('.permission-approval-btn').forEach(function(btn) {
            const selected = known && btn.dataset.approvalMode === approvalMode;
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            btn.classList.toggle('is-selected', selected);
            btn.disabled = !known;
        });
    }
    const error = block.querySelector('.permission-approval-error');
    if (error) {
        error.hidden = !(withError && approvalModeError);
        error.textContent = approvalModeError;
    }
}

/** A locale change: the switch's words are ours, so they move with the rest. */
export function refreshApprovalModeLabels(group: HTMLElement) {
    const block = group.querySelector('.permission-approval-block');
    if (!block) {
        return;
    }
    const tip = locale.approvalModeTooltip || '';
    const row = block.querySelector('.permission-approval');
    if (row) {
        row.title = tip;
        if (tip) {
            row.setAttribute('aria-label', tip);
        }
    }
    block.querySelectorAll('.permission-approval-btn').forEach(function(btn) {
        btn.textContent = approvalModeLabel(btn.dataset.approvalMode);
        btn.title = tip;
    });
}

/** An `approvalMode` message: every pending card follows it. */
export function applyApprovalMode(mode: ApprovalMode, error?: string) {
    approvalMode = mode || 'unknown';
    approvalModeError = error || '';
    pendingPermissions.forEach(function(group) {
        syncApprovalRow(group);
    });
}

function buildPermissionCard(id: string, msg: PermissionCardInput, cardOptions?: PermissionCardOptions) {
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

    if (!readOnly && !msg.resolved) {
        div.appendChild(buildApprovalBlock());
    }

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

function mountPermissionCard(id: string, msg: PermissionCardInput, cardOptions?: PermissionCardOptions) {
    const group = createGroup('permission', 'perm-' + id);
    group.dataset.permissionId = id;
    const built = buildPermissionCard(id, msg, cardOptions);
    const card = built.card;
    // One local handle: the element property is optional, and narrowing it does not survive into
    // the click handlers below.
    const cardState = built.state;
    group._permissionState = cardState;
    const readOnly = cardState.readOnly;

    cardState.cardToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        cardState.cardCollapsed = !cardState.cardCollapsed;
        card.classList.toggle('is-card-collapsed', cardState.cardCollapsed);
        syncPermissionDetailView(group);
    });
    cardState.moreBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        cardState.detailExpanded = true;
        syncPermissionDetailView(group);
    });
    cardState.lessBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        cardState.detailExpanded = false;
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
    syncApprovalRow(group, false);
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

export function restorePermissionMessage(m: ChatMessage) {
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

export function showPermissionRequest(msg: PermissionCardInput) {
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

function resolvePermission(id: string, optionId: string, selectedLabel?: string) {
    const group = pendingPermissions.get(id);
    if (!group) {
        return;
    }
    pendingPermissions.delete(id);
    applyPermissionResolvedUI(group, localeText('permissionSelected', selectedLabel || optionId));
    post({ type: 'permissionResponse', id: id, optionId: optionId });
}

export function dismissPermissionRequest(id: string, statusText: string) {
    const group = pendingPermissions.get(id);
    if (!group) {
        return;
    }
    pendingPermissions.delete(id);
    applyPermissionResolvedUI(group, statusText || locale.permissionCancelled || 'Cancelled');
}
