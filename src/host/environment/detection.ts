/**
 * Finding and starting Hermes on this machine, and the UI around it.
 *
 * Everything here was the provider's: the detection state machine, its progress posts, the
 * configure panel, and the two ways a path gets written (plugin setting, system PATH). Moved
 * unchanged; the provider keeps only what it must — the webview posts, the log, the reconnect
 * after Save, and the view title.
 *
 * `DetectionHost` is a bag of functions rather than a reference to the provider, the same shape
 * as `PromptHost` in chat/promptRunner.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { identity, setting, settingsSection } from '../../shared/extensionId';
import type { HostToPane } from '../../shared/webview';
import {
    detectStepLabel,
    formatDetectBrokenMessage,
    formatDetectProgressPercent,
    formatDetectStepDetail,
    formatDetectSummaryForReport,
} from './detectFormat';
import { detectHermesEnvironment } from './hermesEnvironmentDetect';
import { addHermesDirectoryToSystemPath, getHermesExecutableDirectory } from './hermesPathSetup';
import { accessExecutable, venvHermesCandidates } from './hermesPaths';
import type {
    HermesDetectProgressEvent,
    HermesDetectSource,
    HermesDetectStepId,
    HermesDetectStepStatus,
    HermesEnvironmentReport,
    HermesExecutableCandidate,
} from './hermesEnvironmentDetect';

/** What the host supplies: the four provider concerns this module cannot own. */
export interface DetectionHost {
    /** Post to the webview, already bound to the right surface. */
    post(msg: HostToPane): void;
    log(line: string): void;
    /** Reconnect after a Save, with whatever selection the provider holds. */
    reconnect(): Promise<void>;
    /** Clear the generated view title once detection state is gone. */
    resetViewTitle(): void;
}

interface DetectStepLogEntry {
    step: HermesDetectStepId;
    label: string;
    detail: string;
    status: HermesDetectStepStatus;
}

export class EnvironmentDetection {
    private _detectStepLog: DetectStepLogEntry[] = [];
    private _lastDetectReport: HermesEnvironmentReport | undefined;
    private _detectInProgress = false;
    private _detectAbortController?: AbortController;
    private readonly _detectStepOrder: HermesDetectStepId[] = [
        'config',
        'path_lookup',
        'known_path',
        'pip',
        'python_import',
        'hermes_home',
        'verify',
        'acp_check',
        'acp_install',
        'summary',
    ];


    constructor(private _host: DetectionHost) {}

    private _setDetectContext(inProgress: boolean, reportAvailable: boolean): void {
        this._detectInProgress = inProgress;
        void vscode.commands.executeCommand('setContext', `${identity().prefix}DetectInProgress`, inProgress);
        void vscode.commands.executeCommand('setContext', `${identity().prefix}DetectReportAvailable`, reportAvailable);
    }

    dismiss(): void {
        if (this._detectInProgress && this._detectAbortController) {
            this._detectAbortController.abort();
            this._host.log('Environment detection cancelled by user');
        }
    }

    private _postDetectProgress(event: HermesDetectProgressEvent): void {
        const brief = formatDetectProgressPercent(event, this._detectStepOrder);
        this._host.post({
            type: 'detectEnvironmentProgress',
            step: event.step,
            status: event.status,
            brief,
            detail: event.detail,
            paths: event.paths,
            count: event.count,
            verifiedCount: event.verifiedCount,
            totalCount: event.totalCount,
            reportStatus: event.reportStatus,
        });
    }

    clear(): void {
        this._host.resetViewTitle();
        this._detectStepLog = [];
        this._lastDetectReport = undefined;
        this._setDetectContext(false, false);
    }

    private _recordDetectStep(event: HermesDetectProgressEvent): void {
        const entry: DetectStepLogEntry = {
            step: event.step,
            label: detectStepLabel(event.step),
            detail: formatDetectStepDetail(event),
            status: event.status,
        };
        const index = this._detectStepLog.findIndex((item) => item.step === event.step);
        if (index >= 0) {
            this._detectStepLog[index] = entry;
        } else {
            this._detectStepLog.push(entry);
        }
    }

    async runWithUi(
        configuredPath?: string,
        mode: 'connect' | 'manual' | 'configure' = 'manual',
    ): Promise<HermesEnvironmentReport> {
        this._detectStepLog = [];
        this._detectAbortController?.abort();
        this._detectAbortController = new AbortController();
        const signal = this._detectAbortController.signal;
        const useConfigurePanel = mode === 'configure';
        if (!useConfigurePanel) {
            this._setDetectContext(true, !!this._lastDetectReport);
            this._host.post({ type: 'detectEnvironmentStart', mode });
        } else {
            this._setDetectContext(true, !!this._lastDetectReport);
            this._host.post({ type: 'configureEnvironmentDetectStart' });
        }

        const report = await detectHermesEnvironment(configuredPath, {
            signal,
            onProgress: (event) => {
                if (useConfigurePanel) {
                    this._postConfigureDetectProgress(event);
                } else {
                    this._postDetectProgress(event);
                }
                this._recordDetectStep(event);
            },
        });
        this._detectAbortController = undefined;

        if (report.status === 'cancelled') {
            this._setDetectContext(false, false);
            if (useConfigurePanel) {
                this._host.post({ type: 'configureEnvironmentDetectEnd', status: 'cancelled' });
            }
            return report;
        }

        this._logEnvironmentReport(report);
        this._lastDetectReport = report;
        const summaryStatus: HermesDetectStepStatus = report.status === 'ready' ? 'ok' : 'fail';
        const summaryText = formatDetectSummaryForReport(report);
        const summaryEvent: HermesDetectProgressEvent = {
            step: 'summary',
            status: summaryStatus,
            reportStatus: report.status,
            detail: summaryText,
        };
        this._recordDetectStep(summaryEvent);
        if (useConfigurePanel) {
            this._postConfigureDetectProgress(summaryEvent);
            this._host.post({
                type: 'configureEnvironmentDetectEnd',
                status: report.status,
                summary: summaryText,
                executables: this._serializeConfigureExecutables(report.executables),
            });
        } else {
            this._postDetectProgress(summaryEvent);
            this._host.post({
                type: 'detectEnvironmentEnd',
                status: report.status,
                mode,
                brief: '100%',
                summaryStatus,
            });
        }
        this._setDetectContext(false, true);
        return report;
    }

    public async detectEnvironment(): Promise<void> {
        if (this._detectInProgress) {
            return;
        }
        this._host.log('Environment detection requested');
        const config = vscode.workspace.getConfiguration(settingsSection());
        const configuredPath = config.get<string>('path') || undefined;
        const report = await this.runWithUi(configuredPath, 'manual');

        if (report.status === 'cancelled') {
            return;
        }
        if (report.status === 'not_found') {
            await vscode.window.showErrorMessage(t('detectEnvironmentNotFound'));
            return;
        }
        if (report.status === 'broken') {
            await vscode.window.showErrorMessage(formatDetectBrokenMessage(report));
            return;
        }
    }

    public configureEnvironment(): void {
        if (this._detectInProgress) {
            return;
        }
        const config = vscode.workspace.getConfiguration(settingsSection());
        const systemEnv = this._getSystemPathEnvInfo();
        this._host.post({
            type: 'configureEnvironmentOpen',
            currentPath: config.get<string>('path') || '',
            systemEnvVar: systemEnv.varName,
            systemEnvTarget: systemEnv.varTarget,
        });
    }

    private _getSystemPathEnvInfo(): { varName: string; varTarget: string } {
        if (process.platform === 'win32') {
            return {
                varName: 'Path',
                varTarget: t('detectEnvironmentSystemVarTargetWindows'),
            };
        }
        return {
            varName: 'PATH',
            varTarget: t('detectEnvironmentSystemVarTargetUnix'),
        };
    }

    private _postConfigureDetectProgress(event: HermesDetectProgressEvent): void {
        const brief = formatDetectProgressPercent(event, this._detectStepOrder);
        this._host.post({
            type: 'configureEnvironmentDetectProgress',
            step: event.step,
            status: event.status,
            brief,
            detail: event.detail,
            paths: event.paths,
            count: event.count,
            verifiedCount: event.verifiedCount,
            totalCount: event.totalCount,
            reportStatus: event.reportStatus,
        });
    }

    private _serializeConfigureExecutables(
        executables: HermesExecutableCandidate[],
    ): Array<{ path: string; source: string; verified: boolean; version?: string }> {
        return executables.map((item) => ({
            path: item.path,
            source: this._detectSourceLabel(item.source),
            verified: item.verified,
            version: item.version,
        }));
    }

    async browse(): Promise<void> {
        const picked = await this._browseHermesExecutable();
        this._host.post({
            type: 'configureEnvironmentBrowseResult',
            path: picked,
            error: picked ? undefined : t('configureEnvironmentInvalidPath'),
        });
    }

    private async _browseHermesExecutable(): Promise<string | undefined> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            title: t('configureEnvironmentBrowseTitle'),
            filters: process.platform === 'win32'
                ? { Executable: ['exe', 'cmd', 'bat'] }
                : undefined,
        });
        if (!picked?.[0]) {
            return undefined;
        }
        return this._resolveHermesFromBrowseSelection(picked[0].fsPath);
    }

    private async _resolveHermesFromBrowseSelection(fsPath: string): Promise<string | undefined> {
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(fsPath);
        } catch {
            return undefined;
        }
        if (stat.isFile()) {
            return (await accessExecutable(fsPath)) ? fsPath : undefined;
        }
        if (!stat.isDirectory()) {
            return undefined;
        }
        const exeName = process.platform === 'win32' ? 'hermes.exe' : 'hermes';
        const direct = path.join(fsPath, exeName);
        if (await accessExecutable(direct)) {
            return direct;
        }
        for (const candidate of venvHermesCandidates(fsPath)) {
            if (await accessExecutable(candidate)) {
                return candidate;
            }
        }
        if (path.basename(fsPath) === 'hermes-agent') {
            const venvCandidates = process.platform === 'win32'
                ? [
                    path.join(fsPath, 'venv', 'Scripts', 'hermes.exe'),
                    path.join(fsPath, 'venv', 'Scripts', 'hermes.cmd'),
                ]
                : [path.join(fsPath, 'venv', 'bin', 'hermes')];
            for (const candidate of venvCandidates) {
                if (await accessExecutable(candidate)) {
                    return candidate;
                }
            }
        }
        return undefined;
    }

    async detectInConfigure(currentPath?: string): Promise<void> {
        if (this._detectInProgress) {
            return;
        }
        const configuredPath = currentPath?.trim() || undefined;
        await this.runWithUi(configuredPath, 'configure');
    }

    async save(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim() ?? '';
        if (trimmed && !(await accessExecutable(trimmed))) {
            this._host.post({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentInvalidPath'),
            });
            return;
        }
        try {
            await this._configureHermesPluginPath(trimmed, { notify: false });
            this._host.post({
                type: 'configureEnvironmentSaveResult',
                ok: true,
                path: trimmed,
            });
            await this._host.reconnect();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.post({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentSaveFailed', msg),
            });
        }
    }

    closeConfigure(): void {
        if (this._detectInProgress && this._detectAbortController) {
            this._detectAbortController.abort();
            this._host.log('Configure panel environment detection cancelled by user');
        }
        this._host.post({ type: 'configureEnvironmentDetectClosed' });
    }

    async configureSystem(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim();
        if (!trimmed || !(await accessExecutable(trimmed))) {
            this._host.post({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentInvalidPath'),
            });
            return;
        }
        await this._confirmAndConfigureHermesSystemPath(trimmed);
    }

    async openDirectory(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim();
        if (!trimmed) {
            return;
        }
        const directory = path.dirname(trimmed);
        await vscode.env.openExternal(vscode.Uri.file(directory));
    }

    pickBestExecutable(report: HermesEnvironmentReport): string | undefined {
        const verified = report.executables.filter((item) => item.verified);
        const pool = verified.length > 0 ? verified : report.executables;
        return pool[0]?.path;
    }

    shouldOfferConfiguration(report: HermesEnvironmentReport): boolean {
        if (!this.pickBestExecutable(report)) {
            return false;
        }
        const workspaceConfig = vscode.workspace.getConfiguration(settingsSection());
        const configuredPath = workspaceConfig.get<string>('path')?.trim();
        const pluginConfigValid = !!configuredPath && report.executables.some(
            (item) => item.source === 'config' && item.verified,
        );
        const onSystemPath = report.executables.some(
            (item) => item.source === 'path_lookup' && item.verified,
        );
        return !(pluginConfigValid || onSystemPath);
    }

    async autoConfigure(report: HermesEnvironmentReport): Promise<string | undefined> {
        const executable = await this._pickDetectedHermesExecutable(report.executables);
        if (!executable) {
            return undefined;
        }
        await this._configureHermesPluginPath(executable, { notify: false });
        return executable;
    }

    private async _confirmAndConfigureHermesSystemPath(executable: string): Promise<void> {
        const pathEntry = getHermesExecutableDirectory(executable);
        const { varName, varTarget } = this._getSystemPathEnvInfo();
        const choice = await vscode.window.showWarningMessage(
            t('detectEnvironmentConfigureSystemConfirm', pathEntry, varName, varTarget),
            { modal: true },
            t('detectEnvironmentConfigureSystemConfirmYes'),
            t('detectEnvironmentConfigureSystemConfirmNo'),
        );
        if (choice !== t('detectEnvironmentConfigureSystemConfirmYes')) {
            return;
        }
        await this._configureHermesSystemPath(executable);
    }

    private _logEnvironmentReport(report: HermesEnvironmentReport): void {
        const lines = [
            `Detect status=${report.status} install=${report.installMethod ?? 'unknown'}`,
            `pip=${report.diagnostics.pipInstalled} pythonImport=${report.diagnostics.pythonImportOk}`,
            `candidates=${report.executables.length}`,
        ];
        for (const item of report.executables) {
            lines.push(`  [${item.source}] ${item.path} verified=${item.verified}${item.version ? ` (${item.version})` : ''}`);
        }
        this._host.log(lines.join('\n'));
    }

    private _detectSourceLabel(source: HermesDetectSource): string {
        const keyMap: Record<HermesDetectSource, keyof import('../../shared/i18n').LocaleStrings> = {
            config: 'detectEnvironmentSourceConfig',
            path_lookup: 'detectEnvironmentSourcePathLookup',
            known_path: 'detectEnvironmentSourceKnownPath',
            pip: 'detectEnvironmentSourcePip',
            python_import: 'detectEnvironmentSourcePythonImport',
            hermes_home: 'detectEnvironmentSourceHermesHome',
        };
        return t(keyMap[source]);
    }

    private async _pickDetectedHermesExecutable(
        executables: HermesExecutableCandidate[],
    ): Promise<string | undefined> {
        const verified = executables.filter((item) => item.verified);
        const pool = verified.length > 0 ? verified : executables;
        if (pool.length === 1) {
            return pool[0].path;
        }
        const picked = await vscode.window.showQuickPick(
            pool.map((item) => {
                const statusLabel = item.verified
                    ? t('detectEnvironmentCandidateVerified')
                    : t('detectEnvironmentCandidateUnverified');
                const versionSuffix = item.version ? ` · ${item.version}` : '';
                return {
                    label: path.basename(item.path),
                    description: `${item.path} · ${this._detectSourceLabel(item.source)} · ${statusLabel}${versionSuffix}`,
                    executable: item.path,
                };
            }),
            {
                title: t('detectEnvironmentPickExecutable'),
                placeHolder: t('detectEnvironmentPickExecutable'),
            },
        );
        return picked?.executable;
    }

    private async _configureHermesPluginPath(
        executable: string,
        options?: { notify?: boolean },
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration(settingsSection());
        await config.update('path', executable, vscode.ConfigurationTarget.Global);
        this._host.log(`Configured ${setting('path')}: ${executable}`);
        if (options?.notify !== false) {
            void vscode.window.showInformationMessage(t('detectEnvironmentPluginConfigured', executable));
        }
    }

    private async _configureHermesSystemPath(executable: string): Promise<void> {
        try {
            const { varName, varTarget } = this._getSystemPathEnvInfo();
            const result = addHermesDirectoryToSystemPath(executable);
            if (result.alreadyPresent) {
                void vscode.window.showInformationMessage(
                    t('detectEnvironmentSystemAlreadyConfigured', varName, result.pathEntry),
                );
                return;
            }
            const target = result.profileFile || varTarget;
            const message = t('detectEnvironmentSystemConfigured', result.pathEntry, varName, target);
            const restart = t('detectEnvironmentSystemNeedsRestart');
            const choice = await vscode.window.showInformationMessage(message, restart);
            if (choice === restart) {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.log(`System PATH configuration failed: ${msg}`);
            await vscode.window.showErrorMessage(msg);
        }
    }
}
