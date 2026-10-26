import * as vscode from 'vscode';
import { LocaleStrings } from '../../shared/i18n';
import { getWebviewLocale } from '../i18n';
import type { HostToPane } from '../../shared/webview';
import type { ChatMessage, ContextAttachMode, ContextAttachOption } from '../../shared/chat';

/** How eager the picker is: on a new tab, always, or never. */
export type ContextAttachVisibility = 'onNewSession' | 'always' | 'never';

/** What the offer needs from the host: the pane, and the transcript it may quote. */
export interface ContextAttachHost {
    post(msg: HostToPane): void;
    messages(): ChatMessage[];
}

export type { ContextAttachMode, ContextAttachOption };

/**
 * Context attach: a picker over the current tab's own local transcript. The picked messages
 * are pasted as text in front of the next prompt.
 *
 * It is NOT a way to load or link earlier sessions: nothing here reads another session or
 * asks Hermes for anything. Inherited from Rina, where a tab could silently get a fresh
 * Hermes session and this re-injected the history it had lost.
 */
export interface AttachableMessage {
    role: string;
    text: string;
}

const MEMORY_ROLES = new Set(['user', 'assistant', 'permission']);

/** Rough char budget for the pasted block (~8k tokens). It holds local messages, not a prior session. */
export const MAX_CONTEXT_ATTACH_CHARS = 32_000;

export function isAttachableRole(role: string): boolean {
    return MEMORY_ROLES.has(role);
}

export function truncateAttachMessages<T extends AttachableMessage>(
    messages: T[],
    maxChars: number = MAX_CONTEXT_ATTACH_CHARS
): T[] {
    if (messages.length === 0 || maxChars <= 0) {
        return [];
    }
    const picked: T[] = [];
    let total = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const text = (messages[i].text || '').trim();
        if (!text) {
            continue;
        }
        if (total + text.length > maxChars && picked.length > 0) {
            break;
        }
        picked.unshift(messages[i]);
        total += text.length;
        if (total >= maxChars) {
            break;
        }
    }
    return picked;
}

export function filterAttachableMessages<T extends AttachableMessage>(messages: T[]): T[] {
    return messages.filter(m => isAttachableRole(m.role) && (m.text || '').trim());
}

export function resolveAttachMessages<T extends AttachableMessage>(
    messages: T[],
    option: ContextAttachOption | undefined
): T[] {
    if (!option || option.mode === 'none' || messages.length === 0) {
        return [];
    }
    switch (option.mode) {
        case 'last2':
            return messages.slice(-2);
        case 'last10':
            return messages.slice(-10);
        case 'all':
            return truncateAttachMessages(messages.slice());
        default:
            return [];
    }
}

export function resolveCustomAttachMessages<T extends AttachableMessage>(
    allMessages: T[],
    indices?: number[]
): T[] {
    if (!indices?.length || allMessages.length === 0) {
        return [];
    }
    const picked: T[] = [];
    for (const index of indices) {
        if (typeof index !== 'number' || index < 0 || index >= allMessages.length) {
            continue;
        }
        const message = allMessages[index];
        if (
            !message
            || !isAttachableRole(message.role)
            || !(message.text || '').trim()
            || picked.includes(message)
        ) {
            continue;
        }
        picked.push(message);
    }
    return picked;
}

function attachRoleLabel(role: string, loc: LocaleStrings): string {
    switch (role) {
        case 'user':
            return loc.roleYou;
        case 'assistant':
            return loc.roleHermes;
        case 'permission':
            return loc.permissionTitle;
        case 'thought':
            return loc.roleThought;
        case 'tool':
            return loc.roleTool;
        default:
            return loc.roleMessage;
    }
}

export function buildContextAttachPrefix(
    messages: AttachableMessage[],
    loc: LocaleStrings
): string {
    if (messages.length === 0) {
        return '';
    }
    const lines = [loc.contextAttachPrefixHeader, ''];
    for (const message of messages) {
        const text = (message.text || '').trim();
        if (!text) {
            continue;
        }
        lines.push(`[${attachRoleLabel(message.role, loc)}]`, text, '');
    }
    lines.push('---');
    return lines.join('\n').trim();
}

export function composePromptWithContext(
    userText: string,
    contextMessages: AttachableMessage[],
    loc: LocaleStrings
): string {
    const prefix = buildContextAttachPrefix(contextMessages, loc);
    if (!prefix) {
        return userText;
    }
    return `${prefix}\n\n${userText}`;
}

/** The picker's live state: what it offers, whether it is up, and whether a reply is owed. */
export class ContextAttachOffer {
    private _messages: ChatMessage[] = [];
    private _active = false;
    private _awaitingReply = false;

    constructor(private _host: ContextAttachHost) {}

    /** Whether the picker is up, which is what decides if a send owes a reply. */
    isActive(): boolean {
        return this._active;
    }

    offer(messages: ChatMessage[]): void {
        if (this.visibility() === 'never') {
            this.clear();
            return;
        }
        const hasHistory = messages.some(m => (m.text || '').trim());
        if (!hasHistory) {
            this.clear();
            return;
        }
        this._messages = filterAttachableMessages(messages);
        this._active = true;
        this._host.post({ type: 'showContextAttach', count: this._messages.length });
    }

    visibility(): ContextAttachVisibility {
        const value = vscode.workspace.getConfiguration('tommys').get<string>('contextAttachVisibility', 'onNewSession');
        if (value === 'always' || value === 'never') {
            return value;
        }
        return 'onNewSession';
    }

    applyVisibility(): void {
        const mode = this.visibility();
        if (mode === 'never') {
            this.clear();
            return;
        }
        if (mode === 'always') {
            this.offer(this._host.messages());
            return;
        }
        if (this._active && !this._awaitingReply) {
            this.clear();
        }
    }

    clear(): void {
        if (!this._active && !this._awaitingReply) {
            return;
        }
        this._active = false;
        this._awaitingReply = false;
        this._messages = [];
        this._host.post({ type: 'hideContextAttach' });
    }

    buildPromptText(userText: string, option: ContextAttachOption | undefined): string {
        if (!this._active) {
            return userText;
        }
        const attachOption: ContextAttachOption = option?.mode
            ? option
            : { mode: 'none' };
        const picked = attachOption.mode === 'custom'
            ? resolveCustomAttachMessages(this._host.messages(), attachOption.indices)
            : resolveAttachMessages(this._messages, attachOption);
        if (picked.length === 0) {
            return userText;
        }
        return composePromptWithContext(userText, picked, getWebviewLocale());
    }

    completeAfterReply(): void {
        if (!this._awaitingReply) {
            return;
        }
        this._awaitingReply = false;
        if (this.visibility() === 'always') {
            return;
        }
        this.clear();
    }

    /** A turn started while the picker was up: the offer survives until its reply lands. */
    setAwaitingReply(value: boolean): void {
        this._awaitingReply = value;
    }
}
