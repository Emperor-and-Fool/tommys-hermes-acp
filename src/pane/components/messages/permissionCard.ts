import { messagesEl } from '../../dom';
import type { ApprovalMode } from '../../../shared/webview';
import type { PermissionOption } from '../../../shared/acp';
import type { ChatMessage } from '../../../shared/chat';

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
import {
    createApprovalModeBlock,
    endApprovalModePending,
    refreshApprovalModeLabels as refreshApprovalModeSwitchLabels,
    syncAllApprovalModeBlocks,
    syncApprovalModeBlock,
} from '../permissions/approvalModeSwitch';
import { enableStopAfterAgentOutput, finalizeAssistantBubble } from './streaming';

/* Permission cards awaiting a decision. Mutated, never reassigned: not state. */
export const pendingPermissions = new Map<string, any>();


/**
 * Set when the session answer was pressed on a card that could not send it: that card takes
 * allow-once, and the next permission request in this pane is answered with session on its own.
 * One request, not a standing policy — a pane-wide auto-answer would approve commands nobody read.
 */
let sessionAnswerArmed = false;

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

/** Both tokens an option carries, normalised: the wire id and the ACP kind. */
function optionTokens(opt: PermissionOption): string[] {
    return [String(opt.optionId || ''), String(opt.kind || '')]
        .map(function(token) { return token.toLowerCase().replace(/-/g, '_'); });
}

/** The session scope Hermes accepts (id `allow_session`; its ACP kind is `allow_always`). */
function isSessionScope(opt: PermissionOption): boolean {
    return optionTokens(opt).some(function(token) {
        return token.indexOf('allow') >= 0 && token.indexOf('session') >= 0;
    });
}

function isAllowOption(opt: PermissionOption): boolean {
    return optionTokens(opt).some(function(token) { return token.indexOf('allow') === 0; });
}

function isRejectOption(opt: PermissionOption): boolean {
    return optionTokens(opt).some(function(token) {
        return token.indexOf('reject') === 0 || token.indexOf('deny') === 0;
    });
}

function isAlwaysScope(opt: PermissionOption): boolean {
    return optionTokens(opt).some(function(token) { return token.indexOf('always') >= 0; });
}

/**
 * The three answers a card offers, in this order: allow (this command), session, cancel.
 *
 * Hermes may send five (`allow_always` and `deny_always` included); the card keeps the three a
 * reader can decide at a glance, and the permanent allowlist stays a deliberate CLI act
 * (`hermes approvals`) rather than a button pressed mid-turn.
 */
function cardAnswers(options: PermissionOption[] | undefined): PermissionOption[] {
    const list = options || [];
    const session = list.find(isSessionScope);
    const once = list.find(function(opt) {
        return isAllowOption(opt) && !isSessionScope(opt) && !isAlwaysScope(opt);
    });
    const cancel = list.find(function(opt) { return isRejectOption(opt) && !isAlwaysScope(opt); })
        || list.find(isRejectOption);
    return [once, session, cancel].filter(Boolean) as PermissionOption[];
}

function buildPermissionActions(id: string, options: PermissionOption[] | undefined, readOnly: boolean) {
    const actions = document.createElement('div');
    actions.className = 'permission-actions';
    if (readOnly) {
        actions.style.display = 'none';
        return actions;
    }
    const answers = cardAnswers(options);
    answers.forEach(function(opt) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'permission-btn button';
        btn.dataset.optionId = opt.optionId;
        if (isAllowOption(opt)) {
            btn.classList.add('allow', 'button--primary');
        } else {
            btn.classList.add('reject', 'button--reject');
        }
        btn.textContent = permissionOptionLabel(opt);
        btn.addEventListener('click', function() {
            resolvePermission(id, opt.optionId, permissionOptionLabel(opt));
        });
        actions.appendChild(btn);
    });
    // A gate that offered no session scope still names the choice and how to unlock it: the
    // moment the first card appears is when a reader wants "for session", so the instruction
    // belongs on the card, not in a document read later. Not `disabled`: a disabled button does
    // not reliably show its balloon, and this one exists to be read.
    if (!answers.some(isSessionScope)) {
        const once = answers.find(isAllowOption);
        const hint = document.createElement('button');
        hint.type = 'button';
        hint.className = 'permission-btn button is-unavailable is-session-hint';
        hint.dataset.optionId = 'allow_session';
        hint.textContent = locale.permissionAllowSession || 'Allow for session';
        hint.title = locale.permissionSessionNeedsManual || 'For session, set to manual';
        hint.setAttribute('aria-disabled', 'true');
        hint.addEventListener('click', function(e) {
            e.stopPropagation();
            // This card cannot send `allow_session` — Hermes built its answer list without it, so
            // the answer would be mapped to a deny. It takes allow-once instead and arms the NEXT
            // request for the session answer, which is a list that does carry it.
            if (hint.getAttribute('aria-disabled') === 'true' || !once) {
                return;
            }
            sessionAnswerArmed = true;
            resolvePermission(id, once.optionId, locale.permissionSessionArmed || permissionOptionLabel(once));
        });
        actions.appendChild(hint);
    }
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

/** The session answer on a card the gate did not offer it on: live only while the mode is manual. */
function syncSessionHint(group: HTMLElement): void {
    group.querySelectorAll('.permission-btn.is-session-hint').forEach(function(btn) {
        const live = state.approvalMode === 'manual';
        btn.classList.toggle('is-unavailable', !live);
        btn.setAttribute('aria-disabled', live ? 'false' : 'true');
        btn.title = live
            ? (locale.permissionSessionArmedHint || 'Allow once now, and answer the next request for the session')
            : (locale.permissionSessionNeedsManual || 'For session, set to manual');
    });
}

/**
 * One card's switch follows the shared state. `withError` is false for a card that is being
 * mounted: a failure that happened before it existed is not its error to show.
 */
function syncApprovalRow(group: HTMLElement, withError = true): void {
    const block = group.querySelector('.permission-approval-block');
    if (block) {
        syncApprovalModeBlock(block as HTMLElement, withError);
    }
    syncSessionHint(group);
}

/** A locale change: the switch's words are ours, so they move with the rest. */
export function refreshApprovalModeLabels(): void {
    refreshApprovalModeSwitchLabels();
}

/** An `approvalMode` message: the rail's switch and every pending card follow it. */
export function applyApprovalMode(
    mode: ApprovalMode,
    error?: string,
    denyCount?: number,
    denyBackup?: string,
    openAccess?: boolean,
): void {
    state.approvalMode = mode || 'unknown';
    state.approvalModeError = error || '';
    if (typeof denyCount === 'number') {
        state.approvalDenyCount = denyCount;
    }
    if (typeof denyBackup === 'string') {
        state.approvalDenyBackup = denyBackup;
    }
    if (typeof openAccess === 'boolean') {
        state.approvalOpenAccess = openAccess;
    }
    endApprovalModePending();
    syncAllApprovalModeBlocks();
    pendingPermissions.forEach(function(group) {
        syncSessionHint(group);
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
        div.appendChild(createApprovalModeBlock());
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
    if (sessionAnswerArmed) {
        sessionAnswerArmed = false;
        const sessionOption = (msg.options || []).find(isSessionScope);
        if (sessionOption) {
            // Armed by the previous card's session press: this request carries the answer it could
            // not send, so it is answered here — and the card stays as the record of that.
            const group = mountPermissionCard(id, msg);
            messagesEl.appendChild(group);
            pendingPermissions.set(id, group);
            resolvePermission(id, sessionOption.optionId, locale.permissionAllowSession || 'Allow for session');
            maybeScrollToBottom();
            return;
        }
    }
    const group = mountPermissionCard(id, msg);
    messagesEl.appendChild(group);
    pendingPermissions.set(id, group);
    maybeScrollToBottom();
}

/** A rebuilt pane starts unarmed: the armed answer belonged to the conversation that set it. */
export function disarmSessionAnswer(): void {
    sessionAnswerArmed = false;
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
