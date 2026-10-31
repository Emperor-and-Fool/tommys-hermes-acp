import { byId, tokenUsageRing, required } from '../../dom';
import { TOKEN_RING_RADIUS } from './statusBar';


const tokenUsageArc = required('tokenUsageArc');

const tokenUsagePct = required('tokenUsagePct');

const TOKEN_RING_CIRCUMFERENCE = 2 * Math.PI * TOKEN_RING_RADIUS;

function formatTokenCount(n: number): string {
    const value = Number(n) || 0;
    if (value >= 1_000_000) {
        return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (value >= 10_000) {
        return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    if (value >= 1_000) {
        return (value / 1_000).toFixed(1) + 'k';
    }
    return String(value);
}

export function updateTokenUsage(used: number, size: number) {
    if (!tokenUsageRing || !tokenUsageArc) return;
    const usedTokens = Math.max(0, Number(used) || 0);
    const totalTokens = Math.max(0, Number(size) || 0);
    if (totalTokens <= 0) {
        tokenUsageRing.hidden = true;
        return;
    }
    const pct = Math.min(100, Math.round((usedTokens / totalTokens) * 100));
    const filled = (pct / 100) * TOKEN_RING_CIRCUMFERENCE;
    tokenUsageArc.style.strokeDasharray = filled + ' ' + TOKEN_RING_CIRCUMFERENCE;
    const level = pct >= 90 ? 'high' : pct >= 70 ? 'medium' : 'low';
    tokenUsageRing.dataset.level = level;
    if (tokenUsagePct) {
        tokenUsagePct.textContent = pct + '%';
        tokenUsagePct.style.fontSize = pct >= 100 ? '7px' : '8px';
    }
    const label = localeText('tokenUsageLabel', formatTokenCount(usedTokens), formatTokenCount(totalTokens), pct);
    tokenUsageRing.title = label;
    tokenUsageRing.setAttribute('aria-label', label);
    tokenUsageRing.hidden = false;
}
