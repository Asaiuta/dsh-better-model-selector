#!/usr/bin/env node
/**
 * 命令行：把官方目录对齐结果应用到 profile 的 patch 上（排查 / 无插件时兜底）。
 *
 *   node bin/sync.mjs --dry-run
 *   node bin/sync.mjs --patch "C:/Users/.../.dsh/profiles/desktop/cordis.patch.yml"
 *   node bin/sync.mjs --mode fill
 *   node bin/sync.mjs --capacity fill       # 容量默认不动，要补才显式开
 *   node bin/sync.mjs --capacity catalog    # 窗口/上限按官方值重写（谨慎）
 *   node bin/sync.mjs --demote              # 官方判定「无档位」的模型改成 reasoningEfforts: false
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadCatalogEntries } from '../lib/catalog.mjs';
import { syncEfforts } from '../lib/sync.mjs';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const patchPath = value('--patch', process.env.DSH_PATCH_PATH);
const mode = value('--mode', 'catalog');
const capacity = value('--capacity', 'off');
const dryRun = has('--dry-run');
const asarPath = value('--asar', undefined);

if (!patchPath) {
  console.error('[better-selector] 需要 --patch <cordis.patch.yml> 或 DSH_PATCH_PATH');
  process.exit(2);
}
if (!existsSync(patchPath)) {
  console.error(`[better-selector] 文件不存在: ${patchPath}`);
  process.exit(2);
}

try {
  const catalog = loadCatalogEntries({ asarPath });
  console.log(`[better-selector] 官方目录 ${catalog.entries.length} 条 ← ${catalog.source}`);

  const result = syncEfforts({
    patchPath,
    entries: catalog.entries,
    mode,
    capacity,
    dryRun,
    backup: !dryRun && !has('--no-backup'),
    demote: has('--demote'),
  });

  console.log(`[better-selector] 模型 ${result.models} 个，命中 ${result.matched} 个，未命中 ${result.unmatched} 个`);
  console.log(`[better-selector] ${result.written ? `已写入 ${result.changed} 处` : dryRun ? `dry-run：将修改 ${result.changed} 处` : '无需改动'}`);

  if (has('--explain')) {
    const show = (efforts) => (efforts === false ? 'false' : Object.entries(efforts).map(([level, wire]) => `${level}=${wire ?? '不发'}`).join(' '));
    for (const item of result.plan) {
      const parts = [];
      if (item.efforts !== undefined) parts.push(show(item.efforts));
      if (item.scalars) parts.push(Object.entries(item.scalars).map(([key, value]) => `${key}=${value}`).join(' '));
      console.log(`  ${item.provider}/${item.model}`);
      console.log(`      ${parts.join('  ')}   ← ${item.matchedId} @${item.matchedApi} (${item.via})`);
    }
  }
  if (result.backupFile) console.log(`[better-selector] 备份: ${result.backupFile}`);
  if (result.noEfforts.length > 0) {
    console.log(`[better-selector] 这些模型官方不给档位，配置一个字都没动 —— ${result.noEfforts.join(', ')}`);
    console.log('[better-selector] 要按官方写成 reasoningEfforts: false（选择器里不再出现档位）就加 --demote');
  }
  if (result.unmatchedIds.length > 0) console.log(`[better-selector] 保持原样: ${result.unmatchedIds.join(', ')}`);
  if (result.skipped.length > 0) for (const line of result.skipped) console.log(`  跳过 ${line}`);
} catch (error) {
  console.error(`[better-selector] 失败: ${error.message}`);
  process.exit(1);
}
