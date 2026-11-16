import type { HostToPane } from '../shared/webview';
import * as composer from './components/composer/composer';
import * as historyAttach from './components/composer/historyAttach';
import * as fileMention from './components/composer/fileMention';
import * as replyQuote from './components/composer/replyQuote';
import * as configureModal from './components/environment/configureModal';
import * as detectPanel from './components/environment/detectPanel';
import * as markdown from './components/messages/markdown';
import * as messageActions from './components/messages/messageActions';
import * as messageList from './components/messages/messageList';
import * as permissionCard from './components/messages/permissionCard';
import * as streaming from './components/messages/streaming';
import * as toolCards from './components/messages/toolCards';
import * as info from './components/modals/info';
import * as logViewer from './components/modals/logViewer';
import * as modal from './components/modals/modal';
import * as switchSession from './components/modals/switchSession';
import * as closedSessions from './components/pickers/closedSessions';
import * as modelPicker from './components/pickers/modelPicker';
import * as profilePicker from './components/pickers/profilePicker';
import * as statusBar from './components/status/statusBar';
import * as tokenMeter from './components/status/tokenMeter';
import * as workSpace from './components/workspace/workSpace';
import * as historyViewer from './components/viewer/historyViewer';

import { aboutModal, configureEnvDetectCompactIcon, configureEnvDetectCompactText, configureEnvPathInput, faqModal, filePickerEl, helpModal, inputEl, required } from './dom';
import { applyLocale, refreshRoleLabels } from './i18n';
import { state } from './state';
import { copyToClipboard } from './util/clipboard';

export function init(): void {
    window.addEventListener('message', function(event) {
        const msg = event.data as HostToPane;
        switch (msg.type) {
            case 'addMessage':
                if (!messageList.isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.role === 'history') {
                    // The card belongs above the question it was attached to, which is where the
                    // stored transcript puts it; appending would read differently after a reload.
                    messageList.insertBeforeLastUser('history', msg.text, { history: msg.history });
                    break;
                }
                if (msg.role === 'peer') {
                    messageList.appendMessage('peer', msg.text, { peer: msg.peer, peerState: msg.peerState, history: msg.history, peerMessages: msg.messages });
                    break;
                }
                if (msg.role === 'assistant') {
                    messageList.appendMessage('assistant', msg.text);
                } else if (msg.role === 'tool' && msg.toolCallId) {
                    toolCards.handleToolMessage(msg.text, msg.toolCallId);
                } else if (msg.role === 'thought') {
                    // ACP interleaves tool traffic with thinking, so a thought chunk that
                    // continues what is on screen updates the card; one that does not is a new
                    // segment, and the old card is squashed rather than left streaming forever.
                    if (state.thoughtMsgId) {
                        const el = document.getElementById(state.thoughtMsgId);
                        const aux = el && el._auxState;
                        const continues = !!aux && typeof msg.text === 'string'
                            && msg.text.startsWith(aux.rawText || '');
                        if (el && continues) {
                            toolCards.setAuxMessageLive(el, true);
                            toolCards.setAuxiliaryContent(el, msg.text);
                            messageList.maybeScrollToBottom();
                            break;
                        }
                        streaming.finalizeThoughtSegment();
                    }
                    const id = messageList.appendMessage('thought', msg.text);
                    state.thoughtMsgId = id;
                    const liveGroup = document.getElementById(id);
                    if (liveGroup) toolCards.setAuxMessageLive(liveGroup, true);
                } else {
                    messageList.appendMessage(msg.role, msg.text, { steer: msg.steer === true });
                }
                break;

            case 'loadProgress':
                if (!messageList.isMessageForActiveSession(msg)) {
                    break;
                }
                statusBar.updateLoadProgress(msg.received);
                break;

            case 'status':
                if (!messageList.isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.status === 'connecting') {
                    state.connectionAttempted = true;
                }
                statusBar.updateStatus(msg.status, msg.message);
                if (msg.status === 'ready') {
                    state.isPrompting = false;
                    state.awaitingFirstChunk = false;
                    // canSend first: streaming.finishStreaming derives the input mode from it, so setting
                    // it afterwards left streaming.finishStreaming computing 'disabled' and needing a
                    // second composer.setInputMode('send') to correct it.
                    state.canSend = true;
                    toolCards.resetToolAggregation();
                    streaming.finishStreaming();
                    inputEl.disabled = false;
                    state.placeholder.style.display = 'none';
                    if (!window._hermesRendered) {
                        markdown.scheduleSessionMarkdownRender();
                    }
                    composer.maybeFocusInputAfterResponse();
                    // Last action of a run: everything above the end has just shrunk (the final
                    // markdown pass, a thought squashing), so without this the answer stops
                    // short of the bottom by however much those cards lost.
                    messageList.maybeScrollToBottom();
                } else if (msg.status === 'prompting') {
                    state.isPrompting = true;
                    messageList.resetAutoScrollFollow();
                    state.canSend = false;
                    // Deliberately not disabling the textarea: the busy look comes from
                    // .input-composite-shell.waiting and the Send/Stop swap, not from a
                    // blurred input.
                    if (!state.awaitingFirstChunk) {
                        composer.setInputMode('stop');
                    }
                } else if (msg.status === 'error') {
                    state.isPrompting = false;
                    state.awaitingFirstChunk = false;
                    state.canSend = false;
                    inputEl.disabled = true;
                    streaming.finishStreaming();
                    composer.setInputMode('disabled');
                    tokenMeter.updateTokenUsage(0, 0);
                    const errText = msg.message || locale.connectionError;
                    state.placeholder.innerHTML = statusBar.buildConnectionErrorPlaceholder(errText);
                    statusBar.bindConnectionErrorActions();
                    state.placeholder.style.display = 'block';
                } else if (msg.status === 'idle') {
                    state.isPrompting = false;
                    state.awaitingFirstChunk = false;
                    state.canSend = false;
                    inputEl.disabled = true;
                    streaming.finishStreaming();
                    composer.setInputMode('disabled');
                    tokenMeter.updateTokenUsage(0, 0);
                }
                break;

            case 'tokenUsage':
                tokenMeter.updateTokenUsage(msg.used, msg.size);
                break;

            case 'newChat':
                state.paneHintText = '';
                state.blankChat = msg.sessionId ? { id: msg.sessionId, project: msg.project || '' } : null;
                messageList.newChat();
                break;

            case 'surfaceRole':
                if (msg.role === 'viewer') {
                    historyViewer.applyViewerSurfaceRole();
                    break;
                }
                document.body.classList.toggle('surface-rail', msg.role === 'rail');
                document.body.classList.toggle('surface-notabs', !!msg.hideTabs);
                if (msg.bodyRole) {
                    document.body.dataset.role = msg.bodyRole;
                }
                break;

            case 'peerActionResult':
                messageList.applyPeerState(msg.envelopeId, msg.state, msg.text);
                break;

            case 'setOtherPaneLive':
                messageActions.applyOtherPaneProfile(msg.profile, msg.live);
                break;

            case 'openProfilePicker':
                profilePicker.openProfilePicker();
                break;

            case 'focusComposer':
                inputEl.focus();
                break;

            case 'noActiveTab':
                state.paneHintText = locale.noActiveTabHint;
                messageList.newChat();
                break;

            case 'insertInput':
                messageActions.insertIntoInput(msg.text || '');
                break;

            case 'restoreHistory':
                messageList.restoreHistory(msg.messages, msg.localHistoryOnly);
                historyViewer.afterHistoryRestored(msg.messages, msg.sessionId);
                break;

            case 'historyFetchEmpty':
                historyViewer.showViewerEmpty();
                break;

            case 'historyFetchFailed':
                historyViewer.showViewerFetchFailed(msg.reason);
                break;

            case 'detectEnvironmentStart':
                detectPanel.initDetectEnvironmentStart(msg.mode || 'manual');
                if (state.placeholder) state.placeholder.style.display = 'none';
                break;

            case 'detectEnvironmentProgress':
                detectPanel.updateDetectEnvironmentStep(msg);
                break;

            case 'detectEnvironmentEnd':
                detectPanel.finishDetectEnvironmentPanel(msg);
                break;

            case 'configureEnvironmentOpen':
                configureModal.openConfigureEnvModal(msg.currentPath || '', msg.systemEnvVar, msg.systemEnvTarget);
                break;

            case 'configureEnvironmentDetectStart':
                configureModal.setConfigureEnvDetecting(true);
                break;

            case 'configureEnvironmentDetectProgress':
                configureModal.updateConfigureEnvDetectProgress(msg);
                break;

            case 'configureEnvironmentDetectEnd':
                configureModal.finishConfigureEnvDetect(msg);
                break;

            case 'configureEnvironmentDetectClosed':
                configureModal.hideConfigureEnvDetectProgress();
                configureModal.setConfigureEnvDetecting(false);
                break;

            case 'configureEnvironmentBrowseResult':
                if (msg.path && configureEnvPathInput) {
                    configureEnvPathInput.value = msg.path;
                    state.configureEnvSelectedPath = msg.path;
                    configureModal.updateConfigureEnvPathClearVisibility();
                } else if (msg.error && configureEnvDetectCompactText) {
                    configureModal.showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    detectPanel.setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'configureEnvironmentSaveResult':
                if (msg.ok) {
                    configureModal.closeConfigureEnvModal();
                } else if (msg.error && configureEnvDetectCompactText) {
                    configureModal.showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    detectPanel.setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'setLocale':
                if (msg.locale) {
                    locale = msg.locale;
                    applyLocale();
                    if (state.lastSessions.length > 0) {
                        workSpace.renderTree(state.lastSessions, state.lastActiveSessionId);
                    }
                }
                break;

            case 'undeliveredMessage':
                replyQuote.offerUndeliveredMessage(msg.text);
                break;

            case 'sessionList':
                // Four features share this message: each is handed it in turn, and each decides for
                // itself what part is its own. The order is the order of the effects it replaces.
                statusBar.onSessionList(msg);
                workSpace.onSessionList(msg);
                historyAttach.renderHistorySessionList();
                switchSession.onSessionList(msg);
                break;

            case 'projectList':
                workSpace.onProjectList(msg);
                break;

            case 'projectNotice':
                workSpace.onProjectNotice(msg);
                break;

            case 'sessionExport':
                if (msg.action === 'copy' && msg.markdown) {
                    copyToClipboard(msg.markdown);
                } else if (msg.action === 'export' && msg.markdown) {
                    markdown.downloadSessionMarkdown(msg.markdown, msg.filename);
                }
                break;

            case 'profileList':
                profilePicker.renderProfileList(msg.profiles);
                break;

            case 'hiddenSessions':
                state.closedSessions = Array.isArray(msg.sessions) ? msg.sessions : [];
                if (state.pendingOpenSessionId !== null && !state.closedSessions.some(function(s) { return s.sessionId === state.pendingOpenSessionId; })) {
                    // It was opened or deleted elsewhere; drop the stale pick.
                    state.pendingOpenSessionId = null;
                    state.pendingOpenTitle = '';
                    state.pendingOpenCount = 0;
                }
                closedSessions.renderClosedList();
                historyAttach.renderHistorySessionList();
                break;

            case 'modelList':
                modelPicker.renderModelList(msg);
                break;

            case 'log':
                if (msg.level === 'error' || msg.level === 'warning') {
                    state.logs.push({ line: msg.line, level: msg.level });
                    if (state.logs.length > 500) state.logs = state.logs.slice(-500);
                    if (modal.isLogModalOpen()) {
                        logViewer.renderLogContent();
                    }
                }
                break;

            case 'openLogs':
                modal.openLogModal();
                break;

            case 'openAbout':
                info.renderAboutContent();
                modal.showModal(aboutModal);
                break;

            case 'openHelp':
                modal.showModal(helpModal);
                break;

            case 'openFaq':
                modal.showModal(faqModal);
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
                    required('profileLabel').textContent = msg.name;
                    refreshRoleLabels();
                    statusBar.applyInputPlaceholder();
                }
                break;

            case 'pluginInfo':
                state.pluginInfo = msg;
                info.renderAboutContent();
                break;

            case 'fileList':
                if (filePickerEl.dataset.requestId === msg.requestId) {
                    fileMention.renderFilePickerItems(msg.files || []);
                }
                break;

            case 'filePreview':
                if (fileMention.previewRequests.has(msg.requestId)) {
                    const anchor = fileMention.previewRequests.get(msg.requestId);
                    fileMention.previewRequests.delete(msg.requestId);
                    fileMention.showFilePreview(msg.path || '', msg.content || '', msg.error);
                    if (anchor) fileMention.positionFilePreview(anchor);
                }
                break;

            case 'finishAssistantBubble':
                if (!messageList.isMessageForActiveSession(msg)) {
                    break;
                }
                streaming.finalizeAssistantBubble();
                if (state.isPrompting && !state.awaitingFirstChunk) {
                    composer.setInputMode('stop');
                }
                break;

            case 'permissionRequest':
                permissionCard.showPermissionRequest(msg);
                break;

            case 'permissionDismiss':
                permissionCard.dismissPermissionRequest(msg.id, locale.permissionCancelled);
                break;

            case 'approvalMode':
                permissionCard.applyApprovalMode(msg.mode, msg.error, msg.denyCount, msg.denyBackup, msg.openAccess);
                break;

            case 'historyStaged':
                historyAttach.applyHistoryStaged(msg.ref, msg.pending === true);
                break;

            case 'historyCleared':
                historyAttach.applyHistoryCleared();
                break;

        }
    });
}
