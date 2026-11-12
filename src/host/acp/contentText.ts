/** `_meta.kind` a content block carries when it is the approval note, not tool prose. */
export const APPROVAL_NOTE_KIND = 'approval';

function blockMetaKind(block: Record<string, unknown>): string {
    const meta = block._meta ?? block.meta;
    if (typeof meta !== 'object' || meta === null) {
        return '';
    }
    const kind = (meta as Record<string, unknown>).kind;
    return typeof kind === 'string' ? kind : '';
}

/**
 * The text of every approval-tagged block in an update, or '' when there is none.
 *
 * Hermes sends the note a gate wrote ("flagged … and auto-approved by smart approval") as its own
 * block so a client can draw it as a card; it is not tool prose, so the body extractor skips it.
 */
export function extractApprovalNoteFromContent(content: unknown): string {
    if (Array.isArray(content)) {
        return content.map(extractApprovalNoteFromContent).filter(Boolean).join('\n\n');
    }
    if (typeof content !== 'object' || content === null) {
        return '';
    }
    const block = content as Record<string, unknown>;
    if (blockMetaKind(block) === APPROVAL_NOTE_KIND) {
        return typeof block.text === 'string' ? block.text.trim() : '';
    }
    if (Array.isArray(block.content) || block.content != null) {
        return extractApprovalNoteFromContent(block.content);
    }
    return '';
}

/** Extract display text from an ACP content block (and legacy nested shapes). */
export function extractTextFromContentBlock(content: unknown): string {
    if (content == null) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map(extractTextFromContentBlock).join('');
    }
    if (typeof content !== 'object') {
        return '';
    }

    const block = content as Record<string, unknown>;
    if (blockMetaKind(block) === APPROVAL_NOTE_KIND) {
        // The approval card draws this one; it must not also sit inside the tool body.
        return '';
    }
    if (typeof block.text === 'string') {
        return block.text;
    }
    if (typeof block.thought === 'string') {
        return block.thought;
    }
    if (Array.isArray(block.content)) {
        return extractTextFromContentBlock(block.content);
    }
    if (block.content != null) {
        return extractTextFromContentBlock(block.content);
    }
    return '';
}
