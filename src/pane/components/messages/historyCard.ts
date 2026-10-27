import type { HistoryRef } from '../../../shared/chat';

/** Local date and time, so a span reads as something a person can place. */
function formatSpan(from?: number, to?: number): string {
    if (typeof from !== 'number' || typeof to !== 'number') {
        return '';
    }
    return `${new Date(from).toLocaleString()} → ${new Date(to).toLocaleString()}`;
}

/**
 * A slice of another conversation, rendered as a card.
 *
 * It borrows the tool/thought card's classes rather than inventing a look: header label, collapsible
 * body with the same toggles. The meta line says how much came across and, when the lookup found
 * them, the real session handle and span; otherwise the quote the agent can search for.
 */
/** 5 lines at the aux line-height of 1.35em, the same cap a thought card takes. */
const COLLAPSED_MAX_HEIGHT = '6.75em';

export function buildHistoryCard(text: string, ref?: HistoryRef) {
    const div = document.createElement('div');
    div.className = 'message history';

    const header = document.createElement('div');
    header.className = 'aux-header';
    const label = document.createElement('div');
    label.className = 'label aux-label';
    label.textContent = localeText('historyCardHeader', ref ? ref.title : '');
    header.appendChild(label);
    div.appendChild(header);

    if (ref) {
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        const session = ref.profile ? `@session:${ref.profile}/${ref.sessionId}` : ref.sessionId;
        const span = formatSpan(ref.from, ref.to);
        const where = span
            ? `${localeText('historyCardSpan')}: ${span}`
            : ref.anchor
              ? `${localeText('historyCardAnchor')}: “${ref.anchor}”`
              : '';
        meta.textContent = [localeText('historyCardCount', String(ref.count)), session, where]
            .filter(part => !!part)
            .join(' · ');
        meta.title = meta.textContent;
        div.appendChild(meta);
    }

    const wrap = document.createElement('div');
    wrap.className = 'aux-body-wrap';

    const scrollEl = document.createElement('div');
    scrollEl.className = 'aux-body-scroll is-collapsed';
    // The class alone does not cap anything; without this the card renders at full height
    // and the toggles below have nothing to expand or collapse.
    scrollEl.style.maxHeight = COLLAPSED_MAX_HEIGHT;
    const contentEl = document.createElement('div');
    contentEl.className = 'aux-body-content';
    contentEl.textContent = text || '';
    scrollEl.appendChild(contentEl);
    wrap.appendChild(scrollEl);

    const controls = document.createElement('div');
    controls.className = 'aux-body-controls';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'aux-body-toggle';
    moreBtn.textContent = locale.permissionShowMore || 'Show more';
    const lessBtn = document.createElement('button');
    lessBtn.type = 'button';
    lessBtn.className = 'aux-body-toggle';
    lessBtn.textContent = locale.permissionCollapse || 'Collapse';
    lessBtn.hidden = true;
    // Unhidden by the mount site, which is the first moment the card has a measurable height.
    moreBtn.hidden = true;
    controls.appendChild(moreBtn);
    controls.appendChild(lessBtn);
    wrap.appendChild(controls);
    div.appendChild(wrap);

    moreBtn.addEventListener('click', () => {
        scrollEl.style.maxHeight = '';
        scrollEl.classList.remove('is-collapsed');
        moreBtn.hidden = true;
        lessBtn.hidden = false;
    });
    lessBtn.addEventListener('click', () => {
        scrollEl.style.maxHeight = COLLAPSED_MAX_HEIGHT;
        scrollEl.classList.add('is-collapsed');
        lessBtn.hidden = true;
        moreBtn.hidden = false;
    });

    return { div, scrollEl, moreBtn };
}
