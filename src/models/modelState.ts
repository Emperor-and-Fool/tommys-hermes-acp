/**
 * Which model, from where.
 *
 * Everything here was the provider's: the model chip's state, the fallback list when there is
 * no agent, the persisted per-profile choice, and the switch that steps around a running
 * prompt. Moved unchanged. The provider keeps only the four things this cannot own, handed in
 * as `ModelHost`: the agent, the tabs, the profile scope, and the prompt it may have to end.
 *
 * `ModelHost` is a bag of functions rather than a reference to the provider, the same shape as
 * `PromptHost` in chat/session/promptRunner and `DetectionHost` in environment/detection.
 */
import * as vscode from 'vscode';
import { t } from '../i18n';
import { loadProfileState, saveProfileState } from '../chat/profileStorage';
import { resolveModelCatalog } from './acpModelCatalog';
import { buildFallbackModelListState, buildModelListStateFromCatalog, isRuntimeModelSource } from './modelConfig';
import type { ModelListState } from './modelConfig';
import type { AcpClient } from '../acp/AcpClient';
import type { SessionInfo } from '../types/chat';

/** What the host supplies: the provider concerns this module cannot own. */
export interface ModelHost {
    acp(): AcpClient | undefined;
    tabs(): SessionInfo[];
    sessionId(): string;
    /** The one write point for the tab index; the provider swallows its failure. */
    saveCatalog(): boolean;
    /** Read fresh on every call: the scope changes when the profile does. */
    profileScope(): { historyDir: string; scopeKey: string };
    post(msg: unknown): void;
    log(line: string): void;
    otherSessionIsPrompting(): boolean;
    /** End the prompt running in another tab, keeping what it had written. */
    detachOtherPrompt(): Promise<void>;
    setBoundSessionId(id: string): void;
}

export class ModelState {
    private _modelState: ModelListState | null = null;
    private _modelFallbackShown: boolean = false;
    private _modelSwitchInFlight: Promise<void> | undefined;

    constructor(private _host: ModelHost) {}

    /** What the chip shows, for the session export header. */
    get currentLabel(): string | undefined {
        return this._modelState?.currentLabel;
    }

    /** True when the live state came from the agent rather than the settings fallback. */
    isRuntimeSource(): boolean {
        return !!this._modelState && isRuntimeModelSource(this._modelState.configId);
    }

    /** Forget the state; the next sync rebuilds it from the agent or the fallback. */
    reset(): void {
        this._modelState = null;
    }

    /** Wait for a switch already on the wire, so a send cannot race it. */
    async awaitSwitch(): Promise<void> {
        if (this._modelSwitchInFlight) {
            await this._modelSwitchInFlight;
        }
    }

    private _profileState(): { modelId?: string; modelLabel?: string } {
        const { historyDir, scopeKey } = this._host.profileScope();
        return loadProfileState(historyDir, scopeKey);
    }

    private _saveProfileState(state: { modelId?: string; modelLabel?: string }): void {
        const { historyDir, scopeKey } = this._host.profileScope();
        saveProfileState(historyDir, scopeKey, state);
    }

    async sync(options?: { skipModelOptions?: boolean }): Promise<void> {
        if (!this._host.acp()) {
            this._modelState = this._buildFallbackModelList();
            this.postList();
            return;
        }

        const agentState = this._host.acp()!.getModelListState();
        const hermesModelsRaw = this._host.acp()!.getHermesModelsRaw();
        let modelOptions = options?.skipModelOptions
            ? null
            : await this._host.acp()!.fetchModelOptions();
        if (!modelOptions?.providers?.length) {
            modelOptions = this._host.acp()!.getCachedModelOptions();
        }
        const catalog = resolveModelCatalog(modelOptions, hermesModelsRaw);
        const profileState = this._profileState();
        const session = this._host.tabs().find(s => s.id === this._host.sessionId());
        const config = vscode.workspace.getConfiguration('tommys');
        const settingsModels = config.get<Array<{ id: string; name: string }>>('models') || [];

        if (catalog?.groups.length) {
            this._modelState = buildModelListStateFromCatalog(catalog, agentState, {
                modelId: session?.modelId || profileState.modelId,
                modelLabel: session?.modelLabel || profileState.modelLabel,
                settingsModels,
            });
        } else if (agentState) {
            this._modelState = agentState;
        } else {
            this._modelState = this._buildFallbackModelList();
        }
        this.postList();
    }

    private _buildFallbackModelList(): ModelListState | null {
        const config = vscode.workspace.getConfiguration('tommys');
        const models = config.get<Array<{ id: string; name: string }>>('models') || [];
        const defaultModel = config.get<string>('defaultModel') || '';
        const session = this._host.tabs().find(s => s.id === this._host.sessionId());
        const profileState = this._profileState();
        const currentId = session?.modelId || profileState.modelId || defaultModel;
        return buildFallbackModelListState(models, currentId);
    }

    postList(): void {
        const state = this._modelState ?? this._buildFallbackModelList();
        if (state) {
            this._host.post({
                type: 'modelList',
                configId: state.configId,
                currentValueId: state.currentValueId,
                currentLabel: state.currentLabel,
                models: state.models,
                groups: state.groups,
                fromAgent: state.fromAgent,
            });
        } else {
            const session = this._host.tabs().find(s => s.id === this._host.sessionId());
            const profileState = this._profileState();
            this._host.post({
                type: 'modelList',
                configId: '',
                currentValueId: session?.modelId || profileState.modelId || '',
                currentLabel: session?.modelLabel || profileState.modelLabel || '—',
                models: [],
                groups: [],
                fromAgent: false,
            });
        }
    }

    private _persistModelChoice(valueId: string, label: string): void {
        const session = this._host.tabs().find(s => s.id === this._host.sessionId());
        if (session) {
            session.modelId = valueId;
            session.modelLabel = label;
            try {
                this._host.saveCatalog();
            } catch { /* ignore */ }
        }
        this._saveProfileState({ modelId: valueId, modelLabel: label });
    }

    private async _resetAgentWithModel(valueId: string, configId?: string): Promise<void> {
        if (!this._host.acp() || !valueId) {
            return;
        }
        if (!this._host.acp()!.activeSessionId) {
            // Blank tab: nothing to switch yet. The choice is persisted already and
            // applySessionPreference() applies it when the first message creates one.
            this._host.log('Model choice saved; no live session to switch yet');
            return;
        }
        const state = this._modelState ?? this._host.acp()!.getModelListState();
        const effectiveConfigId = configId || state?.configId || '';
        if (!state || !isRuntimeModelSource(effectiveConfigId)) {
            await this.sync();
            return;
        }
        await this._host.acp()!.setModel(effectiveConfigId, valueId);
        const runtimeId = this._host.acp()!.getRuntimeModelId();
        if (runtimeId !== valueId) {
            this._host.log(`Model apply incomplete: runtime=${runtimeId || '(none)'} expected=${valueId}`);
            this._host.post({
                type: 'addMessage',
                role: 'assistant',
                text: t('modelSwitchIncomplete', valueId),
            });
        }
        await this.sync();
    }

    async applySessionPreference(options?: { forceReset?: boolean }): Promise<void> {
        const forceReset = options?.forceReset ?? false;
        const { modelId: preferredId, modelLabel: preferredLabel } = this._resolveSessionModelId();
        if (!preferredId || !this._host.acp()) {
            return;
        }
        const state = this._modelState ?? this._host.acp()!.getModelListState();
        if (!state || !isRuntimeModelSource(state.configId)) {
            return;
        }
        const runtimeId = this._host.acp()!.getRuntimeModelId();
        if (!forceReset && preferredId === runtimeId) {
            return;
        }
        const known = state.models.some(m => m.valueId === preferredId);
        if (!known) {
            const label = preferredLabel || preferredId;
            this._host.log(`Saved model not available: ${label}`);
            vscode.window.showWarningMessage(t('savedModelUnavailable', label));
            return;
        }
        try {
            this._host.log(`Apply session model: ${preferredLabel || preferredId}${forceReset ? ' (reset agent)' : ''}`);
            await this._resetAgentWithModel(preferredId, state.configId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._host.log(`Restore model failed: ${msg}`);
        }
    }

    async switchModel(configId: string, valueId: string): Promise<void> {
        const op = this._switchModel(configId, valueId);
        this._modelSwitchInFlight = op;
        try {
            await op;
        } finally {
            if (this._modelSwitchInFlight === op) {
                this._modelSwitchInFlight = undefined;
            }
        }
    }

    private async _switchModel(configId: string, valueId: string): Promise<void> {
        const state = this._modelState ?? this._buildFallbackModelList();
        const effectiveConfigId = configId || state?.configId || '';
        const picked = state?.models.find(m => m.valueId === valueId);
        const label = picked?.name ?? valueId;
        this._host.log(`Switch model: ${label} (config=${effectiveConfigId})`);

        if (this._host.acp()! && valueId) {
            if (this._host.acp()!.status === 'prompting') {
                vscode.window.showWarningMessage(t('waitForResponse'));
                return;
            }
            this._persistModelChoice(valueId, label);
            try {
                if (this._host.otherSessionIsPrompting()) {
                    await this._host.detachOtherPrompt();
                }
                await this._resetAgentWithModel(valueId, effectiveConfigId);
                this._host.setBoundSessionId(this._host.sessionId());
                this._host.log(`Model active: ${label}`);
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._host.log(`setModel failed: ${msg}`);
                vscode.window.showErrorMessage(t('failedSwitchModel', msg));
                return;
            }
        }

        if (!state || !isRuntimeModelSource(effectiveConfigId)) {
            this._persistModelChoice(valueId, label);
            if (state) {
                this._modelState = { ...state, currentValueId: valueId, currentLabel: label };
            }
            this.postList();
            if (!this._modelFallbackShown) {
                this._modelFallbackShown = true;
                vscode.window.showInformationMessage(t('modelPreferenceSaved'));
            }
            return;
        }

        vscode.window.showWarningMessage(t('hermesNotConnected'));
    }

    snapshotFromProfile(sessionId?: string): void {
        const sid = sessionId || this._host.sessionId();
        const session = this._host.tabs().find(s => s.id === sid);
        if (!session || session.modelId) {
            return;
        }
        const profileState = this._profileState();
        if (!profileState.modelId) {
            return;
        }
        session.modelId = profileState.modelId;
        session.modelLabel = profileState.modelLabel;
        try {
            this._host.saveCatalog();
        } catch { /* ignore */ }
    }

    private _resolveSessionModelId(sessionId?: string): { modelId?: string; modelLabel?: string } {
        const sid = sessionId || this._host.sessionId();
        const session = this._host.tabs().find(s => s.id === sid);
        if (session?.modelId) {
            return { modelId: session.modelId, modelLabel: session.modelLabel };
        }
        const profileState = this._profileState();
        return { modelId: profileState.modelId, modelLabel: profileState.modelLabel };
    }
}
