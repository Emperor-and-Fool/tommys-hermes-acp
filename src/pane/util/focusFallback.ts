/* Keep a click from leaving <body> as the active element.
 *
 * The webview host — VSCodium's `pre/index.html`, in its `execCommand` handler — re-focuses the element
 * that last fired `focusin` before it runs `execCommand('copy')`, and only while
 * `document.activeElement` is <body>. In this pane that element is almost always the composer
 * textarea, so a selection made in the transcript (or in a log, help or history panel) while nothing
 * had focus is collapsed by that refocus and Ctrl+C copies nothing.
 *
 * `pointerup`, not `pointerdown`: the browser's own focus reset (blur to <body>) is the mousedown
 * default action, which runs after a pointerdown handler and would wipe a focus set there. Focusing a
 * non-editable element does not collapse the selection, so the drag that just finished survives.
 */
export function initFocusFallback(): void {
    const root = document.createElement('div');
    root.tabIndex = -1;
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;';
    document.body.appendChild(root);
    // Anything that focuses itself on purpose keeps its focus: the fallback is for content only.
    const interactive = 'button, a, input, textarea, select, label, [contenteditable], [role="button"]';
    document.addEventListener('pointerup', function(e) {
        const target = e.target instanceof Element ? e.target : null;
        if (!target || target.closest(interactive)) return;
        root.focus({ preventScroll: true });
    }, true);
}
