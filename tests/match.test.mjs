/**
 * 契约：模型 id 归一化与目录匹配。
 *
 * 目标：网关上的模型名往往不是官方 id（带命名空间、免费标签、渠道后缀），
 * 但只要能识别出是哪个家族/版本，就按官方那条的档位表给档位；
 * 识别不出来就不给（宁缺毋滥，避免给不支持的模型发 reasoning_effort）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeId, familyOf, buildIndex, matchModel } from '../lib/match.mjs';

const entry = (id, map, api = 'openai-completions', extra = {}) => ({
  id,
  api,
  provider: extra.provider ?? 'test',
  reasoning: extra.reasoning ?? true,
  thinkingLevelMap: map,
  compat: extra.compat ?? null,
});

test('归一化：剥命名空间、剥 [free] 标签、统一大小写与下划线', () => {
  assert.equal(normalizeId('deepseek/deepseek-v4-pro-0813'), 'deepseek-v4-pro-0813');
  assert.equal(normalizeId('[free]deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
  assert.equal(normalizeId('MiniMax-M3'), 'minimax-m3');
  assert.equal(normalizeId('z-ai/glm-5.3-flash'), 'glm-5.3-flash');
  assert.equal(normalizeId('moonshotai/kimi_k3'), 'kimi-k3');
});

test('归一化：剥渠道后缀（-coding / -free / -high / -次），但不剥模型自身的词', () => {
  assert.equal(normalizeId('deepseek-v4.1-flash-coding'), 'deepseek-v4.1-flash');
  assert.equal(normalizeId('deepseek-v4.1-flash-free'), 'deepseek-v4.1-flash');
  assert.equal(normalizeId('gemini-3.8-flash-high'), 'gemini-3.8-flash');
  assert.equal(normalizeId('deepseek-v4.1-flash-次'), 'deepseek-v4.1-flash');
  assert.equal(normalizeId('kimi-k2.7-code'), 'kimi-k2.7-code');
  assert.equal(normalizeId('gpt-6.1-sol'), 'gpt-6.1-sol');
});

test('familyOf 抽家族与版本，忽略渠道噪声', () => {
  assert.deepEqual(familyOf('gpt-6.1-sol'), { family: 'gpt', version: '6.1' });
  assert.deepEqual(familyOf('deepseek-v4-pro-0813'), { family: 'deepseek', version: '4' });
  assert.deepEqual(familyOf('glm-5.3-flash'), { family: 'glm', version: '5.3' });
  assert.deepEqual(familyOf('claude-opus-5-5'), { family: 'claude', version: '5' });
  assert.deepEqual(familyOf('unknown-model'), { family: 'unknown', version: null });
});

test('精确命中优先，返回 exact', () => {
  const index = buildIndex([entry('gpt-6.1-sol', { off: null, high: 'high', max: 'max' })]);
  const hit = matchModel('gpt-6.1-sol', index, { api: 'openai-completions' });
  assert.equal(hit.via, 'exact');
  assert.equal(hit.entry.id, 'gpt-6.1-sol');
});

test('带命名空间与标签的 id 归一化后命中，返回 normalized', () => {
  const index = buildIndex([entry('deepseek-v4-pro-0813', { high: 'high', max: 'max' })]);
  const hit = matchModel('deepseek/deepseek-v4-pro-0813', index, { api: 'openai-completions' });
  assert.equal(hit.via, 'normalized');
  assert.equal(hit.entry.id, 'deepseek-v4-pro-0813');
});

test('同名多条目录条目时，优先与路由协议一致的那条', () => {
  const index = buildIndex([
    entry('gpt-6.1-sol', { off: null, xhigh: 'xhigh' }, 'bedrock-converse-stream'),
    entry('gpt-6.1-sol', { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, 'openai-responses'),
  ]);
  const hit = matchModel('gpt-6.1-sol', index, { api: 'openai-responses' });
  assert.equal(hit.entry.api, 'openai-responses');
  assert.equal(Object.keys(hit.entry.thinkingLevelMap).length, 6);
});

test('协议对不上且两种签名票数相同，取交集而不是取最全', () => {
  const index = buildIndex([
    entry('gpt-6.1-sol', { off: null, xhigh: 'xhigh' }, 'bedrock-converse-stream'),
    entry('gpt-6.1-sol', { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, 'openai-responses'),
  ]);
  const hit = matchModel('gpt-6.1-sol', index, { api: 'openai-completions' });
  assert.deepEqual(hit.entry.thinkingLevelMap, { off: null, xhigh: 'xhigh' });
});

test('同 id 多条目票数不等时取票数最多的签名（deepseek-v4-pro 的真实形态）', () => {
  const majority = { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' };
  const azure = { minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null };
  const index = buildIndex([
    entry('deepseek-v4-pro', azure, 'openai-completions'),
    entry('deepseek-v4-pro', majority, 'openai-completions'),
    entry('deepseek-v4-pro', majority, 'openai-completions'),
    entry('deepseek-v4-pro', majority, 'openai-completions'),
  ]);
  const hit = matchModel('deepseek-v4-pro', index, { api: 'openai-completions' });
  assert.deepEqual(hit.entry.thinkingLevelMap, majority);
});

test('没有任何档位数据的条目不算命中，避免写出空字典', () => {
  const index = buildIndex([entry('minimax-m3', null, 'openai-completions')]);
  assert.equal(matchModel('MiniMax-M3', index, { api: 'openai-completions' }), null);
});

test('家族回退：同族条目档位一致时才采用', () => {
  const index = buildIndex([
    entry('doubao-seed-2-0-pro', { off: null, low: 'low', high: 'high' }),
    entry('doubao-seed-2-0-turbo', { off: null, low: 'low', high: 'high' }),
  ]);
  const hit = matchModel('doubao-seed-2-1-pro', index, { api: 'openai-completions' });
  assert.equal(hit.via, 'family');
});

test('家族回退：同族条目档位互相矛盾时不猜，返回 null', () => {
  const index = buildIndex([
    entry('qwen3-max', { off: null, low: 'low', high: 'high' }),
    entry('qwen3-turbo', { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }),
  ]);
  assert.equal(matchModel('qwen3-unknown', index, { api: 'openai-completions' }), null);
});

test('完全不认识的模型不给档位', () => {
  const index = buildIndex([entry('gpt-6.1-sol', { off: null, high: 'high' })]);
  assert.equal(matchModel('some-unknown-gateway-model', index, { api: 'openai-completions' }), null);
});

test('catalog 明说非推理的模型也能命中（用于写 false，而不是挂档）', () => {
  const index = buildIndex([entry('kimi-k2.7-code', { off: null }, 'openai-completions', { reasoning: true })]);
  const hit = matchModel('kimi-k2.7-code', index, { api: 'openai-completions' });
  assert.equal(hit.entry.id, 'kimi-k2.7-code');
});
