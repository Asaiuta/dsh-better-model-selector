/**
 * 官方档位表 → dsh 的 reasoningEfforts。
 *
 * 唯一的原则：只抄官方给的范围，一个档都不加。
 * 官方 map 里值为 null 的档位表示「该模型不支持这一档」，必须省略；
 * 例外是 off —— off: null 表示「支持关思考，但不发参数」。
 */

/** pi-ai 的档位升级序。 */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * @param {{reasoning?: boolean, thinkingLevelMap?: Record<string, string|null>|null}} entry
 *   官方目录里的一条模型记录。
 * @returns {Record<string, string|null>|false|undefined}
 *   - 对象：可直接写进 reasoningEfforts
 *   - false：官方认定该模型不提供思考档位（dsh 要求显式 false，而不是只有 off 的字典）
 *   - undefined：目录没给出判断依据，调用方不应改动配置
 */
export function mapToEfforts(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  if (entry.reasoning === false) return false;

  const map = entry.thinkingLevelMap;
  if (!map || typeof map !== 'object') return undefined;
  // 空对象表示目录里没有档位数据，不是「明确不推理」——不能据此写 false。
  if (Object.keys(map).length === 0) return undefined;

  const out = {};
  for (const level of LEVELS) {
    if (!Object.prototype.hasOwnProperty.call(map, level)) continue;
    const wire = map[level];
    if (wire === null) {
      if (level === 'off') out.off = null;
      continue;
    }
    if (typeof wire !== 'string' || wire.length === 0) continue;
    out[level] = wire;
  }

  const thinkingLevels = Object.keys(out).filter((level) => level !== 'off');
  return thinkingLevels.length === 0 ? false : out;
}
