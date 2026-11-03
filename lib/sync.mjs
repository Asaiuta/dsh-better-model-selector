/**
 * 一次同步：读 patch → 按官方目录算档位/容量 → 行级改写 → 回读校验 → 落盘。
 *
 * 两个维度各自有两种模式：
 *   mode（档位）     catalog（默认）能对上官方条目的模型一律按官方范围重写
 *                    fill          只补没有 reasoningEfforts 的模型，手写值永不覆盖
 *   capacity（容量） off（默认）     完全不碰 contextWindow / maxTokens
 *                    fill            只补没有这两个字段的模型
 *                    catalog         一律按官方值重写
 *
 * 容量默认 off，而不是抄官方值：官方动辄给到 1M / 1050000，但多数中转网关
 * 实际只服务 256K，写大了直接 400 或静默截断——比档位敏感得多。
 * dsh 自己的默认 262144 反而最通用，所以默认一个字段都不写；
 * 要放到 1M 由模型面板第三行（上下文长度）手动决定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex, matchModel } from './match.mjs';
import { mapToEfforts } from './efforts.mjs';
import { capacityOf } from './capacity.mjs';
import { scanPatch, renderPatch, SCALAR_KEYS, PatchShapeError } from './patch.mjs';

const MAX_BACKUPS = 5;

function backup(patchPath, text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const file = `${patchPath}.bak-better-selector-${stamp}`;
  fs.writeFileSync(file, text, 'utf8');
  const dir = path.dirname(patchPath);
  const base = path.basename(patchPath);
  const old = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.bak-better-selector-`))
    .sort();
  for (const name of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* 清理旧备份失败不影响主流程 */
    }
  }
  return file;
}

/**
 * @param {object} options
 * @param {string} [options.patchPath] 目标 patch 文件；与 text 二选一
 * @param {string} [options.text] 直接给内容（测试用，不落盘）
 * @param {object[]} options.entries 官方目录条目
 * @param {'catalog'|'fill'} [options.mode]
 * @param {'off'|'fill'|'catalog'} [options.capacity]
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.backup]
 * @returns {{
 *   changed: number, models: number, matched: number, unmatched: number,
 *   unmatchedIds: string[], written: boolean, text: string, skipped: string[],
 *   noEfforts: string[], backupFile?: string,
 * }}
 */
export function syncEfforts(options) {
  const {
    patchPath,
    entries,
    mode = 'catalog',
    capacity = 'off',
    dryRun = false,
    backup: wantBackup = true,
    demote = false,
  } = options;
  const inline = typeof options.text === 'string';
  if (!inline && !patchPath) throw new Error('需要 patchPath 或 text');

  const original = inline ? options.text : fs.readFileSync(patchPath, 'utf8');
  const scan = scanPatch(original);

  const index = buildIndex(entries);
  const plan = [];
  const noEfforts = [];
  let models = 0;
  let matched = 0;
  const unmatchedIds = [];

  if (index.size > 0) {
    for (const provider of scan.providers.values()) {
      for (const entry of provider.entries) {
        models += 1;
        const hit = matchModel(entry.id, index, { api: provider.api });
        if (!hit) {
          unmatchedIds.push(entry.id);
          continue;
        }
        matched += 1;
        const item = {
          provider: provider.id,
          model: entry.id,
          via: hit.via,
          matchedId: hit.entry.id,
          matchedApi: hit.entry.api,
        };

        // 档位。
        if (!(mode === 'fill' && entry.efforts)) {
          const efforts = mapToEfforts(hit.entry);
          if (efforts === false) {
            // 官方判定「这个模型没有档位」。写 false 会关掉选择器里的档位控件，
            // 属于「减」——只记账，除非显式要求降级。
            noEfforts.push(`${provider.id}/${entry.id}`);
            if (demote === true) item.efforts = false;
          } else if (efforts !== undefined) {
            item.efforts = efforts;
          }
        }

        // 容量。
        if (capacity !== 'off') {
          const caps = capacityOf(hit.entry);
          if (caps) {
            const scalars = {};
            for (const key of SCALAR_KEYS) {
              const value = caps[key];
              if (value === undefined) continue;
              const declared = entry.scalars[key];
              if (capacity === 'fill' && declared !== undefined) continue;
              scalars[key] = value;
            }
            if (Object.keys(scalars).length > 0) item.scalars = scalars;
          }
        }

        if (item.efforts !== undefined || item.scalars !== undefined) plan.push(item);
      }
    }
  } else {
    for (const provider of scan.providers.values()) models += provider.entries.length;
  }

  const { text, changes, skipped } = renderPatch(original, plan);

  if (changes > 0) {
    // 回读校验：结构必须仍然完整，模型数一个都不能少
    const after = scanPatch(text);
    const beforeCount = [...scan.providers.values()].reduce((sum, p) => sum + p.entries.length, 0);
    const afterCount = [...after.providers.values()].reduce((sum, p) => sum + p.entries.length, 0);
    if (afterCount !== beforeCount) {
      throw new PatchShapeError(`改写后模型数从 ${beforeCount} 变成 ${afterCount}，放弃写入`);
    }
  }

  const willWrite = !inline && !dryRun && changes > 0;
  let backupFile;
  if (willWrite) {
    if (wantBackup) backupFile = backup(patchPath, original);
    fs.writeFileSync(patchPath, text, 'utf8');
  }

  return {
    changed: changes,
    models,
    matched,
    unmatched: unmatchedIds.length,
    unmatchedIds,
    written: willWrite,
    text,
    skipped,
    backupFile,
    plan,
    noEfforts,
  };
}
