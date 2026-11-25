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
 * The line unpatched Hermes writes for a terminal result's `approval` field: its generic formatter
 * turns every result key into `- **key:** value` (acp_adapter/tools.py, _format_structured_value;
 * the field is set in tools/terminal_tool_result.py and terminal_tool_background.py).
 */
const APPROVAL_LINE = /^- \*\*approval:\*\* (.+)$/m;

/** The note from that line, and the text without it. */
function splitApprovalLine(text: string): { note: string; rest: string } {
    const match = APPROVAL_LINE.exec(text);
    if (!match) {
        return { note: '', rest: text };
    }
    const rest = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).replace(/\n{3,}/g, '\n\n');
    return { note: match[1].trim(), rest };
}

/**
 * The text of every approval note in an update, or '' when there is none.
 *
 * Two shapes: a block tagged `_meta.kind = approval` (a patched Hermes), or the `- **approval:** …`
 * line inside the tool's text (every Hermes). Either way it is not tool prose, so the body
 * extractor leaves it out and the pane draws it as its own line.
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
    if (typeof block.text === 'string') {
        return splitApprovalLine(block.text).note;
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
        return splitApprovalLine(block.text).rest;
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
