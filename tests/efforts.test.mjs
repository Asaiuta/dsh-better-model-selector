/**
 * 契约：官方 catalog 的 thinkingLevelMap → dsh 的 reasoningEfforts。
 *
 * 两边对「没写」的解释相反，规则全在这里锚住：
 *   1. 官方没写的 low / medium / high → 支持，发档名本身（pi-ai 的缺省）
 *   2. 官方没写的 off → 支持、不发参数 → 写 off: null
 *   3. 官方没写的 xhigh / max → 不支持；官方写 null 的任何档（含 off）→ 不支持
 *   4. 官方没写的 minimal → 不补：各协议的缺省发送值不一致
 *   5. 除 off 外一档都没有 → 写 false（dsh 拒绝「只有 off」的字典）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapToEfforts, resolveLevels, toCatalogMap, LEVELS } from '../lib/efforts.mjs';

const efforts = (map) => mapToEfforts({ reasoning: true, thinkingLevelMap: map });

test('Claude 的真实形态 { xhigh, max }：基础三档按缺省补齐，不是只有两档', () => {
  // claude-opus-5-5 在 cloudflare / opencode 的记录；dsh 自己会给出 off + low…max。
  assert.deepEqual(efforts({ xhigh: 'xhigh', max: 'max' }), {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  });
});

test('off: null 是「关不掉思考」：off 不写，基础档照样有（Fable 的真实形态）', () => {
  assert.deepEqual(efforts({ off: null, xhigh: 'xhigh', max: 'max' }), {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  });
  // gpt-5 系：只写了 off: null，意思是不能关、其余基础档都在——不是「没有档位」。
  assert.deepEqual(efforts({ off: null }), { low: 'low', medium: 'medium', high: 'high' });
});

test('七档全写明：null 的档省略，其余照抄官方 wire 值', () => {
  const map = { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
  assert.deepEqual(efforts(map), { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' });
});

test('只有 high / max 的模型只拿到两档（deepseek-v4-pro-0813 的真实形态）', () => {
  const map = { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' };
  assert.deepEqual(efforts(map), { high: 'high', max: 'max' });
});

test('off 带 wire 值时保留该值（openrouter 系用 off: none），没写的 medium 照缺省补', () => {
  assert.deepEqual(efforts({ off: 'none', low: 'low', high: 'high' }), {
    off: 'none',
    low: 'low',
    medium: 'medium',
    high: 'high',
  });
});

test('minimal 没写不补，写了就照抄（github-copilot 的 minimal → low）', () => {
  assert.equal('minimal' in efforts({ xhigh: 'xhigh' }), false, '缺省发送值因协议而异，宁可少一档');
  assert.equal(efforts({ minimal: 'low', xhigh: 'xhigh' }).minimal, 'low');
});

test('除 off 外全部写 null → false', () => {
  assert.equal(efforts({ minimal: null, low: null, medium: null, high: null }), false);
  assert.equal(efforts({ off: 'none', minimal: null, low: null, medium: null, high: null }), false);
});

test('catalog 明说非推理 → false', () => {
  assert.equal(mapToEfforts({ reasoning: false }), false);
});

test('没有档位表也没有 reasoning 标记 → undefined（不决定，交回调用方）', () => {
  assert.equal(mapToEfforts({}), undefined);
  assert.equal(mapToEfforts({ reasoning: true }), undefined);
});

test('空档位表 { } 等于没有数据，不能据此写 false', () => {
  assert.equal(efforts({}), undefined);
});

test('输出顺序固定为档位升级序，不受输入键序影响', () => {
  const out = efforts({ max: 'max', low: 'low', off: null, high: 'high' });
  assert.deepEqual(Object.keys(out), ['low', 'medium', 'high', 'max']);
  assert.deepEqual(LEVELS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
});

test('wire 值与档位名不同的模型照抄官方值（如 max → ultra）', () => {
  assert.deepEqual(efforts({ off: null, high: 'high', max: 'ultra' }), {
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'ultra',
  });
});

test('toCatalogMap 是 resolveLevels 的逆：展开 → 写回 → 再展开不变', () => {
  const samples = [
    { xhigh: 'xhigh', max: 'max' },
    { off: null, xhigh: 'xhigh', max: 'max' },
    { off: 'none', minimal: 'low', low: null, high: 'high' },
    { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' },
  ];
  for (const map of samples) {
    const table = resolveLevels(map);
    assert.deepEqual(resolveLevels(toCatalogMap(table)), table, JSON.stringify(map));
  }
  assert.equal('off' in toCatalogMap({ off: null, high: 'high' }), false, 'off 支持但不发参数 = 官方 map 里不写这个键');
  assert.equal(toCatalogMap({ high: 'high' }).off, null, 'off 不支持 = 写 null');
});
