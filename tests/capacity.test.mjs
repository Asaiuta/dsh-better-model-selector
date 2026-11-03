/**
 * 契约：官方 catalog 的容量字段 → dsh 的 contextWindow / maxTokens。
 *
 * 规则：
 *   1. 只抄官方给的正整数，缺一个就只抄另一个
 *   2. 两个都没有 → undefined（不决定，交回调用方）
 *   3. maxTokens 超过 contextWindow 时压到窗口值（官方有 2 条这种记录，网关必拒）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityOf } from '../lib/capacity.mjs';

test('两个数字都抄（deepseek-v4-flash 的真实形态）', () => {
  assert.deepEqual(capacityOf({ contextWindow: 1000000, maxTokens: 384000 }), {
    contextWindow: 1000000,
    maxTokens: 384000,
  });
});

test('只有 contextWindow 时只输出它', () => {
  assert.deepEqual(capacityOf({ contextWindow: 272000 }), { contextWindow: 272000 });
});

test('只有 maxTokens 时只输出它', () => {
  assert.deepEqual(capacityOf({ maxTokens: 128000 }), { maxTokens: 128000 });
});

test('maxTokens 超过窗口时压到窗口（ministral-3b-2512 的真实形态）', () => {
  assert.deepEqual(capacityOf({ contextWindow: 131072, maxTokens: 262144 }), {
    contextWindow: 131072,
    maxTokens: 131072,
  });
});

test('没有容量数据 → undefined，不能凭空写 256K', () => {
  assert.equal(capacityOf({}), undefined);
  assert.equal(capacityOf(null), undefined);
  assert.equal(capacityOf({ reasoning: true, thinkingLevelMap: { high: 'high' } }), undefined);
});

test('非正整数一律忽略（0 / 负数 / 小数 / 字符串）', () => {
  assert.equal(capacityOf({ contextWindow: 0, maxTokens: 0 }), undefined);
  assert.equal(capacityOf({ contextWindow: -1 }), undefined);
  assert.equal(capacityOf({ contextWindow: 1.5 }), undefined);
  assert.equal(capacityOf({ contextWindow: '1000000' }), undefined);
});

test('输出键序固定为 SCALAR_KEYS，便于 diff', () => {
  const out = capacityOf({ maxTokens: 128000, contextWindow: 272000 });
  assert.deepEqual(Object.keys(out), ['contextWindow', 'maxTokens']);
});
