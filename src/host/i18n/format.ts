/** Shared placeholder interpolation for Extension Host t() and WebView localeText(). */
export function formatLocaleString(text: string, ...args: (string | number)[]): string {
    // One pass, with a replacer function: substituting {0} must not let its text become a match for
    // {1}, and an argument holding `$&` or `$$` is data rather than a replacement pattern. A
    // multi-digit index is read whole, so filling {1} cannot eat the start of {10}.
    return text.replace(/\{(\d+)\}/g, (whole, index: string) =>
        Number(index) < args.length ? String(args[Number(index)]) : whole);
}

/** Injected into WebView HTML — must stay in sync with formatLocaleString(). */
export const WEBVIEW_LOCALE_HELPER = `function localeText(key) {
  var args = Array.prototype.slice.call(arguments, 1);
  return String(locale[key] || '').replace(/\\{(\\d+)\\}/g, function (whole, index) {
    return Number(index) < args.length ? String(args[Number(index)]) : whole;
  });
}`;
