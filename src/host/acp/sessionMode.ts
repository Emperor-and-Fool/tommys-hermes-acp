/**
 * Which edit mode Hermes says this session is in.
 *
 * The ACP schema writes it in camelCase (`modes.currentModeId`), the gateway in the same shape but
 * some notifications arrive snake_cased (`current_mode_id`) — both are read here so a renames in
 * either place cannot silently leave us believing the session is on the mode we asked for.
 */
export function sessionModeFrom(source: unknown): string {
    if (!source || typeof source !== 'object') {
        return '';
    }
    const record = source as Record<string, unknown>;
    const modes = record.modes;
    if (modes && typeof modes === 'object') {
        const state = modes as Record<string, unknown>;
        const id = state.currentModeId ?? state.current_mode_id;
        if (typeof id === 'string' && id) {
            return id;
        }
    }
    const direct = record.currentModeId ?? record.current_mode_id;
    return typeof direct === 'string' ? direct : '';
}
