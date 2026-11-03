/**
 * 契约：官方 catalog 的 thinkingLevelMap → dsh 的 reasoningEfforts。
 *
 * 规则只有三条：
 *   1. map 里值为 null 且不是 off → 该档官方不给，省略（dsh 会把缺省档 pin 成不支持）
 *   2. map 里值为 null 且是 off     → off 支持但不发参数，写 null
 *   3. 除 off 外没有任何档           → 写 false（dsh 拒绝「只有 off」的字典）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapToEfforts, LEVELS } from '../lib/efforts.mjs';

test('七档全开：minimal 为 null 时被省略，其余照抄官方 wire 值', () => {
  const map = {
    off: null,
    minimal: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  };
  assert.deepEqual(mapToEfforts({ reasoning: true, thinkingLevelMap: map }), {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  });
});

test('只有 high / max 的模型只拿到两档（deepseek-v4-pro-0813 的真实形态）', () => {
  const map = { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' };
  assert.deepEqual(mapToEfforts({ reasoning: true, thinkingLevelMap: map }), {
    off: null,
    high: 'high',
    max: 'max',
  });
});

test('off 带 wire 值时保留该值（openrouter 系用 off: none）', () => {
  const map = { off: 'none', low: 'low', high: 'high' };
  assert.deepEqual(mapToEfforts({ reasoning: true, thinkingLevelMap: map }), {
    off: 'none',
    low: 'low',
    high: 'high',
  });
});

test('只有 off 一档 → false，避免 dsh 拒绝「没有 off 以外档位」的字典', () => {
  assert.equal(mapToEfforts({ reasoning: true, thinkingLevelMap: { off: null } }), false);
});

test('catalog 明说非推理 → false', () => {
  assert.equal(mapToEfforts({ reasoning: false }), false);
});

test('没有档位表也没有 reasoning 标记 → undefined（不决定，交回调用方）', () => {
  assert.equal(mapToEfforts({}), undefined);
  assert.equal(mapToEfforts({ reasoning: true }), undefined);
});

test('空档位表 { } 等于没有数据，不能据此写 false', () => {
  assert.equal(mapToEfforts({ reasoning: true, thinkingLevelMap: {} }), undefined);
});

test('输出顺序固定为档位升级序，不受输入键序影响', () => {
  const out = mapToEfforts({
    reasoning: true,
    thinkingLevelMap: { max: 'max', low: 'low', off: null, high: 'high' },
  });
  assert.deepEqual(Object.keys(out), ['off', 'low', 'high', 'max']);
  assert.deepEqual(LEVELS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
});

test('wire 值与档位名不同的模型照抄官方值（如 max → ultra）', () => {
  const map = { off: null, high: 'high', max: 'ultra' };
  assert.deepEqual(mapToEfforts({ reasoning: true, thinkingLevelMap: map }), {
    off: null,
    high: 'high',
    max: 'ultra',
  });
});
