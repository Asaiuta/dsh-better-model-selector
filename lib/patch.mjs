/**
 * 行级改写 cordis.patch.yml：只动目标模型的 reasoningEfforts / contextWindow / maxTokens。
 *
 * 之所以不整段重写 models，是因为上游那种做法会把 compat / input / 注释一起丢掉 ——
 * ziyong 每个模型都靠 compat.supportsReasoningEffort 才真的把档位发出去，
 * 丢一次就等于所有档位静默失效。这里保持逐字节不动，只在需要的位置插入或替换。
 */

export class PatchShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatchShapeError';
  }
}

/** 允许行级改写的标量字段（单行 key: value）。 */
export const SCALAR_KEYS = ['contextWindow', 'maxTokens'];

const indentOf = (line) => line.length - line.trimStart().length;
const isSkippable = (line) => {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
};

/** 剥掉 YAML 标量外层引号。 */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 从 from 起，找到第一条缩进 <= maxIndent 的实质行；没有则返回 limit。 */
function nextAtOrAbove(lines, from, maxIndent, limit = lines.length) {
  for (let i = from; i < Math.min(limit, lines.length); i += 1) {
    if (isSkippable(lines[i])) continue;
    if (indentOf(lines[i]) <= maxIndent) return i;
  }
  return Math.min(limit, lines.length);
}

/**
 * @param {string} text patch 原文
 * @returns {{
 *   eol: string,
 *   lines: string[],
 *   providers: Map<string, {
 *     id: string, api?: string, flow: boolean,
 *     entries: Array<{
 *       id: string, lineStart: number, lineEnd: number,
 *       efforts: null | {start: number, end: number, inline: string},
 *       scalars: Record<string, {line: number, inline: string}>,
 *     }>,
 *   }>,
 * }}
 */
export function scanPatch(text) {
  if (typeof text !== 'string' || text.length === 0) throw new PatchShapeError('patch 内容为空');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);

  const entryStart = lines.findIndex((line) => /^- id:\s*(["']?)llm-pi-ai\1\s*$/.test(line));
  if (entryStart < 0) throw new PatchShapeError('patch 里找不到 - id: llm-pi-ai 条目');

  const entryEnd = nextAtOrAbove(lines, entryStart + 1, 0);

  let providersLine = -1;
  for (let i = entryStart + 1; i < entryEnd; i += 1) {
    if (lines[i].trimEnd() === '    providers:') {
      providersLine = i;
      break;
    }
  }
  if (providersLine < 0) throw new PatchShapeError('llm-pi-ai 条目里没有 providers 段');

  const providersEnd = nextAtOrAbove(lines, providersLine + 1, 4, entryEnd);

  const providers = new Map();
  let current = null;

  const closeProvider = (end) => {
    if (!current) return;
    current.lineEnd = end;
    providers.set(current.id, current);
    current = null;
  };

  for (let i = providersLine + 1; i < providersEnd; i += 1) {
    const line = lines[i];
    if (isSkippable(line)) continue;
    const indent = indentOf(line);

    if (indent === 6 && line.trimEnd().endsWith(':') && !line.trimStart().startsWith('- ')) {
      closeProvider(i);
      const id = unquote(line.trim().slice(0, -1));
      if (id.length === 0) throw new PatchShapeError(`第 ${i + 1} 行 provider 名为空`);
      current = { id, api: undefined, flow: false, modelsLine: -1, entries: [], lineStart: i, lineEnd: i };
      continue;
    }

    if (!current) continue;

    if (indent === 8 && line.trimStart().startsWith('api:')) {
      current.api = unquote(line.trim().slice('api:'.length));
      continue;
    }

    if (indent === 8 && /^models:\s*$/.test(line.trim())) {
      current.modelsLine = i;
      continue;
    }

    if (indent === 8 && /^models:\s*\S/.test(line.trim())) {
      current.flow = true;
      current.modelsLine = i;
      continue;
    }
  }
  closeProvider(providersEnd);

  for (const provider of providers.values()) {
    if (provider.modelsLine < 0) continue;
    const modelsEnd = nextAtOrAbove(lines, provider.modelsLine + 1, 8, provider.lineEnd);
    provider.modelsEnd = modelsEnd;

    let item = null;
    const closeItem = (end) => {
      if (!item) return;
      item.lineEnd = end;
      provider.entries.push(item);
      item = null;
    };

    for (let i = provider.modelsLine + 1; i < modelsEnd; i += 1) {
      const line = lines[i];
      if (isSkippable(line)) continue;
      const indent = indentOf(line);

      if (indent === 10 && line.trimStart().startsWith('- ')) {
        closeItem(i);
        const match = line.trimStart().slice(2).match(/^id:\s*(.+)$/);
        if (!match) throw new PatchShapeError(`第 ${i + 1} 行的模型条目没有 id`);
        item = { id: unquote(match[1]), lineStart: i, lineEnd: i, efforts: null, scalars: {} };
        continue;
      }

      if (!item) continue;

      if (indent === 12) {
        const scalarMatch = line.trimStart().match(new RegExp(`^(${SCALAR_KEYS.join('|')}):\\s*(.*)$`));
        if (scalarMatch) {
          item.scalars[scalarMatch[1]] = { line: i, inline: scalarMatch[2].trim() };
          continue;
        }
      }

      if (indent === 12 && line.trimStart().startsWith('reasoningEfforts:')) {
        const inline = line.trimStart().slice('reasoningEfforts:'.length).trim();
        if (inline.length > 0) {
          item.efforts = { start: i, end: i + 1, inline };
        } else {
          const blockEnd = nextAtOrAbove(lines, i + 1, 12, modelsEnd);
          item.efforts = { start: i, end: blockEnd, inline: '' };
        }
      }
    }
    closeItem(modelsEnd);

    const seen = new Set();
    for (const entry of provider.entries) {
      if (entry.id.length === 0) throw new PatchShapeError(`provider "${provider.id}" 有空的模型 id`);
      if (seen.has(entry.id)) throw new PatchShapeError(`provider "${provider.id}" 里模型 "${entry.id}" 重复`);
      seen.add(entry.id);
    }
  }

  return { eol, lines, providers };
}

/** 输出一个档位键：off 在 YAML 1.1 里是布尔字面量，统一加引号最稳。 */
function yamlKey(level) {
  return /^[a-z]+$/.test(level) && level !== 'off' ? level : `'${level}'`;
}

function yamlScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  return /^[A-Za-z0-9._-]+$/.test(text) && text !== 'null' && text !== 'true' && text !== 'false'
    ? text
    : JSON.stringify(text);
}

/** 渲染 reasoningEfforts 块（缩进 12）。 */
export function renderEfforts(efforts) {
  if (efforts === false) return ['            reasoningEfforts: false'];
  const rows = Object.entries(efforts ?? {});
  if (rows.length === 0) return [];
  return [
    '            reasoningEfforts:',
    ...rows.map(([level, wire]) => `              ${yamlKey(level)}: ${yamlScalar(wire)}`),
  ];
}

/**
 * @param {string} text patch 原文
 * @param {Array<{provider: string, model: string, efforts?: object|false, scalars?: Record<string, number>}>} plan
 * @returns {{text: string, changes: number, skipped: string[], touched: Set<string>}}
 */
export function renderPatch(text, plan) {
  const { eol, lines, providers } = scanPatch(text);
  const edits = [];
  const touched = new Set();
  let changes = 0;
  const skipped = [];

  for (const item of plan ?? []) {
    const provider = providers.get(item.provider);
    if (!provider) {
      skipped.push(`${item.provider}/${item.model}: provider 不存在`);
      continue;
    }
    if (provider.flow) {
      throw new PatchShapeError(`provider "${item.provider}" 的 models 不是块序列，无法行级改写`);
    }
    const entry = provider.entries.find((candidate) => candidate.id === item.model);
    if (!entry) {
      skipped.push(`${item.provider}/${item.model}: 模型不存在`);
      continue;
    }

    const inserts = [];
    let entryChanged = false;

    // 标量：已有则整行替换，没有则排队插入。
    for (const key of SCALAR_KEYS) {
      const value = item.scalars?.[key];
      if (value === undefined || value === null) continue;
      if (!Number.isInteger(value) || value <= 0) continue;
      const line = `            ${key}: ${value}`;
      const existing = entry.scalars[key];
      if (existing) {
        if (existing.inline !== String(value)) {
          edits.push({ start: existing.line, end: existing.line + 1, lines: [line] });
          entryChanged = true;
        }
      } else {
        inserts.push(line);
        entryChanged = true;
      }
    }

    // 档位块。
    if (item.efforts !== undefined) {
      const block = renderEfforts(item.efforts);
      if (block.length > 0) {
        if (entry.efforts) {
          const current = lines.slice(entry.efforts.start, entry.efforts.end);
          if (!(current.length === block.length && current.every((line, index) => line === block[index]))) {
            edits.push({ start: entry.efforts.start, end: entry.efforts.end, lines: block });
            entryChanged = true;
          }
        } else {
          inserts.push(...block);
          entryChanged = true;
        }
      }
    }

    if (inserts.length > 0) {
      edits.push({ start: entry.lineEnd, end: entry.lineEnd, lines: inserts });
    }
    if (entryChanged) {
      changes += 1;
      touched.add(`${item.provider}/${item.model}`);
    }
  }

  if (edits.length === 0) return { text, changes: 0, skipped, touched };

  // 同一位置的多处插入会互相踩踏（都插在条目末尾），先按位置合并。
  const merged = [];
  for (const edit of edits.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start))) {
    const last = merged.at(-1);
    if (last && last.start === edit.start && last.end === edit.end && edit.start === edit.end) {
      last.lines.push(...edit.lines);
      continue;
    }
    merged.push({ ...edit });
  }

  const out = lines.slice();
  for (const edit of merged.sort((a, b) => b.start - a.start)) {
    out.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return { text: out.join(eol), changes, skipped, touched };
}
