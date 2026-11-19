import { describe, it } from 'mocha';
import assert from 'assert';
import { approvalModeNoticeApplies, permissionsState } from '../../pane/components/permissions/permissionsState';

/**
 * "Applies from the next run." is about one session: the one whose edit mode a run refused. The
 * pane shows it only while that session is the tab on screen.
 */
describe('the deferred edit-mode notice', () => {
    it('shows for the session it waits for', () => {
        permissionsState.approvalModeNotice = 'appliesNextRun';
        permissionsState.approvalModeNoticeSession = 'hermes-1';
        assert.strictEqual(approvalModeNoticeApplies('hermes-1'), true);
    });

    it('hides on another session, which is not in that state', () => {
        permissionsState.approvalModeNotice = 'appliesNextRun';
        permissionsState.approvalModeNoticeSession = 'hermes-1';
        assert.strictEqual(approvalModeNoticeApplies('hermes-2'), false);
    });

    it('never shows on a blank chat: it has no session to wait for', () => {
        permissionsState.approvalModeNotice = 'appliesNextRun';
        permissionsState.approvalModeNoticeSession = 'hermes-1';
        assert.strictEqual(approvalModeNoticeApplies(''), false, 'a blank tab resolves to no session');
    });

    it('says nothing once the mode was applied', () => {
        permissionsState.approvalModeNotice = '';
        permissionsState.approvalModeNoticeSession = '';
        assert.strictEqual(approvalModeNoticeApplies('hermes-1'), false);
    });
});
