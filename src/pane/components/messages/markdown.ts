import { byId, chatBodyEl, messagesEl } from '../../dom';
import { state } from '../../state';
import { copyToClipboard } from '../../util/clipboard';
import { escapeHtmlEntities } from '../../util/html';
import { processFileRefs } from '../composer/fileMention';
import { scheduleChatSearch } from '../search';
import { createInsertDropdown } from './messageActions';
import { getGroupRoleLabel, getMessagePlainText, markMissingImages, maybeScrollToBottom } from './messageList';
import { setAuxiliaryContent } from './toolCards';


export const SESSION_RENDER_BANNER_ID = 'sessionRenderBanner';

const MARKDOWN_RENDER_BATCH_SIZE = 4;

export const COPY_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 2h8a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h0zm1 2v8h8V5H5zm-2 2h1v6h6v1H4a1 1 0 0 1-1-1V6h0z"/></svg>';

export const chatSearchState = {
    query: '',
    matches: [],
    current: -1,
    timer: null,
};

export function getGroupMarkdownText(group) {
    if (group._auxState && group._auxState.rawText) {
        return group._auxState.rawText;
    }
    if (group._rawText) {
        return group._rawText;
    }
    return getMessagePlainText(group);
}

function showSessionRenderBanner() {
    if (!chatBodyEl) return;
    let banner = document.getElementById(SESSION_RENDER_BANNER_ID);
    if (!banner) {
        banner = document.createElement('div');
        banner.id = SESSION_RENDER_BANNER_ID;
        banner.className = 'session-render-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.innerHTML = '<span class="session-render-spinner" aria-hidden="true"></span><span class="session-render-text"></span>';
        chatBodyEl.appendChild(banner);
    }
    banner.classList.remove('is-hiding');
    const textEl = banner.querySelector('.session-render-text');
    if (textEl) textEl.textContent = locale.sessionRendering || '';
    banner.hidden = false;
}

function forceHideSessionRenderBanner() {
    const banner = document.getElementById(SESSION_RENDER_BANNER_ID);
    if (!banner) return;
    banner.classList.remove('is-hiding');
    banner.hidden = true;
}

function hideSessionRenderBanner() {
    const banner = document.getElementById(SESSION_RENDER_BANNER_ID);
    if (!banner || banner.hidden || banner.classList.contains('is-hiding')) return;
    banner.classList.add('is-hiding');
    const onExitEnd = function(e) {
        if (e.target !== banner || e.animationName !== 'session-render-exit') return;
        banner.removeEventListener('animationend', onExitEnd);
        banner.hidden = true;
        banner.classList.remove('is-hiding');
    };
    banner.addEventListener('animationend', onExitEnd);
}

export function cancelSessionMarkdownRender() {
    state.sessionRenderJobId++;
    // The cancelled job leaves raw text behind, so the work is still owed: remember it
    // instead of letting a newer restore silently inherit a half-converted transcript.
    state.sessionMarkdownPending = true;
    forceHideSessionRenderBanner();
}

function collectMarkdownRenderTargets() {
    const targets = [];
    messagesEl.querySelectorAll('.message-group').forEach(function(group) {
        const assistantContent = group.querySelector('.message:is(.assistant, .peer) .content');
        if (assistantContent) {
            const text = group._rawText || assistantContent.textContent || '';
            if (text.trim()) {
                targets.push({ kind: 'assistant', el: assistantContent, text: text, group: group });
            }
        }
        if (group._auxState && group._auxState.contentEl) {
            const text = group._auxState.rawText || group._auxState.contentEl.textContent || '';
            if (text.trim()) {
                targets.push({ kind: 'aux', group: group, text: text });
            }
        }
    });
    return targets;
}

function renderMarkdownTarget(target) {
    if (target.kind === 'assistant') {
        target.group._rawText = target.text;
        target.el.innerHTML = renderMarkdown(target.text);
        setupContentBlocks(target.el);
        processFileRefs(target.el);
        const card = target.el.closest('.message');
        markMissingImages(target.el, !!(card && card._hasImages));
        return;
    }
    if (target.kind === 'aux') {
        setAuxiliaryContent(target.group, target.text);
    }
}

export function scheduleSessionMarkdownRender() {
    // requestAnimationFrame does not fire while the webview is off screen, so a pane
    // restored in the background would keep its raw text forever. Record the debt and
    // let the visibility handler below resume it.
    if (document.visibilityState === 'hidden') {
        state.sessionMarkdownPending = true;
        return;
    }
    const jobId = ++state.sessionRenderJobId;
    const targets = collectMarkdownRenderTargets();
    if (!targets.length) {
        state.sessionMarkdownPending = false;
        hideSessionRenderBanner();
        window._hermesRendered = true;
        if (chatSearchState.query) scheduleChatSearch();
        return;
    }
    state.sessionMarkdownPending = true;
    showSessionRenderBanner();
    let index = 0;
    function runBatch() {
        if (jobId !== state.sessionRenderJobId) return;
        const end = Math.min(index + MARKDOWN_RENDER_BATCH_SIZE, targets.length);
        for (; index < end; index++) {
            renderMarkdownTarget(targets[index]);
        }
        if (index < targets.length) {
            requestAnimationFrame(runBatch);
        } else {
            state.sessionMarkdownPending = false;
            hideSessionRenderBanner();
            window._hermesRendered = true;
            // The sweep replaced raw text with formatted blocks, so the transcript is
            // taller than it was when the batches scrolled: land on the new bottom.
            maybeScrollToBottom(true);
            if (chatSearchState.query) scheduleChatSearch();
        }
    }
    requestAnimationFrame(runBatch);
}

function getGroupsMarkdown(groups) {
    const parts = [];
    groups.forEach(function(group) {
        const role = getGroupRoleLabel(group);
        const text = getGroupMarkdownText(group).trim();
        if (!text) return;
        parts.push('## ' + role + '\n\n' + text);
    });
    return parts.join('\n\n');
}

export function renderMarkdown(text) {
    // A message is data, not markup. Raw HTML in it is turned into characters before
    // rendering, so nothing typed or echoed into the transcript — a tool result printing
    // the pane's own HTML included — can create elements the pane later looks up by id.
    // Markdown still formats; fenced code still shows its tags literally.
    let html;
    if (typeof marked.lexer === 'function' && typeof marked.parser === 'function') {
        const tokens = marked.lexer(String(text == null ? '' : text));
        const scrubRawHtml = function(list) {
            for (const token of list) {
                if (!token) continue;
                if (token.type === 'html') {
                    const raw = token.text != null ? token.text : token.raw;
                    token.text = escapeHtmlEntities(raw);
                    token.raw = token.text;
                }
                if (Array.isArray(token.tokens)) scrubRawHtml(token.tokens);
                if (Array.isArray(token.items)) scrubRawHtml(token.items);
            }
        };
        scrubRawHtml(tokens);
        html = marked.parser(tokens);
    } else {
        html = marked.parse(String(text == null ? '' : text).replace(/</g, '&lt;'));
    }
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        });
    }
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('*').forEach(function(n) {
        if (!n.attributes) return;
        for (let i = n.attributes.length - 1; i >= 0; i--) {
            const attr = n.attributes[i];
            if (attr.name.startsWith('on') || (attr.name === 'href' && attr.value.toLowerCase().startsWith('javascript:'))) {
                n.removeAttribute(attr.name);
            }
        }
    });
    return div.innerHTML;
}

function addBlockActions(container, getText, copyPayload?, copyTitle?) {
    if (container.querySelector('.block-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'block-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'block-btn';
    const copyLabel = copyTitle || locale.copy;
    copyBtn.title = copyLabel;
    copyBtn.innerHTML = COPY_ICON_SVG;
    copyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        copyToClipboard((copyPayload || getText)()).then(function() {
            copyBtn.classList.add('copied');
            copyBtn.title = locale.copied;
            setTimeout(function() {
                copyBtn.classList.remove('copied');
                copyBtn.title = copyLabel;
            }, 1500);
        });
    });

    actions.appendChild(copyBtn);
    actions.appendChild(createInsertDropdown(getText));
    container.appendChild(actions);
}

function tableToMarkdown(table) {
    const rows = [];
    table.querySelectorAll('tr').forEach(function(tr) {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(function(cell) {
            cells.push((cell.textContent || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim());
        });
        if (cells.length) rows.push(cells);
    });
    if (!rows.length) return '';
    const widths = rows[0].map(function(_, index) {
        return Math.max.apply(null, rows.map(function(row) {
            return (row[index] || '').length;
        }));
    });
    const formatRow = function(row) {
        return '| ' + row.map(function(cell, index) {
            return (cell || '').padEnd(widths[index], ' ');
        }).join(' | ') + ' |';
    };
    const header = formatRow(rows[0]);
    const divider = '| ' + widths.map(function(width) {
        return '-'.repeat(Math.max(3, width));
    }).join(' | ') + ' |';
    const body = rows.slice(1).map(formatRow);
    return [header, divider].concat(body).join('\n');
}

function setupTableBlock(table) {
    if (!table || table.dataset.blockReady) return;
    table.dataset.blockReady = '1';
    const wrap = document.createElement('div');
    wrap.className = 'block-actions-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    addBlockActions(wrap, function() {
        return tableToMarkdown(table);
    });
}

function setupCodeBlock(codeBlock) {
    const pre = codeBlock.closest('pre');
    if (!pre || pre.dataset.blockReady) return;
    pre.dataset.blockReady = '1';
    hljs.highlightElement(codeBlock);
    const lang = (codeBlock.className.match(/language-(\w+)/) || [])[1] || '';
    const wrap = document.createElement('div');
    wrap.className = 'block-actions-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    // Copy hands over the code itself: a shell command with a fence around it is not
    // a command. The Insert menu keeps the fenced form, which is the portable one for
    // pasting into a document.
    addBlockActions(wrap, function() {
        const code = codeBlock.textContent || '';
        if (!lang) return code;
        return '```' + lang + '\n' + code + '\n```';
    }, function() {
        // No trailing newline: pasting into a terminal would run it. Whether a command
        // executes is the developer's decision, not the clipboard's.
        return (codeBlock.textContent || '').replace(/[\r\n]+$/, '');
    }, locale.copyCode);
}

export function setupContentBlocks(container) {
    if (!container) return;
    container.querySelectorAll('pre code').forEach(function(block) {
        setupCodeBlock(block);
    });
    container.querySelectorAll('table').forEach(function(table) {
        setupTableBlock(table);
    });
}

export function downloadSessionMarkdown(markdown, filename) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'chat-export.md';
    link.click();
    URL.revokeObjectURL(url);
}
