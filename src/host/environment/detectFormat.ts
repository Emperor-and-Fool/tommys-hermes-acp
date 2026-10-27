/** Locale text for the environment-detection progress list. Pure: every input is a parameter. */
import { t } from '../i18n';
import { formatLocaleString } from '../i18n/format';
import type { LocaleStrings } from '../../shared/i18n';
import type {
    HermesDetectProgressEvent,
    HermesDetectStepId,
    HermesEnvironmentReport,
} from './profileDiscovery';

export function detectStepLabel(step: HermesDetectStepId): string {
    const keyMap: Record<HermesDetectStepId, keyof LocaleStrings> = {
        config: 'detectEnvironmentStepConfig',
        path_lookup: 'detectEnvironmentStepPath',
        known_path: 'detectEnvironmentStepKnownPath',
        pip: 'detectEnvironmentStepPip',
        python_import: 'detectEnvironmentStepPython',
        hermes_home: 'detectEnvironmentStepHermesHome',
        verify: 'detectEnvironmentStepVerify',
        acp_check: 'detectEnvironmentStepAcpCheck',
        acp_install: 'detectEnvironmentStepAcpInstall',
        summary: 'detectEnvironmentStepSummary',
    };
    return t(keyMap[step]);
}

export function formatDetectStepDetail(event: HermesDetectProgressEvent): string {
    if (event.status === 'running') {
        return '…';
    }
    if (event.status === 'skip') {
        return t('detectEnvironmentStepSkipped');
    }
    if (event.step === 'verify') {
        return formatLocaleString(
            t('detectEnvironmentStepVerifyCount'),
            event.verifiedCount ?? 0,
            event.totalCount ?? 0,
        );
    }
    if (event.step === 'acp_check') {
        if (event.status === 'ok') {
            return event.detail || t('detectEnvironmentStepAcpOk');
        }
        if (event.status === 'fail') {
            return event.detail || t('detectEnvironmentStepAcpFail');
        }
    }
    if (event.step === 'acp_install') {
        if (event.status === 'ok') {
            return event.detail || t('detectEnvironmentStepAcpInstallOk');
        }
        if (event.status === 'fail') {
            return event.detail || t('detectEnvironmentStepAcpInstallFail');
        }
    }
    if (event.step === 'summary') {
        if (event.detail) {
            return event.detail;
        }
        if (event.reportStatus === 'ready') return t('detectEnvironmentSummaryReady');
        if (event.reportStatus === 'broken') return t('detectEnvironmentSummaryBroken');
        return t('detectEnvironmentSummaryInstall');
    }
    if ((event.count ?? 0) > 0) {
        const summary = formatLocaleString(t('detectEnvironmentStepFoundCount'), event.count ?? 0);
        if (event.detail) {
            return `${summary}\n${event.detail}`;
        }
        return summary;
    }
    if (event.status === 'fail' && event.detail) {
        return event.detail;
    }
    return t('detectEnvironmentStepNotFound');
}

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

