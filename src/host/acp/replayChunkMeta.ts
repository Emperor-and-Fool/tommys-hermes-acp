/**
 * The fields ACP sends beside the text, which the replay sink used to drop.
 *
 * Nothing reads these yet. They are captured so a later consumer — a progressive paint, a
 * dedupe by id, tool follow-along, a badge, a re-link to the message a draft came from — does
 * not need a protocol round trip or a Hermes-side change to find out.
 *
 * `_meta` is a reserved extensibility slot: captured as-is, never interpreted here.
 */

export interface ChunkMeta {
    /** `ContentChunk.messageId`: all chunks of one assistant message share it. */
    messageId?: string;
    meta?: Record<string, unknown>;
}

export interface ToolMeta {
    toolTitle?: string;
    toolKind?: string;
    toolStatus?: string;
    toolLocations?: Array<{ path: string; line?: number }>;
    meta?: Record<string, unknown>;
}

function asMeta(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
}

/** Locations as ACP sends them: `{path, line?}` entries; anything else is dropped, not guessed. */
export function parseToolLocations(value: unknown): Array<{ path: string; line?: number }> | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const locations: Array<{ path: string; line?: number }> = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const path = asString((entry as Record<string, unknown>).path);
        if (!path) {
            continue;
        }
        const line = (entry as Record<string, unknown>).line;
        locations.push(typeof line === 'number' ? { path, line } : { path });
    }
    return locations.length ? locations : undefined;
}

/** What a text chunk carries beside its content. Absent stays absent — never an empty string. */
export function extractChunkMeta(update: Record<string, unknown>): ChunkMeta {
    const extras: ChunkMeta = {};
    const messageId = asString(update.messageId);
    if (messageId) {
        extras.messageId = messageId;
    }
    const meta = asMeta(update._meta);
    if (meta) {
        extras.meta = meta;
    }
    return extras;
}

/** What a tool row carries beside its rendered text. */
export function extractToolMeta(
    update: Record<string, unknown>,
    view: { title?: string; kind?: string; status?: string }
): ToolMeta {
    const extras: ToolMeta = {};
    if (view.title) {
        extras.toolTitle = view.title;
    }
    if (view.kind) {
        extras.toolKind = view.kind;
    }
    if (view.status) {
        extras.toolStatus = view.status;
    }
    const locations = parseToolLocations(update.locations);
    if (locations) {
        extras.toolLocations = locations;
    }
    const meta = asMeta(update._meta);
    if (meta) {
        extras.meta = meta;
    }
    return extras;
}
