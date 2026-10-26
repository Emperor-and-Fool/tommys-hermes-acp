import type { HostToPane } from '../shared/webview';
import { maybeFocusInputAfterResponse, setInputMode } from './components/composer/composer';
import { applyHistoryCleared, applyHistoryStaged, renderHistorySessionList } from './components/composer/historyAttach';
import { positionFilePreview, previewRequests, renderFilePickerItems, showFilePreview } from './components/composer/fileMention';
import { offerUndeliveredMessage } from './components/composer/replyQuote';
import { closeConfigureEnvModal, finishConfigureEnvDetect, hideConfigureEnvDetectProgress, openConfigureEnvModal, setConfigureEnvDetecting, showConfigureEnvDetectPanel, updateConfigureEnvDetectProgress, updateConfigureEnvPathClearVisibility } from './components/environment/configureModal';
import { finishDetectEnvironmentPanel, initDetectEnvironmentStart, setDetectEnvIcon, updateDetectEnvironmentStep } from './components/environment/detectPanel';
import { downloadSessionMarkdown, scheduleSessionMarkdownRender } from './components/messages/markdown';
import { insertIntoInput } from './components/messages/messageActions';
import { appendMessage, insertBeforeLastUser, isMessageForActiveSession, maybeScrollToBottom, newChat, resetAutoScrollFollow, restoreHistory } from './components/messages/messageList';
import { dismissPermissionRequest, showPermissionRequest } from './components/messages/permissionCard';
import { finalizeAssistantBubble, finishStreaming } from './components/messages/streaming';
import { handleToolMessage, resetToolAggregation, setAuxMessageLive, setAuxiliaryContent } from './components/messages/toolCards';
import { renderAboutContent } from './components/modals/info';
import { renderLogContent } from './components/modals/logViewer';
import { isLogModalOpen, openLogModal, showModal } from './components/modals/modal';
import { clearSwitchQueued } from './components/modals/switchSession';
import { renderClosedList } from './components/pickers/closedSessions';
import { renderModelList } from './components/pickers/modelPicker';
import { renderProfileList } from './components/pickers/profilePicker';
import { applyInputPlaceholder, bindConnectionErrorActions, buildConnectionErrorPlaceholder, updateStatus } from './components/status/statusBar';
import { updateTokenUsage } from './components/status/tokenMeter';
import { renderSessionTabs } from './components/tabs/tabStrip';
import { afterHistoryRestored, applyViewerSurfaceRole } from './components/viewer/historyViewer';
import { aboutModal, byId, configureEnvDetectCompactIcon, configureEnvDetectCompactText, configureEnvPathInput, faqModal, filePickerEl, helpModal, inputEl } from './dom';
import { applyLocale, refreshRoleLabels } from './i18n';
import { state } from './state';
import { copyToClipboard } from './util/clipboard';

export function init(): void {
    window.addEventListener('message', function(event) {
        const msg = event.data as HostToPane;
        switch (msg.type) {
            case 'addMessage':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.role === 'history') {
                    // The card belongs above the question it was attached to, which is where the
                    // stored transcript puts it; appending would read differently after a reload.
                    insertBeforeLastUser('history', msg.text, { history: msg.history });
                    break;
                }
                if (msg.role === 'assistant') {
                    appendMessage('assistant', msg.text);
                } else if (msg.role === 'tool' && msg.toolCallId) {
                    handleToolMessage(msg.text, msg.toolCallId);
                } else if (msg.role === 'thought') {
                    // Update the current thought bubble while streaming the same segment
                    if (state.thoughtMsgId) {
                        const el = document.getElementById(state.thoughtMsgId);
                        if (el) {
                            setAuxiliaryContent(el, msg.text);
                            setAuxMessageLive(el, true);
                            maybeScrollToBottom();
                            break;
                        }
                    }
                    const id = appendMessage('thought', msg.text);
                    state.thoughtMsgId = id;
                } else {
                    appendMessage(msg.role, msg.text);
                }
                break;

            case 'status':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.status === 'connecting') {
                    state.connectionAttempted = true;
                }
                updateStatus(msg.status, msg.message);
                if (msg.status === 'ready') {
                    state.isPrompting = false;
                    state.awaitingFirstChunk = false;
                    resetToolAggregation();
                    finishStreaming();
                    state.canSend = true;
                    inputEl.disabled = false;
                    setInputMode('send');
                    state.placeholder.style.display = 'none';
                    if (!window._hermesRendered) {
                        scheduleSessionMarkdownRender();
                    }
                    maybeFocusInputAfterResponse();
                } else if (msg.status === 'prompting') {
                    state.isPrompting = true;
                    resetAutoScrollFollow();
                    state.canSend = false;
                    // Deliberately not disabling the textarea: the busy look comes from
                    // .input-composite-shell.waiting and the Send/Stop swap, not from a
                    // blurred input.
                    if (!state.awaitingFirstChunk) {
                        setInputMode('stop');
                    }
                } else if (msg.status === 'error') {
                    state.isPrompting = false;
                    state.awaitingFirstChunk = false;
                    state.canSend = false;
                    inputEl.disabled = true;
                    finishStreaming();
                    setInputMode('disabled');
                    updateTokenUsage(0, 0);
                    const errText = msg.message || locale.connectionError;
                    state.placeholder.innerHTML = buildConnectionErrorPlaceholder(errText);
                    bindConnectionErrorActions();
                    state.placeholder.style.display = 'block';
                } else if (msg.status === 'idle') {
                    state.isPrompting = false;
                    state.awaitingFirstChunk = false;
                    state.canSend = false;
                    inputEl.disabled = true;
                    finishStreaming();
                    setInputMode('disabled');
                    updateTokenUsage(0, 0);
                }
                break;

            case 'tokenUsage':
                updateTokenUsage(msg.used, msg.size);
                break;

            case 'newChat':
                state.paneHintText = '';
                newChat();
                break;

            case 'surfaceRole':
                if (msg.role === 'viewer') {
                    applyViewerSurfaceRole();
                    break;
                }
                document.body.classList.toggle('surface-rail', msg.role === 'rail');
                document.body.classList.toggle('surface-notabs', !!msg.hideTabs);
                break;

            case 'focusComposer':
                inputEl.focus();
                break;

            case 'noActiveTab':
                state.paneHintText = locale.noActiveTabHint;
                newChat();
                break;

            case 'insertInput':
                insertIntoInput(msg.text || '');
                break;

            case 'restoreHistory':
                restoreHistory(msg.messages, msg.localHistoryOnly);
                afterHistoryRestored(msg.messages, msg.sessionId);
                break;

            case 'detectEnvironmentStart':
                initDetectEnvironmentStart(msg.mode || 'manual');
                if (state.placeholder) state.placeholder.style.display = 'none';
                break;

            case 'detectEnvironmentProgress':
                updateDetectEnvironmentStep(msg);
                break;

            case 'detectEnvironmentEnd':
                finishDetectEnvironmentPanel(msg);
                break;

            case 'configureEnvironmentOpen':
                openConfigureEnvModal(msg.currentPath || '', msg.systemEnvVar, msg.systemEnvTarget);
                break;

            case 'configureEnvironmentDetectStart':
                setConfigureEnvDetecting(true);
                break;

            case 'configureEnvironmentDetectProgress':
                updateConfigureEnvDetectProgress(msg);
                break;

            case 'configureEnvironmentDetectEnd':
                finishConfigureEnvDetect(msg);
                break;

            case 'configureEnvironmentDetectClosed':
                hideConfigureEnvDetectProgress();
                setConfigureEnvDetecting(false);
                break;

            case 'configureEnvironmentBrowseResult':
                if (msg.path && configureEnvPathInput) {
                    configureEnvPathInput.value = msg.path;
                    state.configureEnvSelectedPath = msg.path;
                    updateConfigureEnvPathClearVisibility();
                } else if (msg.error && configureEnvDetectCompactText) {
                    showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'configureEnvironmentSaveResult':
                if (msg.ok) {
                    closeConfigureEnvModal();
                } else if (msg.error && configureEnvDetectCompactText) {
                    showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'setLocale':
                if (msg.locale) {
                    locale = msg.locale;
                    applyLocale();
                    if (state.lastSessions.length > 0) {
                        renderSessionTabs(state.lastSessions, state.lastActiveSessionId);
                    }
                }
                break;

            case 'undeliveredMessage':
                offerUndeliveredMessage(msg.text);
                break;

            case 'sessionList':
                if ((msg.sessions || []).length) state.paneHintText = '';
                renderSessionTabs(msg.sessions, msg.activeSessionId);
                renderHistorySessionList();
                if (state.switchQueuedFor && msg.activeSessionId === state.switchQueuedFor) {
                    clearSwitchQueued();
                }
                break;

            case 'sessionExport':
                if (msg.action === 'copy' && msg.markdown) {
                    copyToClipboard(msg.markdown);
                } else if (msg.action === 'export' && msg.markdown) {
                    downloadSessionMarkdown(msg.markdown, msg.filename);
                }
                break;

            case 'profileList':
                renderProfileList(msg.profiles);
                break;

            case 'hiddenSessions':
                state.closedSessions = Array.isArray(msg.sessions) ? msg.sessions : [];
                if (state.pendingOpenSessionId !== null && !state.closedSessions.some(function(s) { return s.sessionId === state.pendingOpenSessionId; })) {
                    // It was opened or deleted elsewhere; drop the stale pick.
                    state.pendingOpenSessionId = null;
                    state.pendingOpenTitle = '';
                    state.pendingOpenCount = 0;
                }
                renderClosedList();
                renderHistorySessionList();
                break;

            case 'modelList':
                renderModelList(msg);
                break;

            case 'log':
                if (msg.level === 'error' || msg.level === 'warning') {
                    state.logs.push({ line: msg.line, level: msg.level });
                    if (state.logs.length > 500) state.logs = state.logs.slice(-500);
                    if (isLogModalOpen()) {
                        renderLogContent();
                    }
                }
                break;

            case 'openLogs':
                openLogModal();
                break;

            case 'openAbout':
                renderAboutContent();
                showModal(aboutModal);
                break;

            case 'openHelp':
                showModal(helpModal);
                break;

            case 'openFaq':
                showModal(faqModal);
                break;

            case 'config':
                window._showThoughts = msg.showThoughts;
                window._showToolCalls = msg.showToolCalls;
                // Apply to existing messages
                document.querySelectorAll('.message-group.thought').forEach(function(el) {
                    el.style.display = msg.showThoughts ? '' : 'none';
                });
                document.querySelectorAll('.message-group.tool').forEach(function(el) {
                    el.style.display = msg.showToolCalls ? '' : 'none';
                });
                break;

            case 'activeAgent':
                if (msg.name) {
                    byId('profileLabel').textContent = msg.name;
                    refreshRoleLabels();
                    applyInputPlaceholder();
                }
                break;

            case 'pluginInfo':
                state.pluginInfo = msg;
                renderAboutContent();
                break;

            case 'fileList':
                if (filePickerEl.dataset.requestId === msg.requestId) {
                    renderFilePickerItems(msg.files || []);
                }
                break;

            case 'filePreview':
                if (previewRequests.has(msg.requestId)) {
                    const anchor = previewRequests.get(msg.requestId);
                    previewRequests.delete(msg.requestId);
                    showFilePreview(msg.path || '', msg.content, msg.error);
                    positionFilePreview(anchor);
                }
                break;

            case 'finishAssistantBubble':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                finalizeAssistantBubble();
                if (state.isPrompting && !state.awaitingFirstChunk) {
                    setInputMode('stop');
                }
                break;

            case 'permissionRequest':
                showPermissionRequest(msg);
                break;

            case 'permissionDismiss':
                dismissPermissionRequest(msg.id, locale.permissionCancelled);
                break;

            case 'historyStaged':
                applyHistoryStaged(msg.ref, msg.pending === true);
                break;

            case 'historyCleared':
                applyHistoryCleared();
                break;

        }
    });
}
