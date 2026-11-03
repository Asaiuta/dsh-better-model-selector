/**
 * dsh-better-model-selector —— 按 DSH 自带的官方模型目录，给自定义网关模型补思考档位。
 *
 * 与社区同类插件的区别只有一条：档位范围来自 pi-ai 的内置目录
 * （随 DSH 升级自动更新），不是每个模型都套同一张五档表。
 *
 * 运行时机：DSH 启动时一次；之后 patch 文件变化（界面里加/删模型）再同步。
 * 不发任何网络请求。
 */
import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadCatalogEntries } from './catalog.mjs';
import { syncEfforts } from './sync.mjs';

export const name = 'better-selector';

/** 自己刚写完盘，忽略紧随其后的文件事件。 */
const SETTLE_MS = 1500;

function dshHome() {
  for (const key of ['DSH_HOME', 'DSH_NEXT_HOME']) {
    const value = process.env[key];
    if (value && existsSync(value)) return value;
  }
  return path.join(homedir(), '.dsh');
}

function resolvePatchPath(config = {}) {
  if (config.patchPath) return config.patchPath;

  const profilesDir = path.join(dshHome(), 'profiles');
  if (!existsSync(profilesDir)) return undefined;

  const wanted = config.profile ?? process.env.DSH_PROFILE;
  if (wanted) {
    const candidate = path.join(profilesDir, wanted, 'cordis.patch.yml');
    if (existsSync(candidate)) return candidate;
  }

  let best;
  let bestTime = -1;
  for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(profilesDir, entry.name, 'cordis.patch.yml');
    if (!existsSync(file)) continue;
    try {
      const time = statSync(file).mtimeMs;
      if (time > bestTime) {
        bestTime = time;
        best = file;
      }
    } catch {
      /* 读不到时间就跳过 */
    }
  }
  return best;
}

export function apply(ctx, config = {}) {
  const log = (message, level = 'info') => {
    const text = `[better-selector] ${message}`;
    try {
      const logger = ctx?.logger;
      const sink = logger === undefined ? undefined : (Reflect.get(logger, level) ?? Reflect.get(logger, 'info'));
      if (typeof sink === 'function') {
        // 必须带着 logger 当 this：宿主的日志方法靠 this 找自己的命名空间。
        sink.call(logger, text);
        return;
      }
    } catch {
      /* 落到 console */
    }
    // 宿主收走 stdout/stderr（日志里表现为 [host.stderr] output），不能只打给虚空。
    try {
      if (level === 'error') console.error(text);
      else if (level === 'warn') console.warn(text);
      else console.log(text);
    } catch {
      /* 连 console 都没有就算了 */
    }
  };

  const patchPath = resolvePatchPath(config);
  if (!patchPath) {
    log('没找到 profile 的 cordis.patch.yml，插件不做任何事', 'warn');
    return;
  }

  let catalog;
  try {
    catalog = loadCatalogEntries({ asarPath: config.asarPath });
    log(`官方目录已加载：${catalog.entries.length} 条（${catalog.source}）`);
  } catch (error) {
    log(`加载官方目录失败，插件停用：${error.message}`, 'error');
    return;
  }

  const mode = config.mode === 'fill' ? 'fill' : 'catalog';
  const capacity = ['fill', 'catalog', 'off'].includes(config.capacity) ? config.capacity : 'off';
  log(`目标配置: ${patchPath} / 档位: ${mode} / 容量: ${capacity}`);

  let running = false;
  let silentUntil = 0;

  const run = (reason) => {
    if (running) return;
    if (Date.now() < silentUntil) return;
    running = true;
    try {
      const result = syncEfforts({
        patchPath,
        entries: catalog.entries,
        mode,
        capacity,
        dryRun: config.dryRun === true,
        backup: config.backup !== false,
        // 默认只加不减：官方说「没档位」就保持配置原样，删掉用户手写的档位是另一回事。
        demote: config.demote === true,
      });

      if (result.written) {
        silentUntil = Date.now() + SETTLE_MS;
        log(`已更新 ${result.changed} 个模型（${reason}）${result.backupFile ? `，备份 ${path.basename(result.backupFile)}` : ''}`);
      } else if (result.changed > 0) {
        log(`有 ${result.changed} 个模型需要更新，但未写盘（dryRun）`);
      } else {
        log(`配置已是最新（${reason}）`);
      }

      if (result.noEfforts.length > 0) {
        log(`官方不给档位的模型 ${result.noEfforts.length} 个，配置保持原样: ${result.noEfforts.join(', ')}（demote: true 才写 false）`);
      }

      if (result.unmatched > 0) {
        log(`官方目录里没有对应条目、保持原样的模型 ${result.unmatched} 个: ${result.unmatchedIds.slice(0, 8).join(', ')}${result.unmatchedIds.length > 8 ? ' …' : ''}`);
      }
    } catch (error) {
      log(`同步失败（${reason}）：${error.message}`, 'error');
    } finally {
      running = false;
    }
  };

  run('启动');

  if (config.watch === false) return;

  let timer;
  let watcher;
  const dir = path.dirname(patchPath);
  const base = path.basename(patchPath);

  try {
    // 监听目录而不是文件：编辑器/宿主常用「写临时文件再改名」落盘，
    // 直接 watch 文件会在第一次替换后失去 inode。
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (filename && String(filename) !== base) return;
      clearTimeout(timer);
      timer = setTimeout(() => run('配置变化'), 700);
    });
    watcher.on('error', (error) => log(`监听出错：${error.message}`, 'warn'));
  } catch (error) {
    log(`无法监听配置变化：${error.message}`, 'warn');
  }

  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      clearTimeout(timer);
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
    });
  }
}
