import type { QuoteSegment } from '../../../shared/replyQuoteText';

/**
 * The quote block of a sent reply, drawn the way the composer drew it before sending.
 *
 * Same classes as the composer's panel (`reply-quote*`), so the message that goes out looks like
 * the message that was being composed: a titled head, the quoted segments with their role, and a
 * caret that collapses it. Nothing here reads state — the stored text carries the quote.
 */
export function buildReplyQuoteBlock(segments: QuoteSegment[], title: string): HTMLElement {
    const block = document.createElement('div');
    block.className = 'reply-quote';

    const head = document.createElement('div');
    head.className = 'reply-quote-head';

    const titleEl = document.createElement('span');
    titleEl.className = 'reply-quote-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'reply-quote-toggle';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = '▾';
    head.appendChild(toggle);
    block.appendChild(head);

    const body = document.createElement('div');
    body.className = 'reply-quote-body';
    for (let i = 0; i < segments.length; i++) {
        const row = document.createElement('div');
        row.className = 'reply-quote-segment';
        const role = document.createElement('span');
        role.className = 'reply-quote-role';
        role.textContent = segments[i].role + ': ';
        row.appendChild(role);
        row.appendChild(document.createTextNode(segments[i].text));
        body.appendChild(row);
    }
    block.appendChild(body);

    toggle.addEventListener('click', function() {
        const collapsed = block.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.textContent = collapsed ? '▸' : '▾';
    });

    return block;
}
