/**
 * 官方 catalog → dsh 的 contextWindow / maxTokens。
 *
 * 只抄官方给的两个容量数字，不做倍率推断。dsh 的缺省是 256K / 32K：
 * 官方窗口比它小的模型会被高估（网关直接 400），比它大的则白白浪费
 * ——deepseek-v4 系官方 1M，配置里不写就按 256K 跑。
 */
import { SCALAR_KEYS } from './patch.mjs';

/**
 * @param {{contextWindow?: number, maxTokens?: number}} entry 官方目录的一条记录
 * @returns {{contextWindow?: number, maxTokens?: number}|undefined}
 *   - 对象：可直接写进模型条目
 *   - undefined：官方没给容量数据，调用方不应改动配置
 */
export function capacityOf(entry) {
  if (!entry || typeof entry !== 'object') return undefined;

  const out = {};
  for (const key of SCALAR_KEYS) {
    const raw = entry[key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) continue;
    out[key] = raw;
  }
  if (Object.keys(out).length === 0) return undefined;

  // 官方有 2 条记录给出 maxTokens > contextWindow（minstral-3b / Inkling-Small），
  // 这种组合网关一定拒绝，压到窗口值。
  if (out.contextWindow !== undefined && out.maxTokens > out.contextWindow) {
    out.maxTokens = out.contextWindow;
  }
  return out;
}
