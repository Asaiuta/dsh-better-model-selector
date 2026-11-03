/**
 * 契约：行级改写 cordis.patch.yml 的 models 段。
 *
 * 硬要求（比上游严格）：
 *   - 只碰目标模型的 reasoningEfforts 块，其它字段（compat / input / name / 注释）逐字节保留
 *   - 缩进不符合预期就整体放弃，绝不猜着写
 *   - 同一份输入 + 同一份决策，第二次运行零改动（幂等）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPatch, renderPatch, PatchShapeError } from '../lib/patch.mjs';

const SAMPLE = `# profile patch
- id: agent-default-model
  config:
    provider: ziyong
    model: gpt-6.1-sol
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ziyong:
        displayName: 自用中转网关
        api: openai-completions
        models:
          - id: deepseek-v4-pro-0813
            name: deepseek-v4-pro-0813
            input: []
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high
              max: max
            compat:
              supportsReasoningEffort: true
              chatTemplateKwargs: {}
          - id: kimi-k2.7-code
            name: kimi-k2.7-code
            input: []
      anyrouter1:
        api: openai-responses
        models:
          - id: gpt-6.1-sol
            name: gpt-6.1-sol
`;

test('扫描出两个 provider 与各自的模型条目', () => {
  const scan = scanPatch(SAMPLE);
  assert.deepEqual([...scan.providers.keys()], ['ziyong', 'anyrouter1']);
  assert.deepEqual(scan.providers.get('ziyong').entries.map((e) => e.id), ['deepseek-v4-pro-0813', 'kimi-k2.7-code']);
  assert.deepEqual(scan.providers.get('anyrouter1').entries.map((e) => e.id), ['gpt-6.1-sol']);
});

test('替换已有档位块，compat 与注释逐字节保留', () => {
  const plan = [{ provider: 'ziyong', model: 'deepseek-v4-pro-0813', efforts: { off: null, high: 'high', max: 'max' } }];
  const { text, changes } = renderPatch(SAMPLE, plan);
  assert.equal(changes, 1);
  assert.match(text, /^            reasoningEfforts:\n              'off': null\n              high: high\n              max: max\n            compat:$/m);
  assert.match(text, /^            compat:\n              supportsReasoningEffort: true\n              chatTemplateKwargs: \{\}$/m);
  assert.ok(text.startsWith('# profile patch\n'), '首行注释必须保留');
});

test('没有档位块时插入到模型条目末尾，不越过下一条目', () => {
  const plan = [{ provider: 'ziyong', model: 'kimi-k2.7-code', efforts: { off: null, high: 'high' } }];
  const { text } = renderPatch(SAMPLE, plan);
  const block = text.slice(text.indexOf('          - id: kimi-k2.7-code'));
  assert.match(block, /^ {10}- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}input: \[\]\n {12}reasoningEfforts:\n {14}'off': null\n {14}high: high\n {6}anyrouter1:/m);
});

test('false 决策写成标量 reasoningEfforts: false', () => {
  const plan = [{ provider: 'ziyong', model: 'kimi-k2.7-code', efforts: false }];
  const { text } = renderPatch(SAMPLE, plan);
  assert.match(text, /- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}input: \[\]\n {12}reasoningEfforts: false\n/);
});

test('未列入计划的模型一字不动', () => {
  const plan = [{ provider: 'anyrouter1', model: 'gpt-6.1-sol', efforts: { off: null, low: 'low' } }];
  const { text } = renderPatch(SAMPLE, plan);
  assert.ok(text.includes('          - id: deepseek-v4-pro-0813\n            name: deepseek-v4-pro-0813\n            input: []\n            reasoningEfforts:\n              off: null\n              low: low\n              medium: medium\n              high: high\n              max: max\n'));
});

test('幂等：同样决策第二次运行零改动', () => {
  const plan = [{ provider: 'ziyong', model: 'deepseek-v4-pro-0813', efforts: { off: null, high: 'high', max: 'max' } }];
  const once = renderPatch(SAMPLE, plan).text;
  const twice = renderPatch(once, plan);
  assert.equal(twice.changes, 0);
  assert.equal(twice.text, once);
});

test('重复的模型 id 直接拒绝，避免改错条目', () => {
  const broken = SAMPLE.replace('          - id: kimi-k2.7-code', '          - id: deepseek-v4-pro-0813');
  assert.throws(() => scanPatch(broken), PatchShapeError);
});

test('models 用 flow 风格（models: []）时识别为空并拒绝写入', () => {
  const flow = SAMPLE.replace(/^        models:\n[\s\S]*?(?=      anyrouter1:)/m, '        models: []\n');
  assert.throws(() => renderPatch(flow, [{ provider: 'ziyong', model: 'x', efforts: false }]), PatchShapeError);
});

test('没有 llm-pi-ai 条目时报告结构错误', () => {
  assert.throws(() => scanPatch('- id: unrelated\n  config: {}\n'), PatchShapeError);
});

// —— 容量标量（contextWindow / maxTokens） ——

test('插入 contextWindow / maxTokens 到条目末尾，档位块与其它字段都不动', () => {
  const plan = [{ provider: 'ziyong', model: 'kimi-k2.7-code', scalars: { contextWindow: 1000000, maxTokens: 384000 } }];
  const { text, changes } = renderPatch(SAMPLE, plan);
  assert.equal(changes, 1);
  const block = text.slice(text.indexOf('          - id: kimi-k2.7-code'));
  assert.match(
    block,
    /^ {10}- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}input: \[\]\n {12}contextWindow: 1000000\n {12}maxTokens: 384000\n {6}anyrouter1:/m,
  );
  assert.match(text, /^            reasoningEfforts:\n {14}off: null\n {14}low: low\n {14}medium: medium\n {14}high: high\n {14}max: max$/m);
});

test('已有 contextWindow 行被原地替换，相邻字段与注释保留', () => {
  const withCtx = SAMPLE.replace(
    '          - id: kimi-k2.7-code\n            name: kimi-k2.7-code\n            input: []\n',
    '          - id: kimi-k2.7-code\n            name: kimi-k2.7-code\n            contextWindow: 262144\n            input: []\n',
  );
  const plan = [{ provider: 'ziyong', model: 'kimi-k2.7-code', scalars: { contextWindow: 1000000 } }];
  const { text, changes } = renderPatch(withCtx, plan);
  assert.equal(changes, 1);
  assert.match(text, /- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}contextWindow: 1000000\n {12}input: \[\]\n/);
  assert.equal(text.match(/contextWindow:/g).length, 1, '不能多出一行');
});

test('容量与档位落在同一模型时两处都生效，顺序稳定', () => {
  const plan = [
    { provider: 'ziyong', model: 'kimi-k2.7-code', efforts: { off: null, high: 'high' }, scalars: { contextWindow: 272000 } },
  ];
  const { text, changes } = renderPatch(SAMPLE, plan);
  assert.equal(changes, 1);
  assert.match(
    text,
    /^ {10}- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}input: \[\]\n {12}contextWindow: 272000\n {12}reasoningEfforts:\n {14}'off': null\n {14}high: high\n {6}anyrouter1:/m,
  );
  const once = renderPatch(SAMPLE, plan).text;
  assert.equal(renderPatch(once, plan).changes, 0, '幂等');
});

test('容量值不是正整数时整条忽略，不写半行', () => {
  const plan = [{ provider: 'ziyong', model: 'kimi-k2.7-code', scalars: { contextWindow: 0, maxTokens: 1.5 } }];
  const { text, changes } = renderPatch(SAMPLE, plan);
  assert.equal(changes, 0);
  assert.equal(text, SAMPLE);
});
