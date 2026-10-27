import { byId, inputEl } from '../../dom';
import { post } from '../../post';
import { copyToClipboard } from '../../util/clipboard';
import { escapeHtml } from '../../util/html';
import { syncInputHeightFromContent, updateQuickActionBtns } from '../composer/composer';
import { hideFilePicker } from '../composer/fileMention';
import { enterMultiSelectMode } from '../multiSelect';
import { COPY_ICON_SVG, getGroupMarkdownText } from './markdown';


const SELECT_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5V7zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2z"/><path d="M3.15 4.85l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M3.15 9.35l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M7.5 3h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1z"/></svg>';

const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6 8 9.5 11.5 6l.7.7L8 10.9l-4.2-4.2.7-.7z"/></svg>';

export function attachMessageActions(group, inner) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.addEventListener('click', function(e) { e.stopPropagation(); });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn action-btn';
    copyBtn.title = locale.copy;
    copyBtn.innerHTML = COPY_ICON_SVG;
    copyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const text = getGroupMarkdownText(group).trim();
        if (!text) return;
        copyToClipboard(text).then(function() {
            copyBtn.classList.add('copied');
            copyBtn.title = locale.copied;
            setTimeout(function() {
                copyBtn.classList.remove('copied');
                copyBtn.title = locale.copy;
            }, 1500);
        });
    });
    actions.appendChild(copyBtn);

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

function attachCopyButton(group) {
    const stack = group.querySelector('.message-stack');
    if (stack) attachMessageActions(group, stack);
}

function appendToInput(text) {
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

export function insertIntoInput(text) {
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

function insertToEditor(text) {
    if (!text) return;
    post({ type: 'insertEditor', text: text });
}

export function closeInsertDropdowns(except?) {
    document.querySelectorAll('.insert-dropdown.is-open').forEach(function(dropdown) {
        if (except && dropdown === except) return;
        dropdown.classList.remove('is-open');
    });
}

export function createInsertDropdown(getText) {
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
