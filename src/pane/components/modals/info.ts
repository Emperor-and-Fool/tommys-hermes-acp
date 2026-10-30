import { aboutModal, byId, faqModal, faqModalBody, helpModal, required } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { hideModal } from './modal';


export function buildFaqAccordion(container) {
    if (!container || container.querySelector('.faq-list')) {
        return;
    }
    const nodes = Array.from<Node>(container.childNodes);
    const wrapper = document.createElement('div');
    wrapper.className = 'faq-list';
    let i = 0;
    while (i < nodes.length) {
        const node = nodes[i];
        if (node.nodeType === 1 && node.tagName === 'H3') {
            const details = document.createElement('details');
            details.className = 'faq-item';
            if (wrapper.childElementCount === 0) {
                details.open = true;
            }
            const summary = document.createElement('summary');
            summary.className = 'faq-summary';
            summary.textContent = node.textContent;
            const body = document.createElement('div');
            body.className = 'faq-body';
            i += 1;
            while (i < nodes.length && !(nodes[i].nodeType === 1 && nodes[i].tagName === 'H3')) {
                body.appendChild(nodes[i]);
                i += 1;
            }
            details.appendChild(summary);
            details.appendChild(body);
            wrapper.appendChild(details);
        } else if (node.nodeType === 3 && !(node.textContent || '').trim()) {
            i += 1;
        } else {
            i += 1;
        }
    }
    if (wrapper.childElementCount > 0) {
        container.textContent = '';
        container.appendChild(wrapper);
    }
}

const aboutContent = required('aboutContent');

export function renderAboutContent() {
    const name = state.pluginInfo.displayName || 'Tommys Hermes ACP';
    const version = state.pluginInfo.version || '—';
    const publisher = state.pluginInfo.publisher || '';
    const repo = state.pluginInfo.repository || '';
    const iconUri = state.pluginInfo.iconUri || '';
    const logoHtml = iconUri
        ? '<div class="about-brand"><img src="' + escapeHtml(iconUri) + '" alt="' + escapeHtml(name) + '" /></div>'
        : '';
    aboutContent.innerHTML =
        logoHtml +
        '<h3>' + escapeHtml(name) + '</h3>' +
        '<p>' + locale.aboutVersion + ' <code>' + escapeHtml(version) + '</code>' +
        (publisher ? ' · ' + escapeHtml(publisher) : '') + '</p>' +
        '<p>' + locale.aboutDescription + '</p>' +
        '<ul>' +
        '<li>' + escapeHtml(locale.aboutFeatureTabs) + '</li>' +
        '<li>' + escapeHtml(locale.aboutFeaturePickers) + '</li>' +
        '<li>' + escapeHtml(locale.aboutFeatureInsert) + '</li>' +
        '<li>' + escapeHtml(locale.aboutFeatureTools) + '</li>' +
        '</ul>' +
        (repo ? '<p class="dim">' + escapeHtml(locale.repository) + '：<a href="#" data-url="' + escapeHtml(repo) + '">' + escapeHtml(repo) + '</a></p>' : '');
    aboutContent.querySelectorAll('a[data-url]').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            post({ type: 'openExternal', url: link.dataset.url });
        });
    });
}

function closeInfoModals() {
    hideModal(aboutModal);
    hideModal(helpModal);
    hideModal(faqModal);
}

export function initBtnClick(): void {
    document.querySelectorAll('.close-info-modal').forEach(function(btn) {
        btn.addEventListener('click', closeInfoModals);
    });
}

export function initAboutModalClick(): void {
    aboutModal.addEventListener('click', function(e) {
        if (e.target === aboutModal) closeInfoModals();
    });
}

export function initHelpModalClick(): void {
    helpModal.addEventListener('click', function(e) {
        if (e.target === helpModal) closeInfoModals();
    });
}

export function initFaqModalClick(): void {
    faqModal.addEventListener('click', function(e) {
        if (e.target === faqModal) closeInfoModals();
    });
}

export function initFaqModalBodyToggle(): void {
    if (faqModalBody) {
        faqModalBody.addEventListener('toggle', function(e) {
            const item = e.target instanceof HTMLDetailsElement ? e.target : null;
            if (!item || !item.classList.contains('faq-item') || !item.open) {
                return;
            }
            const list = item.closest('.faq-list');
            if (!list) {
                return;
            }
            list.querySelectorAll('.faq-item[open]').forEach(function(other) {
                if (other !== item) {
                    other.open = false;
                }
            });
        }, true);
        faqModalBody.addEventListener('click', function(e) {
            const target = e.target instanceof Element ? e.target : null;
            const link = target ? target.closest('a[data-url]') : null;
            if (!link) return;
            e.preventDefault();
            post({ type: 'openExternal', url: link.dataset.url });
        });
    }
}
