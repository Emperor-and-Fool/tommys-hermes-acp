/**
 * The environment-detection progress list: its step ids, the locale key each step maps to, and the
 * one copy of the status rules for the detail line.
 *
 * Pure — the caller supplies the locale lookup and the placeholder filler, so the host's `t()` and
 * the pane's `localeText()` both drive this file without it knowing either exists. One map and one
 * set of branches: a new step is added here, not in two places.
 */

export const DETECT_STEP_IDS = [
    'config', 'path_lookup', 'known_path', 'pip', 'python_import', 'hermes_home', 'verify', 'acp_check', 'acp_install', 'summary',
];

const STEP_LOCALE_KEYS: Record<string, string> = {
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

/** The progress fields the wire carries, whichever flow sent it. */
export interface DetectProgressFields {
    step: string;
    status: string;
    brief?: string;
    detail?: string;
    paths?: string[];
    count?: number;
    verifiedCount?: number;
    totalCount?: number;
    reportStatus?: string;
}

/** A locale string by key, or '' when the key is missing. */
export type LocaleLookup = (key: string) => string;

/** A locale string by key with its `{0}`, `{1}` placeholders filled. */
export type LocaleFill = (key: string, ...args: (string | number)[]) => string;

/** The row title. An unknown step keeps its raw id rather than showing nothing. */
export function detectStepLabel(step: string, lookup: LocaleLookup): string {
    const key = STEP_LOCALE_KEYS[step];
    return (key ? lookup(key) : '') || step;
}

/** The row detail: one line per status, with the summary's own precedence over the generic ones. */
export function formatDetectStepDetail(msg: DetectProgressFields, lookup: LocaleLookup, fill: LocaleFill): string {
    if (msg.status === 'running') return '…';
    if (msg.status === 'skip') return lookup('detectEnvironmentStepSkipped') || 'Skipped';
    if (msg.step === 'verify') {
        return fill('detectEnvironmentStepVerifyCount', msg.verifiedCount ?? 0, msg.totalCount ?? 0);
    }
    if (msg.step === 'acp_check') {
        if (msg.status === 'ok') return msg.detail || lookup('detectEnvironmentStepAcpOk');
        if (msg.status === 'fail') return msg.detail || lookup('detectEnvironmentStepAcpFail');
    }
    if (msg.step === 'acp_install') {
        if (msg.status === 'ok') return msg.detail || lookup('detectEnvironmentStepAcpInstallOk');
        if (msg.status === 'fail') return msg.detail || lookup('detectEnvironmentStepAcpInstallFail');
    }
    if (msg.step === 'summary') {
        if (msg.detail) return msg.detail;
        if (msg.reportStatus === 'ready') return lookup('detectEnvironmentSummaryReady');
        if (msg.reportStatus === 'broken') return lookup('detectEnvironmentSummaryBroken');
        return lookup('detectEnvironmentSummaryInstall') || lookup('detectEnvironmentSummaryNotFound') || '';
    }
    if ((msg.count ?? 0) > 0) {
        const summary = fill('detectEnvironmentStepFoundCount', msg.count ?? 0);
        return msg.detail ? `${summary}\n${msg.detail}` : summary;
    }
    if (msg.status === 'fail' && msg.detail) return msg.detail;
    return lookup('detectEnvironmentStepNotFound') || 'Not found';
}
