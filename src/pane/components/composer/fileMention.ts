import { byId, filePickerEl, inputEl } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { syncInputHeightFromContent } from './composer';


function hideFilePreview() {
    if (state.previewHideTimer) {
        clearTimeout(state.previewHideTimer);
        state.previewHideTimer = null;
    }
    if (state.previewTooltip) {
        state.previewTooltip.remove();
        state.previewTooltip = null;
    }
}

export function showFilePreview(path, content, error) {
    hideFilePreview();
    state.previewTooltip = document.createElement('div');
    state.previewTooltip.className = 'file-preview-tooltip';
    const header = document.createElement('div');
    header.className = 'fp-header';
    header.textContent = path;
    state.previewTooltip.appendChild(header);
    if (error) {
        const err = document.createElement('div');
        err.className = 'fp-error';
        err.textContent = error;
        state.previewTooltip.appendChild(err);
    } else {
        const pre = document.createElement('pre');
        pre.textContent = content || locale.emptyFile;
        state.previewTooltip.appendChild(pre);
    }
    document.body.appendChild(state.previewTooltip);
}

export function positionFilePreview(anchor) {
    if (!state.previewTooltip || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const tip = state.previewTooltip.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;
    if (top + tip.height > window.innerHeight - 8) {
        top = rect.top - tip.height - 6;
    }
    if (left + tip.width > window.innerWidth - 8) {
        left = window.innerWidth - tip.width - 8;
    }
    state.previewTooltip.style.top = Math.max(8, top) + 'px';
    state.previewTooltip.style.left = Math.max(8, left) + 'px';
}

function attachFileRefPreview(link) {
    if (link.dataset.previewReady) return;
    link.dataset.previewReady = '1';
    let enterTimer = null;
    link.addEventListener('mouseenter', function () {
        enterTimer = setTimeout(function () {
            const filePath = link.dataset.path || link.textContent.replace(/^@/, '');
            const reqId = String(++state.previewRequestId);
            previewRequests.set(reqId, link);
            post({ type: 'previewFile', path: filePath, requestId: reqId });
        }, 250);
    });
    link.addEventListener('mouseleave', function () {
        if (enterTimer) clearTimeout(enterTimer);
        state.previewHideTimer = setTimeout(hideFilePreview, 150);
    });
}

export function processFileRefs(container) {
    if (!container) return;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement && node.parentElement.closest('pre, code, a.file-ref')) continue;
        const text = node.textContent || '';
        const refRegex = /@([\w./\\\-]+(?:\.[a-zA-Z0-9]+)?)/g;
        let match;
        let lastIdx = 0;
        const parts = [];
        while ((match = refRegex.exec(text)) !== null) {
            const before = text.slice(lastIdx, match.index);
            if (before) parts.push(document.createTextNode(before));
            const link = document.createElement('a');
            link.href = '#';
            link.className = 'file-ref';
            link.textContent = match[0];
            link.title = locale.fileLinkTitle;
            link.dataset.path = match[1];
            link.addEventListener('click', function (e) {
                e.preventDefault();
                post({ type: 'openFile', path: match[1] });
            });
            attachFileRefPreview(link);
            parts.push(link);
            lastIdx = match.index + match[0].length;
        }
        if (parts.length > 0) {
            const remaining = text.slice(lastIdx);
            if (remaining) parts.push(document.createTextNode(remaining));
            nodesToReplace.push({ node, parts });
        }
    }
    for (const { node, parts } of nodesToReplace) {
        const parent = node.parentNode;
        if (!parent) continue;
        const fragment = document.createDocumentFragment();
        parts.forEach(p => fragment.appendChild(p));
        parent.replaceChild(fragment, node);
    }
}

export function hideFilePicker() {
    state.filePickerVisible = false;
    state.mentionStart = -1;
    state.filePickerItems = [];
    state.filePickerIndex = 0;
    filePickerEl.classList.remove('visible');
    filePickerEl.innerHTML = '';
}

export function renderFilePickerItems(files) {
    state.filePickerItems = files || [];
    state.filePickerIndex = 0;
    filePickerEl.innerHTML = '';
    if (state.filePickerItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'file-picker-empty';
        empty.textContent = locale.noMatchingFiles;
        filePickerEl.appendChild(empty);
    } else {
        state.filePickerItems.forEach(function (filePath, idx) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'file-picker-item' + (idx === 0 ? ' active' : '');
            btn.textContent = '@' + filePath;
            btn.addEventListener('mousedown', function (e) {
                e.preventDefault();
                selectFileMention(filePath);
            });
            filePickerEl.appendChild(btn);
        });
    }
    filePickerEl.classList.add('visible');
    state.filePickerVisible = true;
}

export function updateFilePickerHighlight() {
    filePickerEl.querySelectorAll('.file-picker-item').forEach(function (el, idx) {
        el.classList.toggle('active', idx === state.filePickerIndex);
        if (idx === state.filePickerIndex) {
            el.scrollIntoView({ block: 'nearest' });
        }
    });
}

export function selectFileMention(filePath) {
    if (state.mentionStart < 0) return;
    const val = inputEl.value;
    const before = val.slice(0, state.mentionStart);
    const after = val.slice(inputEl.selectionStart);
    const insertion = '@' + filePath + ' ';
    inputEl.value = before + insertion + after;
    const cursor = before.length + insertion.length;
    inputEl.setSelectionRange(cursor, cursor);
    syncInputHeightFromContent();
    hideFilePicker();
    inputEl.focus();
}

export function detectFileMention() {
    const val = inputEl.value;
    const pos = inputEl.selectionStart;
    const before = val.slice(0, pos);
    const match = before.match(/@([\w./\\\-]*)$/);
    if (!match) {
        hideFilePicker();
        return;
    }
    state.mentionStart = pos - match[0].length;
    const query = match[1] || '';
    if (state.fileListDebounce) clearTimeout(state.fileListDebounce);
    state.fileListDebounce = setTimeout(function () {
        const reqId = String(++state.fileListRequestId);
        filePickerEl.dataset.requestId = reqId;
        filePickerEl.innerHTML = '<div class="file-picker-empty">' + escapeHtml(locale.searchingFiles) + '</div>';
        filePickerEl.classList.add('visible');
        state.filePickerVisible = true;
        post({ type: 'listFiles', query: query, requestId: reqId });
    }, 120);
}
