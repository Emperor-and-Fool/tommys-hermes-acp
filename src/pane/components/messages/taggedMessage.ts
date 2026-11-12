import { renderMarkdown } from './markdown';

/**
 * One message inside a card, tagged with who said it.
 *
 * A forwarded card and an attached history slice both stack messages that came from elsewhere, and
 * both need the same three things: a pill naming the sender, the body rendered as markdown the way
 * an assistant reply is, and a rail that ties the bubble to its card. The card decides the accent
 * through `--card-accent`; this builder decides nothing about colour or layout.
 */
export function buildTaggedMessage(text: string, sender: string): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = 'tagged-msg';

    const pill = document.createElement('span');
    pill.className = 'tagged-pill';
    pill.textContent = sender;
    bubble.appendChild(pill);

    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = renderMarkdown(text);
    bubble.appendChild(content);

    return bubble;
}

/** What a sender pill says for one role in an attached slice. */
export function senderLabel(role: string): string {
    if (role === 'user') {
        return 'you';
    }
    if (role === 'assistant') {
        return 'agent';
    }
    return role;
}
