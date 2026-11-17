import type { PermissionOption } from '../../../shared/acp';

/**
 * Whether a permission request is one of Hermes' edit cards.
 *
 * Hermes builds those with exactly two answers, and names the allow one "Allow edit"
 * (`acp_adapter/edit_approval.py`). It is the only card where the permission root and the button
 * decide the outcome, so it is the only card that gets a hint; command cards get none.
 */
export function isEditCard(options: PermissionOption[] | undefined): boolean {
    const list = options || [];
    return list.some(option => /^allow edit$/i.test(String(option.name || '').trim()));
}
