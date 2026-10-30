import { byId, inputEl } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { copyToClipboard } from '../../util/clipboard';
import { escapeHtml } from '../../util/html';
import { syncInputHeightFromContent, updateQuickActionBtns } from '../composer/composer';
import { hideFilePicker } from '../composer/fileMention';
import { enterMultiSelectMode } from '../multiSelect';
import { COPY_ICON_SVG, getGroupMarkdownText } from './markdown';


const SELECT_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5V7zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2z"/><path d="M3.15 4.85l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M3.15 9.35l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M7.5 3h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1z"/></svg>';

/** Arrow leaving a box: "this goes somewhere else", not "copy" and not "select". */
const FORWARD_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 2v6.3l-1.9-1.9-.7.7 2.6 2.6.1.1.1-.1 2.6-2.6-.7-.7-1.9 1.9V2h-1z"/><path d="M3 9v3.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V9h-1v3H4V9H3z"/><path d="M6 4H3.5a.5.5 0 0 0-.5.5V7h1V5h2V4z"/></svg>';

/** The other pane's profile, as last heard from the host. Empty when it is not running. */
let otherPaneProfile = '';

/**
 * The copy → copied → reset button. The message bar and a code block's own actions want the same
 * behaviour under different class names, so the choreography lives here once.
 */
export function createCopyButton(options: { className: string; getText: () => string; label?: string }): HTMLButtonElement {
    const label = options.label || locale.copy;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.className;
    button.title = label;
    button.innerHTML = COPY_ICON_SVG;
    button.addEventListener('click', function(e) {
        e.stopPropagation();
        const text = options.getText();
        if (!text) return;
        copyToClipboard(text).then(function() {
            button.classList.add('copied');
            button.title = locale.copied;
            setTimeout(function() {
                button.classList.remove('copied');
                button.title = label;
            }, 1500);
        });
    });
    return button;
}

const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6 8 9.5 11.5 6l.7.7L8 10.9l-4.2-4.2.7-.7z"/></svg>';

export function attachMessageActions(group: Element, inner: Element) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.addEventListener('click', function(e) { e.stopPropagation(); });

    const copyBtn = createCopyButton({
        className: 'copy-btn action-btn',
        getText: function() { return getGroupMarkdownText(group).trim(); },
    });
    actions.appendChild(copyBtn);

    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className = 'forward-btn action-btn';
    forwardBtn.title = forwardTitle();
    forwardBtn.innerHTML = FORWARD_ICON_SVG;
    forwardBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const text = getGroupMarkdownText(group).trim();
        if (!text) return;
        // In the read-only viewer the host owns the transcript, so the click names the message by
        // index and the host attaches the session ref itself — the same card, envelope included,
        // as forwarding from the live conversation.
        if (document.body.classList.contains('is-viewer') && state.viewerSessionId) {
            const index = Number(group.dataset && group.dataset.sessionIndex);
            if (Number.isInteger(index) && index >= 0) {
                post({ type: 'historyForwarded', sessionId: state.viewerSessionId, indices: [index] });
                return;
            }
        }
        post({
            type: 'forwardMessage',
            text: text,
            sourceMessageId: group.dataset && group.dataset.messageId ? group.dataset.messageId : undefined,
            // A session-memory card forwards its ref: the other pane draws the envelope from it
            // instead of reading a description of itself.
            history: group._historyRef || undefined
        });
    });
    actions.appendChild(forwardBtn);

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'select-btn action-btn';
    selectBtn.title = locale.selectMessages;
    selectBtn.innerHTML = SELECT_ICON_SVG;
    selectBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        enterMultiSelectMode(group);
    });
    actions.appendChild(selectBtn);

    inner.appendChild(actions);
}

/** Set by the router when the other pane appears or goes away. */
export function applyOtherPaneProfile(profile: string, live: boolean): void {
    otherPaneProfile = live ? profile : '';
    document.body.dataset.otherPaneLive = live ? 'true' : 'false';
    const title = forwardTitle();
    document.querySelectorAll('.message-actions .forward-btn').forEach(function(btn) {
        (btn as HTMLElement).title = title;
    });
}

function forwardTitle(): string {
    if (!otherPaneProfile) {
        return locale.otherPaneNotLive;
    }
    return (locale.forwardToOtherPane || 'Forward to {0}').replace('{0}', otherPaneProfile);
}

function appendToInput(text: string) {
    if (!text) return;
    hideFilePicker();
    const val = inputEl.value;
    const needsSep = val.length > 0 && !/\n$/.test(val);
    inputEl.value = val + (needsSep ? '\n' : '') + text;
    if (!inputEl.disabled) {
        const pos = inputEl.value.length;
        inputEl.setSelectionRange(pos, pos);
        syncInputHeightFromContent();
        updateQuickActionBtns();
        inputEl.focus();
    }
}

export function insertIntoInput(text: string) {
    if (!text) return;
    hideFilePicker();
    const val = inputEl.value;
    const start = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : val.length;
    const end = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : start;
    inputEl.value = val.slice(0, start) + text + val.slice(end);
    if (!inputEl.disabled) {
        const pos = start + text.length;
        inputEl.setSelectionRange(pos, pos);
        syncInputHeightFromContent();
        updateQuickActionBtns();
        inputEl.focus();
    }
}

function insertToEditor(text: string) {
    if (!text) return;
    post({ type: 'insertEditor', text: text });
}

export function closeInsertDropdowns(except?: Element) {
    document.querySelectorAll('.insert-dropdown.is-open').forEach(function(dropdown) {
        if (except && dropdown === except) return;
        dropdown.classList.remove('is-open');
    });
}

export function createInsertDropdown(getText: () => string) {
    const dropdown = document.createElement('div');
    dropdown.className = 'insert-dropdown';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'block-btn insert-toggle';
    toggle.innerHTML = escapeHtml(locale.insertMenu || locale.insert) + CHEVRON_DOWN_SVG;
    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = dropdown.classList.contains('is-open');
        closeInsertDropdowns();
        dropdown.classList.toggle('is-open', !open);
    });

    const menu = document.createElement('div');
    menu.className = 'insert-dropdown-menu';

    const inputBtn = document.createElement('button');
    inputBtn.type = 'button';
    inputBtn.textContent = locale.insertToInput;
    inputBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closeInsertDropdowns();
        if (inputEl.disabled) return;
        appendToInput(getText());
    });

    const editorBtn = document.createElement('button');
    editorBtn.type = 'button';
    editorBtn.textContent = locale.insertToEditor;
    editorBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closeInsertDropdowns();
        insertToEditor(getText());
    });

    menu.appendChild(inputBtn);
    menu.appendChild(editorBtn);
    dropdown.appendChild(toggle);
    dropdown.appendChild(menu);
    return dropdown;
}
