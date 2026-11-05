/** Locale text for the environment-detection progress list. Pure: every input is a parameter. */
import { t } from '../i18n';
import type {
    HermesDetectProgressEvent,
    HermesDetectStepId,
    HermesEnvironmentReport,
} from './profileDiscovery';

export function formatDetectProgressPercent(event: HermesDetectProgressEvent, stepOrder: HermesDetectStepId[]): string {
    const total = stepOrder.length;
    if (total === 0) {
        return '0%';
    }
    const stepIndex = stepOrder.indexOf(event.step);
    if (stepIndex < 0) {
        return '0%';
    }
    let completed = stepIndex;
    if (event.status !== 'running') {
        completed = stepIndex + 1;
    }
    if (event.step === 'summary' && event.status !== 'running') {
        completed = total;
    }
    const percent = Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
    return `${percent}%`;
}

export function formatDetectBrokenMessage(report: HermesEnvironmentReport): string {
    const hasVerifiedHermes = report.executables.some((item) => item.verified);
    if (hasVerifiedHermes && !report.diagnostics.acpOk) {
        return report.diagnostics.acpInstallAttempted
            ? t('detectEnvironmentSummaryAcpManual')
            : t('detectEnvironmentSummaryAcpBroken');
    }
    return t('detectEnvironmentBroken');
}

export function formatDetectSummaryForReport(report: HermesEnvironmentReport): string {
    if (report.status === 'not_found') {
        return t('detectEnvironmentSummaryInstall');
    }
    if (report.status === 'broken') {
        const hasVerifiedHermes = report.executables.some((item) => item.verified);
        if (hasVerifiedHermes && !report.diagnostics.acpOk) {
            if (report.diagnostics.acpInstallAttempted) {
                return t('detectEnvironmentSummaryAcpManual');
            }
            return t('detectEnvironmentSummaryAcpBroken');
        }
        return t('detectEnvironmentSummaryBroken');
    }
    if (
        report.recommendation.action === 'configure_plugin'
    ) {
        return t('detectEnvironmentSummaryConfigureViaMenu');
    }
    return t('detectEnvironmentSummaryReady');
}

