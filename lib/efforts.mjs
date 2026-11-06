/**
 * 官方档位表 → dsh 的 reasoningEfforts。
 *
 * 唯一的原则：只抄官方给的范围，一个档都不加。
 *
 * 难点在于两边对「没写」的解释正好相反：
 *
 *   官方 thinkingLevelMap（pi-ai）   没写的 off / minimal / low / medium / high → **支持**，原样发档名
 *                                    没写的 xhigh / max → 不支持
 *                                    写 null → 不支持（off 也一样：off: null 是「关不掉思考」）
 *   dsh reasoningEfforts            白名单：没写的一律不支持；只有 off 可以写 null，表示「支持、不发参数」
 *
 * 所以官方的 `{ xhigh, max }`（Claude 的真实形态）意思是「全部基础档 + xhigh + max」，
 * 不能照字面抄成两档——这里先按 pi-ai 的规则展开成每档确定的发送值，再写成白名单。
 * 依据：pi-ai `getSupportedThinkingLevels`，以及 dsh `resolveModelReasoning` 的注释。
 */

/** pi-ai 的档位升级序。 */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * 没写时按「支持」展开、且发送值就是档名的那几档。
 *
 * minimal 不在里面：它没写时各协议发的值不一样（Anthropic / GPT 发 low，
 * 其它协议发 minimal），而白名单只能写一个值，写哪个都会在另一类网关上发错。
 * 宁可少一档，也不发一个可能被拒的参数。
 */
const IMPLIED = ['low', 'medium', 'high'];

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * 官方 map 按 pi-ai 的缺省规则展开。
 * @param {Record<string, string|null>} map 官方 thinkingLevelMap
 * @returns {Record<string, string|null>} 支持的档 → 发送值；off 支持但不发参数时为 null；不支持的档不出现
 */
export function resolveLevels(map) {
  const out = {};
  for (const level of LEVELS) {
    const wire = own(map, level) ? map[level] : undefined;
    if (typeof wire === 'string') {
      if (wire.length > 0) out[level] = wire;
      continue;
    }
    if (wire !== undefined) continue;
    if (level === 'off') out.off = null;
    else if (IMPLIED.includes(level)) out[level] = level;
  }
  return out;
}

/**
 * resolveLevels 的逆：把展开后的档位写回一张每档都明确的官方 map。
 * 合并多条官方记录（取交集）之后要交还给 mapToEfforts，所以必须能往返。
 */
export function toCatalogMap(levels) {
  const map = {};
  for (const level of LEVELS) {
    if (!own(levels, level)) map[level] = null;
    // off 支持但不发参数：官方 map 的写法就是「不写这个键」。
    else if (levels[level] !== null) map[level] = levels[level];
  }
  return map;
}

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

  const out = resolveLevels(map);
  const thinkingLevels = Object.keys(out).filter((level) => level !== 'off');
  return thinkingLevels.length === 0 ? false : out;
}
