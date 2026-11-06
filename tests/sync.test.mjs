/**
 * 契约：整体同步流程（匹配 → 决策 → 行级改写 → 统计）。
 *
 * 两种模式：
 *   catalog（默认）  能对上官方条目的模型，一律按官方档位集重写；对不上的原样保留
 *   fill            只在模型没有 reasoningEfforts 时补，已有手写值绝不覆盖
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncEfforts } from '../lib/sync.mjs';

const PATCH = `- id: llm-pi-ai
  config:
    providers:
      ziyong:
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
          - id: kimi-k2.7-code
            name: kimi-k2.7-code
            input: []
          - id: mystery-model
            name: mystery-model
            input: []
`;

const entries = [
  {
    id: 'deepseek-v4-pro-0813',
    api: 'openai-completions',
    provider: 'deepseek',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
  },
  {
    id: 'kimi-k2.7-code',
    api: 'openai-completions',
    provider: 'moonshotai',
    reasoning: true,
    // 除 off 外每档都明写 null：这才是官方说「没档位」。只写 off: null 的意思是「关不掉思考」。
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
  },
];

test('catalog 模式：按官方档位集重写，未匹配的原样保留', () => {
  const result = syncEfforts({ text: PATCH, entries, mode: 'catalog' });
  assert.equal(result.written, false, 'text 入参只计算不落盘');
  assert.match(result.text, /reasoningEfforts:\n              low: low\n              high: high\n              max: max\n/, 'off: null 在官方表里是「关不掉」，不写 off');
  assert.match(result.text, /- id: mystery-model\n {12}name: mystery-model\n {12}input: \[\]\n/);
  assert.equal(result.matched, 2);
  assert.equal(result.unmatched, 1);
  assert.deepEqual(result.unmatchedIds, ['mystery-model']);
});

test('官方说「没档位」时不删已有配置——降级要显式开', () => {
  const kept = syncEfforts({ text: PATCH, entries, mode: 'catalog' });
  assert.equal(
    kept.text.match(/reasoningEfforts: false/g),
    null,
    'kimi 那一行必须保持原样：删掉用户手写的档位是另一个决定',
  );
  assert.deepEqual(kept.noEfforts, ['ziyong/kimi-k2.7-code'], '但要记下来告诉用户');

  const demoted = syncEfforts({ text: PATCH, entries, mode: 'catalog', demote: true });
  assert.match(
    demoted.text,
    /- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}input: \[\]\n {12}reasoningEfforts: false\n/,
  );
});

test('catalog 模式：compat 原样保留', () => {
  const result = syncEfforts({ text: PATCH, entries, mode: 'catalog' });
  assert.match(result.text, /compat:\n {14}supportsReasoningEffort: true/);
});

test('fill 模式：已有档位的模型不动', () => {
  const result = syncEfforts({ text: PATCH, entries, mode: 'fill' });
  assert.match(result.text, /- id: deepseek-v4-pro-0813[\s\S]*?low: low\n {14}medium: medium\n {14}high: high\n {14}max: max\n/);
  assert.equal(result.changed, 0, '没有 reasoningEfforts 的 kimi 在 fill 模式下也不补 false——那是降级');
});

test('第二次运行零改动（幂等）', () => {
  const first = syncEfforts({ text: PATCH, entries, mode: 'catalog' });
  const second = syncEfforts({ text: first.text, entries, mode: 'catalog' });
  assert.equal(second.changed, 0);
  assert.equal(second.text, first.text);
});

test('entries 为空时不做任何写入', () => {
  const result = syncEfforts({ text: PATCH, entries: [], mode: 'catalog' });
  assert.equal(result.changed, 0);
  assert.equal(result.written, false);
  assert.equal(result.text, PATCH);
});

// —— 容量（contextWindow / maxTokens） ——

const CAPACITY_ENTRIES = [
  {
    id: 'deepseek-v4-pro-0813',
    api: 'openai-completions',
    provider: 'deepseek',
    reasoning: true,
    thinkingLevelMap: { off: null, high: 'high', max: 'max' },
    contextWindow: 1000000,
    maxTokens: 384000,
  },
  {
    id: 'kimi-k2.7-code',
    api: 'openai-completions',
    provider: 'moonshotai',
    reasoning: true,
    thinkingLevelMap: { off: null, high: 'high' },
    contextWindow: 262144,
    maxTokens: 65536,
  },
];

test('容量默认 off：不传 capacity 时一个窗口字段都不写', () => {
  const result = syncEfforts({ text: PATCH, entries: CAPACITY_ENTRIES, mode: 'catalog' });
  assert.equal(result.text.match(/contextWindow/g), null);
  assert.equal(result.text.match(/maxTokens/g), null);
  assert.match(result.text, /reasoningEfforts:/, '档位照常对齐');
});

test('capacity fill：没有的补上官方值，已有的一个字不动', () => {
  const withOne = PATCH.replace(
    '          - id: kimi-k2.7-code\n            name: kimi-k2.7-code\n            input: []\n',
    '          - id: kimi-k2.7-code\n            name: kimi-k2.7-code\n            input: []\n            contextWindow: 131072\n',
  );
  const result = syncEfforts({ text: withOne, entries: CAPACITY_ENTRIES, mode: 'catalog', capacity: 'fill' });
  assert.match(result.text, /- id: deepseek-v4-pro-0813[\s\S]*?contextWindow: 1000000\n {12}maxTokens: 384000\n {10}- id: kimi-k2\.7-code/);
  assert.match(result.text, /- id: kimi-k2\.7-code[\s\S]*?contextWindow: 131072\n/);
  assert.equal(result.text.match(/contextWindow: 262144/g), null, '已有的 131072 不能被官方值覆盖');
});

test('capacity catalog：已有值也按官方值重写', () => {
  const withOne = PATCH.replace(
    '          - id: kimi-k2.7-code\n            name: kimi-k2.7-code\n            input: []\n',
    '          - id: kimi-k2.7-code\n            name: kimi-k2.7-code\n            input: []\n            contextWindow: 131072\n',
  );
  const result = syncEfforts({ text: withOne, entries: CAPACITY_ENTRIES, mode: 'catalog', capacity: 'catalog' });
  assert.match(result.text, /- id: kimi-k2\.7-code\n {12}name: kimi-k2\.7-code\n {12}input: \[\]\n {12}contextWindow: 262144\n {12}maxTokens: 65536\n/);
  assert.equal(result.text.match(/131072/g), null);
});

test('capacity off：完全不碰容量字段', () => {
  const result = syncEfforts({ text: PATCH, entries: CAPACITY_ENTRIES, mode: 'catalog', capacity: 'off' });
  assert.equal(result.text.match(/contextWindow/g), null);
  assert.equal(result.text.match(/maxTokens/g), null);
});

test('档位已在 fill 模式下被跳过时，容量仍然补齐', () => {
  const result = syncEfforts({ text: PATCH, entries: CAPACITY_ENTRIES, mode: 'fill', capacity: 'fill' });
  // deepseek 已有档位块 → fill 不动档位，但容量是空的，必须补
  assert.match(result.text, /- id: deepseek-v4-pro-0813[\s\S]*?maxTokens: 384000\n/);
  assert.match(result.text, /- id: deepseek-v4-pro-0813[\s\S]*?low: low\n/, '原有四档模板保持原样');
});

test('容量第二次运行零改动（幂等）', () => {
  const first = syncEfforts({ text: PATCH, entries: CAPACITY_ENTRIES, mode: 'catalog', capacity: 'fill' });
  const second = syncEfforts({ text: first.text, entries: CAPACITY_ENTRIES, mode: 'catalog', capacity: 'fill' });
  assert.equal(second.changed, 0);
  assert.equal(second.text, first.text);
});
