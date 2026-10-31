import { byId, chatSearchInput, chatSearchNext, chatSearchPrev, messagesEl, required } from '../dom';
import { closeQuickPanel, openQuickPanel } from './composer/composer';
import { wrapTextRange } from './composer/replyQuote';
import { chatSearchState } from './messages/markdown';
import { getMessageContentEl, getMessagePlainText } from './messages/messageList';


const chatSearchCount = required<HTMLElement>('chatSearchCount');

/**
 * One search, several bars.
 *
 * The transcript has one search: the query, the matches and the active match all live in
 * `chatSearchState`. What differs is where you type it — the quick-actions panel while reading, the
 * selection toolbar while picking messages. Each place registers a bar; they share the state, so the
 * query survives the move between them instead of starting a second, separate search.
 */
export interface SearchBar {
    input: HTMLInputElement;
    count?: HTMLElement | null;
    prev?: HTMLButtonElement | null;
    next?: HTMLButtonElement | null;
}

const bars: SearchBar[] = [];

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
    bars.forEach(function(bar) {
        if (bar.count) {
            if (!hasQuery) {
                bar.count.textContent = '';
                bar.count.classList.remove('no-match');
            } else if (total === 0) {
                bar.count.textContent = '0/0';
                bar.count.classList.add('no-match');
            } else {
                bar.count.textContent = (chatSearchState.current + 1) + '/' + total;
                bar.count.classList.remove('no-match');
            }
        }
        const canNav = total > 0;
        if (bar.prev) bar.prev.disabled = !canNav;
        if (bar.next) bar.next.disabled = !canNav;
    });
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

    // Scroll to the match, not to its message: one group can be taller than the pane (the longest
    // answer in a session here is 68 KB), and centring that group leaves the word hundreds of lines
    // off-screen, so the view hardly moves and looks like nothing happened.
    const activeMark = active.group.querySelector('mark.search-mark-active');
    const scrollTarget: Element = activeMark ?? active.group;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTarget.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    updateChatSearchUI();
}

function runChatSearch() {
    const query = chatSearchState.query.trim();
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
    bars.forEach(function(bar) { bar.input.value = ''; });
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

/**
 * Wire one bar. Typing in any of them drives the shared query (and mirrors the text into the others);
 * the arrows and Enter step through the same matches, so the two places behave identically.
 */
export function registerSearchBar(bar: SearchBar): void {
    bars.push(bar);
    bar.input.addEventListener('input', function() {
        bars.forEach(function(other) {
            if (other !== bar) other.input.value = bar.input.value;
        });
        chatSearchState.query = bar.input.value;
        scheduleChatSearch();
    });
    bar.input.addEventListener('keydown', function(e) {
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
    if (bar.prev) {
        bar.prev.addEventListener('click', function() { gotoChatSearchMatch(-1); });
    }
    if (bar.next) {
        bar.next.addEventListener('click', function() { gotoChatSearchMatch(1); });
    }
    updateChatSearchUI();
}

export function initChatSearchInputInput(): void {
    registerSearchBar({
        input: chatSearchInput,
        count: chatSearchCount,
        prev: chatSearchPrev,
        next: chatSearchNext,
    });
}

/** The primary bar owns the arrows in the quick panel; the router's older call sites stay valid. */


const SEARCH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm5.03 8.47 2.5 2.5-.7.7-2.5-2.5.7-.7z"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 3.3 8 6.9l3.6-3.6.9.9L8.9 7.8l3.6 3.6-.9.9L8 8.7l-3.6 3.6-.9-.9 3.6-3.6L3.5 4.2l.9-.9z"/></svg>';

/**
 * The stack's second control: find in this conversation.
 *
 * It is one button in two states — the magnifier opens quick actions (where the field lives, and
 * which focuses it), and while that panel is open it becomes a red cross that closes it. A search
 * with no visible way out is the state this replaces.
 */
export function initChatSearchFab(): void {
    const button = byId<HTMLButtonElement>('searchCtl');
    if (!button) {
        return;
    }
    const paint = (open: boolean): void => {
        button.innerHTML = open ? CLOSE_ICON : SEARCH_ICON;
        // While the panel is open the way out must be visible, not hover-gated like the magnifier.
        button.classList.toggle('is-close', open);
        button.classList.toggle('is-dim', !open);
        button.title = open ? localeText('searchClose') : localeText('searchOpen');
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', open ? 'true' : 'false');
    };
    document.addEventListener('hermes:quick-panel', function(e) {
        paint(!!(e as CustomEvent<{ open: boolean }>).detail?.open);
    });
    button.addEventListener('click', function() {
        if (button.classList.contains('is-close')) {
            closeQuickPanel();
            return;
        }
        if (chatSearchInput.disabled) {
            return;
        }
        openQuickPanel();
    });
    paint(false);
}
