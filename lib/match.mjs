/**
 * 模型 id 归一化与官方目录匹配。
 *
 * 网关上的模型名不是官方 id 是常态：`[free]xxx`、`vendor/xxx`、`xxx-coding`。
 * 这里把噪声剥掉后去官方目录里找，找得到就说明「官方认识这个模型」，
 * 找不到就说明「官方没给过档位范围」，此时宁可不挂档位。
 */
import { LEVELS, resolveLevels, toCatalogMap } from './efforts.mjs';

/** 渠道/标签噪声后缀，按长度降序尝试剥离。 */
const NOISE_SUFFIXES = [
  '-happycoding',
  '-reversed',
  '-coding',
  '-preview',
  '-thinking',
  '-latest',
  '-free',
  '-high',
  '-exp',
  '-次',
];

/** 剥掉 [free] 之类的标签、命名空间、下划线，以及渠道后缀。 */
export function normalizeId(raw) {
  let id = String(raw ?? '').trim().toLowerCase();
  id = id.replace(/^(\[[^\]]*\]\s*)+/, '');
  if (id.includes('/')) id = id.slice(id.lastIndexOf('/') + 1);
  id = id.replace(/_/g, '-');

  let previous;
  do {
    previous = id;
    for (const suffix of NOISE_SUFFIXES) {
      if (id.length > suffix.length && id.endsWith(suffix)) {
        id = id.slice(0, -suffix.length);
        break;
      }
    }
  } while (id !== previous);

  return id;
}

/**
 * 抽出家族与版本，用于官方 id 对不上时的回退。
 * `gpt-6.1-sol` → { family: 'gpt', version: '6.1' }
 * `claude-opus-5-5` → { family: 'claude', version: '5' }
 */
export function familyOf(raw) {
  const id = normalizeId(raw);
  const family = id.match(/^[a-z]+/)?.[0] ?? 'unknown';
  const version = id.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
  return { family, version };
}

/** Map<归一化 id, 官方条目[]> */
export function buildIndex(entries) {
  const index = new Map();
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) continue;
    const key = normalizeId(entry.id);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  }
  return index;
}

/** 条目是否有可用的档位数据（空表等于没数据）。 */
function hasData(entry) {
  if (entry.reasoning === false) return true;
  const map = entry.thinkingLevelMap;
  return Boolean(map) && Object.keys(map).length > 0;
}

/**
 * 同一模型在官方目录里常有多个通道版本，档位范围不一定一致。
 * 取舍顺序：协议一致 > 条目数最多的签名 > 平局取交集 > 交集为空则不给。
 * 绝不选「档位最全」——那等于超出官方范围。
 */
function pick(candidates, api) {
  if (!candidates || candidates.length === 0) return undefined;

  const dataful = candidates.filter(hasData);
  if (dataful.length === 0) return undefined;

  const sameApi = dataful.filter((entry) => entry.api === api);
  const pool = sameApi.length > 0 ? sameApi : dataful;

  const groups = new Map();
  for (const entry of pool) {
    const key = entry.reasoning === false ? '¬reasoning' : signature(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [bestKey, bestGroup] = ranked[0];
  const runnerUp = ranked[1];

  if (!runnerUp || runnerUp[1].length < bestGroup.length) {
    return bestGroup[0];
  }

  // 平局：取所有并列签名的公共档位（同档还必须同发送值），按展开后的口径比。
  const tied = ranked.filter(([, group]) => group.length === bestGroup.length).map(([, group]) => group);
  if (tied.some((group) => group.some((entry) => entry.reasoning === false))) return undefined;

  const tables = tied.map((group) => resolveLevels(group[0].thinkingLevelMap ?? {}));
  const merged = {};
  for (const level of LEVELS) {
    if (!tables.every((table) => Object.prototype.hasOwnProperty.call(table, level))) continue;
    if (new Set(tables.map((table) => table[level])).size !== 1) continue;
    merged[level] = tables[0][level];
  }
  if (Object.keys(merged).length === 0) return undefined;

  return { ...tied[0][0], thinkingLevelMap: toCatalogMap(merged) };
}

/**
 * 档位表签名，用来判断几条记录是否给出同一套范围。
 *
 * 按 pi-ai 展开后的口径算，不按字面：`{ xhigh, max }` 和把 low/medium/high
 * 逐个写出来的那张表是同一个意思，字面签名会把它们拆成两派，投票就投歪了。
 */
function signature(entry) {
  const map = entry.thinkingLevelMap;
  if (!map) return '';
  const table = resolveLevels(map);
  return LEVELS.filter((level) => Object.prototype.hasOwnProperty.call(table, level))
    .map((level) => `${level}=${table[level] ?? ''}`)
    .join('|');
}

/**
 * 家族回退：同族同版本的所有官方条目必须给出一致的档位表才采用；
 * 互相矛盾说明这一族没有统一能力，猜就是错，直接放弃。
 */
function familyConsensus(index, family, version, api) {
  if (!family || version === null) return undefined;
  const groups = new Map();
  for (const [key, entries] of index) {
    const own = familyOf(key);
    if (own.family !== family || own.version !== version) continue;
    for (const entry of entries) {
      const sig = signature(entry);
      if (sig.length === 0) continue;
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(entry);
    }
  }
  if (groups.size === 0) return undefined;

  // 同族多数一致才采用：平局说明这一族没有统一能力，猜就是错。
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [bestSig, bestGroup] = ranked[0];
  const runnerUp = ranked[1];
  if (runnerUp && runnerUp[1].length === bestGroup.length) return undefined;
  if (bestSig.length === 0) return undefined;
  return pick(bestGroup, api);
}

/**
 * @param {string} modelId 网关上的模型 id
 * @param {Map<string, object[]>} index buildIndex 的结果
 * @param {{api?: string}} options 路由协议，用于在同名多条目间取舍
 * @returns {{entry: object, via: 'exact'|'normalized'|'family'}|null}
 */
export function matchModel(modelId, index, options = {}) {
  if (!index || typeof modelId !== 'string') return null;
  const { api } = options;
  const raw = modelId.trim();
  if (raw.length === 0) return null;

  const lower = raw.toLowerCase();
  const exact = pick(index.get(lower), api);
  if (exact) return { entry: exact, via: 'exact' };

  const normalized = normalizeId(raw);
  if (normalized !== lower) {
    const hit = pick(index.get(normalized), api);
    if (hit) return { entry: hit, via: 'normalized' };
  }

  const { family, version } = familyOf(raw);
  const consensus = familyConsensus(index, family, version, api);
  if (consensus) return { entry: consensus, via: 'family' };

  return null;
}
