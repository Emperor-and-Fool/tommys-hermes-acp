import { byId, inputEl } from '../../dom';
import { hostLog } from '../../post';
import { state } from '../../state';
import { pendingImages } from './composer';


export function renderPendingImagesBar() {
    // Mount by reference: a message in the transcript can define an element with this
    // id (tool cards render their body as HTML), and getElementById then returns that
    // copy — which sits thousands of pixels up the scrolled transcript.
    const composite = inputEl.closest('.input-composite') || inputEl.parentElement;
    if (!composite) { hostLog('[paste-bar] no composite to mount into'); return; }
    let bar = byId('imagePasteBar');
    if (pendingImages.length === 0) {
        if (bar) bar.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'imagePasteBar';
        bar.className = 'image-paste-bar';
        composite.insertBefore(bar, composite.firstChild);
    }
    hostLog('[paste-bar] rendering ' + pendingImages.length + ' thumbnail(s) in #' + composite.id);
    bar.innerHTML = '';
    pendingImages.forEach((img, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'image-paste-thumb';
        const el = document.createElement('img');
        el.src = 'data:' + img.mimeType + ';base64,' + img.data;
        const kb = Math.round((img.data.length * 0.75) / 1024);
        el.title = img.mimeType + ' — ' + kb + ' KB';
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'image-paste-remove';
        rm.setAttribute('aria-label', 'Remove image');
        rm.textContent = '×';
        rm.addEventListener('click', () => {
            pendingImages.splice(i, 1);
            renderPendingImagesBar();
        });
        wrap.appendChild(el);
        wrap.appendChild(rm);
        bar.appendChild(wrap);
    });
    const rect = bar.getBoundingClientRect();
    const first = bar.querySelector('img');
    const cs = getComputedStyle(bar);
    const r2 = (el) => { if (!el) return 'none'; const b = el.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.top); };
    const area = byId('input-area');
    const chatBody = byId('chat-body');
    const scroller = document.scrollingElement || document.body;
    hostLog('[paste-bar] mount parent=' + (bar.parentElement && bar.parentElement.id)
        + ' dupIds=' + document.querySelectorAll('#inputComposite').length
        + ' inInputArea=' + !!(area && area.contains(bar))
        + ' area=' + r2(area) + ' areaDisplay=' + (area ? getComputedStyle(area).display : 'none')
        + ' chatBody=' + r2(chatBody) + ' msgs=' + r2(byId('messages'))
        + ' scrollTop=' + Math.round(scroller.scrollTop) + ' scrollHeight=' + Math.round(scroller.scrollHeight));
    hostLog('[paste-bar] box=' + Math.round(rect.width) + 'x' + Math.round(rect.height)
        + ' top=' + Math.round(rect.top) + ' display=' + cs.display + ' vis=' + cs.visibility
        + ' opacity=' + cs.opacity
        + ' imgDecoded=' + (first ? first.complete + '/' + first.naturalWidth + 'x' + first.naturalHeight : 'none')
        + ' dataLen=' + (pendingImages[0] ? pendingImages[0].data.length : 0));
}

function bindImagePasteOnce() {
    if (state.__imgPasteBound || !inputEl) return;
    state.__imgPasteBound = true;
    inputEl.addEventListener('paste', async (e) => {
        const active = document.activeElement;
        hostLog('[paste] fired on #input, active=' + (active && (active.id || active.tagName)));
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) { hostLog('[paste] no clipboardData.items'); return; }
        const files = [];
        for (const it of items) {
            if (it.kind === 'file' && it.type.startsWith('image/')) {
                const f = it.getAsFile();
                if (f) files.push(f);
            }
        }
        const kinds = [];
        for (const it of items) kinds.push(it.kind + ':' + it.type);
        hostLog('[paste] items=' + items.length + ' [' + kinds.join(', ') + '] images=' + files.length);
        if (files.length === 0) return; // plain-text paste proceeds normally
        e.preventDefault();
        for (const f of files) {
            try {
                const buf = await f.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let bin = '';
                const CHUNK = 0x8000;
                for (let i = 0; i < bytes.length; i += CHUNK) {
                    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
                }
                pendingImages.push({ mimeType: f.type || 'image/png', data: btoa(bin) });
            } catch (err) {
                hostLog('[paste] stage failed: ' + (err && err.message));
                console.error('[image-paste] stage failed', err);
            }
        }
        hostLog('[paste] staged, pending=' + pendingImages.length);
        renderPendingImagesBar();
    });
}

export function initBindImagePasteOnce(): void {
    bindImagePasteOnce();
}
