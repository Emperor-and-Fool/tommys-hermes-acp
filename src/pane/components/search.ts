import { byId, chatSearchInput, chatSearchNext, chatSearchPrev, messagesEl, required } from '../dom';
import { wrapTextRange } from './composer/replyQuote';
import { chatSearchState } from './messages/markdown';
import { getMessageContentEl, getMessagePlainText } from './messages/messageList';


const chatSearchCount = required('chatSearchCount');

function clearSearchMarks() {
    document.querySelectorAll('mark.search-mark').forEach(function(mark) {
        const text = document.createTextNode(mark.textContent);
        mark.parentNode?.replaceChild(text, mark);
    });
    document.querySelectorAll('.message-group').forEach(function(group) {
        group.classList.remove('search-hit', 'search-hit-active');
    });
}

function updateChatSearchUI() {
    const total = chatSearchState.matches.length;
    const hasQuery = !!chatSearchState.query;
    if (chatSearchCount) {
        if (!hasQuery) {
            chatSearchCount.textContent = '';
            chatSearchCount.classList.remove('no-match');
        } else if (total === 0) {
            chatSearchCount.textContent = '0/0';
            chatSearchCount.classList.add('no-match');
        } else {
            chatSearchCount.textContent = (chatSearchState.current + 1) + '/' + total;
            chatSearchCount.classList.remove('no-match');
        }
    }
    const canNav = total > 0;
    if (chatSearchPrev) chatSearchPrev.disabled = !canNav;
    if (chatSearchNext) chatSearchNext.disabled = !canNav;
}

function applyChatSearchHighlight() {
    clearSearchMarks();
    if (chatSearchState.current < 0 || !chatSearchState.matches.length) {
        updateChatSearchUI();
        return;
    }
    chatSearchState.matches.forEach(function(match) {
        match.group.classList.add('search-hit');
    });
    const active = chatSearchState.matches[chatSearchState.current];
    active.group.classList.add('search-hit-active');

    const byRoot = new Map<Element, Array<{ start: number; end: number; active: boolean }>>();
    chatSearchState.matches.forEach(function(match, idx) {
        const contentEl = getMessageContentEl(match.group);
        if (!contentEl) return;
        if (!byRoot.has(contentEl)) byRoot.set(contentEl, []);
        const bucket = byRoot.get(contentEl);
        if (!bucket) return;
        bucket.push({
            start: match.start,
            end: match.end,
            active: idx === chatSearchState.current,
        });
    });
    byRoot.forEach(function(ranges, root) {
        ranges.sort(function(a, b) { return b.start - a.start; });
        ranges.forEach(function(range) {
            wrapTextRange(root, range.start, range.end, range.active);
        });
    });

    active.group.scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateChatSearchUI();
}

function runChatSearch() {
    if (!chatSearchInput) return;
    const query = chatSearchInput.value.trim();
    chatSearchState.query = query;
    chatSearchState.matches = [];
    chatSearchState.current = -1;
    clearSearchMarks();
    if (!query) {
        updateChatSearchUI();
        return;
    }
    const needle = query.toLowerCase();
    messagesEl.querySelectorAll('.message-group').forEach(function(group) {
        const text = getMessagePlainText(group);
        const haystack = text.toLowerCase();
        let idx = 0;
        while ((idx = haystack.indexOf(needle, idx)) !== -1) {
            chatSearchState.matches.push({
                group: group,
                start: idx,
                end: idx + query.length,
            });
            idx += needle.length || 1;
        }
    });
    if (chatSearchState.matches.length > 0) {
        chatSearchState.current = 0;
        applyChatSearchHighlight();
    } else {
        updateChatSearchUI();
    }
}

export function scheduleChatSearch() {
    if (chatSearchState.timer) clearTimeout(chatSearchState.timer);
    chatSearchState.timer = setTimeout(function() {
        chatSearchState.timer = null;
        runChatSearch();
    }, 150);
}

export function clearChatSearch() {
    if (chatSearchState.timer) {
        clearTimeout(chatSearchState.timer);
        chatSearchState.timer = null;
    }
    if (chatSearchInput) chatSearchInput.value = '';
    chatSearchState.query = '';
    chatSearchState.matches = [];
    chatSearchState.current = -1;
    clearSearchMarks();
    updateChatSearchUI();
}

function gotoChatSearchMatch(delta: number) {
    const total = chatSearchState.matches.length;
    if (!total) return;
    chatSearchState.current = (chatSearchState.current + delta + total) % total;
    applyChatSearchHighlight();
}

export function initChatSearchInputInput(): void {
    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', scheduleChatSearch);
        chatSearchInput.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                gotoChatSearchMatch(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                gotoChatSearchMatch(1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) gotoChatSearchMatch(-1);
                else gotoChatSearchMatch(1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                clearChatSearch();
            }
        });
    }
}

export function initChatSearchPrevClick(): void {
    if (chatSearchPrev) {
        chatSearchPrev.addEventListener('click', function() { gotoChatSearchMatch(-1); });
    }
}

export function initChatSearchNextClick(): void {
    if (chatSearchNext) {
        chatSearchNext.addEventListener('click', function() { gotoChatSearchMatch(1); });
    }
}
