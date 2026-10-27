/* What media/chat.html provides before the bundle runs. */

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

declare const marked: any;
declare const DOMPurify: any;
declare const hljs: any;
declare let locale: any;
declare function localeText(key: string, fallback?: string, ...args: any[]): string;

interface Window {
    _showThoughts: boolean;
    _showToolCalls: boolean;
    __tommysQuote: () => string | null;
    [key: string]: any;
}

/* Ported from plain JS: element property access stays unchecked until each component is typed. */
interface Element { [key: string]: any; }
interface EventTarget { [key: string]: any; }
interface Node { [key: string]: any; }
