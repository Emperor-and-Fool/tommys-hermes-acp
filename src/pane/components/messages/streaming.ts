import { state } from '../../state';
import { setInputMode } from '../composer/composer';
import { processFileRefs } from '../composer/fileMention';
import { scheduleChatSearch } from '../search';
import { chatSearchState, renderMarkdown, setupContentBlocks } from './markdown';
import { clearAllToolLive, finalizeAuxiliaryBubble, setAuxMessageLive } from './toolCards';


export function isActivelyStreaming() {
    return !!(state.streamingMessageId || state.isPrompting);
}

/**
 * The thought segment is over — squash it back to its cap. Called when the agent moves on to
 * something else (a tool, the answer) as well as when the turn ends, so a card nobody is
 * writing to any more stops taking up the transcript.
 */
export function finalizeThoughtSegment() {
    if (!state.thoughtMsgId) {
        return;
    }
    const thoughtGroup = document.getElementById(state.thoughtMsgId);
    setAuxMessageLive(thoughtGroup, false);
    finalizeAuxiliaryBubble(thoughtGroup);
    state.thoughtMsgId = null;
}

export function finalizeAssistantBubble() {
    finalizeThoughtSegment();
    clearAllToolLive();
    if (state.streamingMessageId) {
        const group = document.getElementById(state.streamingMessageId);
        const el = group ? group.querySelector('.message') : null;
        if (el) {
            el.classList.remove('streaming');
            const text = el.querySelector('.content').textContent;
            if (group) group._rawText = text;
            el.querySelector('.content').innerHTML = renderMarkdown(text);
            setupContentBlocks(el.querySelector('.content'));
            processFileRefs(el.querySelector('.content'));
        }
        state.streamingMessageId = null;
    }
    if (chatSearchState.query) scheduleChatSearch();
}

export function enableStopAfterAgentOutput() {
    if (!state.awaitingFirstChunk) {
        return;
    }
    state.awaitingFirstChunk = false;
    if (state.isPrompting) {
        setInputMode('stop');
    }
}

export function finishStreaming() {
    finalizeAssistantBubble();
    if (state.isPrompting && state.awaitingFirstChunk) {
        setInputMode('waiting');
    } else {
        setInputMode(state.isPrompting ? 'stop' : (state.canSend ? 'send' : 'disabled'));
    }
}
