import { describe, it } from 'mocha';
import assert from 'assert';
import {
    DETECT_STEP_IDS,
    detectStepLabel,
    formatDetectStepDetail,
} from '../../shared/detectProgress';
import type { DetectProgressFields } from '../../shared/detectProgress';
import { en } from '../../host/i18n/locales/en';
import { zhCn } from '../../host/i18n/locales/zh-cn';
import { formatLocaleString } from '../../host/i18n/format';

/** The pane's pair: `locale[key] || ''` and the placeholder filler the webview helper injects. */
const lookupOf = (strings: typeof en) => (key: string) =>
    (strings as unknown as Record<string, string>)[key] || '';
const fillOf = (strings: typeof en) => (key: string, ...args: (string | number)[]) =>
    formatLocaleString(lookupOf(strings)(key), ...args);

const fields = (over: Partial<DetectProgressFields>): DetectProgressFields =>
    ({ step: 'config', status: 'ok', ...over });

const LABELS: [string, string, string][] = [
    ['config', 'L0 · Extension setting (tommys.path)', 'L0 · 插件配置 (tommys.path)'],
    ['path_lookup', 'L1 · PATH lookup (where / command -v)', 'L1 · PATH 查找 (where / command -v)'],
    ['known_path', 'L2 · Known install paths', 'L2 · 已知安装路径'],
    ['pip', 'L3 · pip install (pip show hermes-agent)', 'L3 · pip 安装 (pip show hermes-agent)'],
    ['python_import', 'L4 · Python package (import hermes_cli)', 'L4 · Python 包 (import hermes_cli)'],
    ['hermes_home', 'L5 · HERMES_HOME directory', 'L5 · HERMES_HOME 目录'],
    ['verify', 'V1 · Run hermes --version', 'V1 · 运行 hermes --version 验证'],
    ['acp_check', 'ACP · Run hermes acp --check', 'ACP · 运行 hermes acp --check'],
    ['acp_install', 'ACP · Install agent-client-protocol', 'ACP · 安装 agent-client-protocol'],
    ['summary', 'Detection complete', '检测完成'],
];

const DETAILS: [string, DetectProgressFields, string, string][] = [
    ['running', fields({ status: 'running' }), '…', '…'],
    ['skip', fields({ status: 'skip' }), 'Skipped', '已跳过'],
    ['verify counts', fields({ step: 'verify', verifiedCount: 3, totalCount: 10 }), 'Verified 3/10', '已验证 3/10'],
    ['verify without counts', fields({ step: 'verify' }), 'Verified 0/0', '已验证 0/0'],
    ['acp_check ok', fields({ step: 'acp_check' }), 'Hermes ACP check OK', 'Hermes ACP check OK'],
    ['acp_check ok with detail', fields({ step: 'acp_check', detail: 'probe output' }), 'probe output', 'probe output'],
    ['acp_check fail', fields({ step: 'acp_check', status: 'fail' }), 'ACP unavailable', 'ACP 不可用'],
    ['acp_install ok', fields({ step: 'acp_install' }), 'ACP dependency installed', 'ACP 依赖安装成功'],
    ['acp_install fail', fields({ step: 'acp_install', status: 'fail' }), 'ACP dependency install failed', 'ACP 依赖安装失败'],
    ['summary with detail', fields({ step: 'summary', detail: 'ready to go' }), 'ready to go', 'ready to go'],
    ['summary ready', fields({ step: 'summary', reportStatus: 'ready' }), 'Hermes environment is ready.', 'Hermes 环境已就绪，可正常使用。'],
    [
        'summary broken',
        fields({ step: 'summary', reportStatus: 'broken' }),
        'Hermes files were found but could not run. Try reinstalling Hermes Agent.',
        '找到 Hermes 文件但无法运行，请重新安装 Hermes Agent。',
    ],
    [
        'summary not ready and not broken',
        fields({ step: 'summary', reportStatus: 'not_found' }),
        'Hermes not found. Please install Hermes Agent first.',
        '未检测到 Hermes，请先安装 Hermes Agent。',
    ],
    ['found count', fields({ count: 2 }), 'Found 2', '找到 2 个'],
    ['found count with detail', fields({ count: 2, detail: 'more' }), 'Found 2\nmore', '找到 2 个\nmore'],
    ['fail with detail', fields({ status: 'fail', detail: 'boom' }), 'boom', 'boom'],
    ['nothing to say', fields({}), 'Not found', '未找到'],
];

describe('detectProgress', () => {
    it('exposes the step order the panel builds its rows from', () => {
        assert.deepStrictEqual(DETECT_STEP_IDS, LABELS.map(([id]) => id));
    });

    it('labels every step in both locales', () => {
        for (const [step, english, chinese] of LABELS) {
            assert.strictEqual(detectStepLabel(step, lookupOf(en)), english, `en ${step}`);
            assert.strictEqual(detectStepLabel(step, lookupOf(zhCn)), chinese, `zh-cn ${step}`);
        }
    });

    it('asks the lookup for the step key, and falls back to the raw id', () => {
        const asked: string[] = [];
        const label = detectStepLabel('verify', (key) => {
            asked.push(key);
            return 'V';
        });
        assert.deepStrictEqual(asked, ['detectEnvironmentStepVerify']);
        assert.strictEqual(label, 'V');
        assert.strictEqual(detectStepLabel('a_step_from_the_future', lookupOf(en)), 'a_step_from_the_future');
    });

    it('renders every status in both locales', () => {
        for (const [name, event, english, chinese] of DETAILS) {
            assert.strictEqual(formatDetectStepDetail(event, lookupOf(en), fillOf(en)), english, `en ${name}`);
            assert.strictEqual(formatDetectStepDetail(event, lookupOf(zhCn), fillOf(zhCn)), chinese, `zh-cn ${name}`);
        }
    });

    it('keeps its English fallbacks when the locale has nothing to say', () => {
        const empty = () => '';
        assert.strictEqual(formatDetectStepDetail(fields({ status: 'skip' }), empty, empty), 'Skipped');
        assert.strictEqual(formatDetectStepDetail(fields({}), empty, empty), 'Not found');
        assert.strictEqual(formatDetectStepDetail(fields({ step: 'summary', reportStatus: 'ready' }), empty, empty), '');
    });
});
