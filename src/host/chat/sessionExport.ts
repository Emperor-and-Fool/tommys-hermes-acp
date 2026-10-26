/** Markdown/JSON export of a chat. Pure: the provider supplies the model label. */
import { getWebviewLocale, t } from '../i18n';
import { formatLocaleString } from '../i18n/format';
import type { LocaleStrings } from '../../shared/i18n';
import type { ChatMessage, HistoryRef, SessionInfo } from '../../shared/chat';

export function buildSessionExportPayload(session: SessionInfo, messages: ChatMessage[], modelFallback?: string): {
    sessionId: string;
    title: string;
    markdown: string;
    filename: string;
} {
    const loc = getWebviewLocale();
    const title = session.title || t('newChat');
    const model = session.modelLabel || session.modelId || modelFallback || '—';
    const exportedAt = new Date();
    const header = [
        `# ${title}`,
        `> ${formatLocaleString(loc.sessionExportSessionId, session.id)}`,
        `> ${formatLocaleString(loc.sessionExportModel, model)}`,
        `> ${formatLocaleString(loc.sessionExportDate, formatExportDateTime(exportedAt))}`,
        '',
    ].join('\n');
    const body = formatMessagesAsMarkdown(messages);
    return {
        sessionId: session.id,
        title,
        markdown: body ? `${header}\n${body}` : header,
        filename: `${sanitizeExportFilename(title)}-${formatExportDateFilename(exportedAt)}.md`,
    };
}

export function formatMessagesAsMarkdown(messages: ChatMessage[]): string {
    const loc = getWebviewLocale();
    const parts: string[] = [];
    for (const message of messages) {
        const text = (message.text || '').trim();
        if (!text) {
            continue;
        }
        if (message.role === 'history') {
            parts.push(formatHistoryBlockForExport(text, message.history));
            continue;
        }
        parts.push(`## ${exportRoleLabel(message.role, loc)}\n\n${text}`);
    }
    return parts.join('\n\n');
}

/** A slice of another conversation: its own header, and the lines quoted under it. */
export function formatHistoryBlockForExport(text: string, ref?: HistoryRef): string {
    const loc = getWebviewLocale();
    const title = ref?.title || loc.roleMessage;
    const handle = ref && ref.profile
        ? ` (@session:${ref.profile}/${ref.sessionId})`
        : ref ? ` (@session:${ref.sessionId})` : '';
    const quote = text
        .split('\n')
        .map(line => `> ${line.replace(/\r$/, '')}`)
        .join('\n');
    return `## ${formatLocaleString(loc.historyCardHeader, title)}${handle}\n\n${quote}`;
}

export function exportRoleLabel(role: string, loc: LocaleStrings): string {
    switch (role) {
        case 'user':
            return loc.roleYou;
        case 'assistant':
            return loc.roleHermes;
        case 'thought':
            return loc.roleThought;
        case 'tool':
            return loc.roleTool;
        case 'permission':
            return loc.permissionTitle;
        default:
            return loc.roleMessage;
    }
}

export function formatExportDateTime(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatExportDateFilename(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function sanitizeExportFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'chat';
}

