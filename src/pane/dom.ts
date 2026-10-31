/* Elements used by more than one module, plus the lookup helper. */
export function byId<T = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

/**
 * An element the served HTML is expected to contain. The page is built by this extension, so a
 * missing id is a build mistake, not a user state: fail loudly at startup instead of guarding a
 * hundred call sites that can never see null.
 */
export function required<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id) as T | null;
    if (!el) throw new Error(`pane: #${id} is missing from the served document`);
    return el;
}

export const aboutModal = required('aboutModal');
export const cancelBtn = required('cancelBtn');
export const chatBodyEl = required('chat-body');
export const chatSearchInput = required<HTMLInputElement>('chatSearchInput');
export const chatSearchNext = required<HTMLButtonElement>('chatSearchNext');
export const chatSearchPrev = required<HTMLButtonElement>('chatSearchPrev');
export const clearInputBtn = required('clearInputBtn');
export const closedPicker = required('closedPicker');
export const closedPickerBtn = required('closedPickerBtn');
export const closedPickerLabel = required('closedPickerLabel');
export const configureEnvBrowseBtn = required('configureEnvBrowseBtn');
export const configureEnvCancelBtn = required('configureEnvCancelBtn');
export const configureEnvCandidatesEmpty = required('configureEnvCandidatesEmpty');
export const configureEnvDetectBtn = required('configureEnvDetectBtn');
export const configureEnvDetectCompactIcon = required('configureEnvDetectCompactIcon');
export const configureEnvDetectCompactText = required('configureEnvDetectCompactText');
export const configureEnvDetectSteps = required('configureEnvDetectSteps');
export const configureEnvDetectToggle = required('configureEnvDetectToggle');
export const configureEnvModal = required('configureEnvModal');
export const configureEnvPathClearBtn = required('configureEnvPathClearBtn');
export const configureEnvPathInput = required('configureEnvPathInput');
export const configureEnvSaveBtn = required('configureEnvSaveBtn');
export const configureEnvSystemBtn = required('configureEnvSystemBtn');
export const historyPickerBtn = required('historyPickerBtn');
export const historyPickerLabel = required('historyPickerLabel');
export const historyPicker = required('historyPicker');
export const copyLogBtn = required('copyLogBtn');
export const copySessionBtn = required('copySessionBtn');
export const detectEnvBtn = required('detectEnvBtn');
export const detectEnvToggle = required('detectEnvToggle');
export const faqModal = required('faqModal');
export const faqModalBody = required('faqModalBody');
export const filePickerEl = required('filePicker');
export const helpModal = required('helpModal');
export const historyChip = required('historyChip');
export const historyChipClear = required('historyChipClear');
export const historyChipPending = required('historyChipPending');
export const historyChipText = required('historyChipText');
export const historySessionList = required('historySessionList');
export const inputEl = required('input');
export const inputResizeHandle = required('inputResizeHandle');
export const logModal = required('logModal');
export const messagesEl = required('messages');
export const modelBtn = required('modelBtn');
export const modelPicker = required('modelPicker');
export const multiSelectAllBtn = required('multiSelectAllBtn');
export const historyRoleFilters = required('historyRoleFilters');
export const historyRoleUser = required('historyRoleUser');
export const historyRoleAssistant = required('historyRoleAssistant');
export const historyRoleThought = required('historyRoleThought');
export const historyRoleTool = required('historyRoleTool');
export const historyRoleReload = required('historyRoleReload');
export const multiSelectAttachConfirmBtn = required('multiSelectAttachConfirmBtn');
export const multiSelectCopyBtn = required('multiSelectCopyBtn');
export const multiSelectDeleteBtn = required('multiSelectDeleteBtn');
export const multiSelectExitBtn = required('multiSelectExitBtn');
export const multiSelectExportBtn = required('multiSelectExportBtn');
export const openTabBtn = required('openTabBtn');
export const profileBtn = required('profileBtn');
export const profilePicker = required('profilePicker');
export const quickToggleBtn = required('quickToggleBtn');
export const retryBtn = required('retryBtn');
export const sendBtn = required('sendBtn');
export const statusText = required('statusText');
export const tabBar = required('tab-bar');
export const tabContextMenu = required('tabContextMenu');
export const tokenUsageRing = required('tokenUsageRing');
