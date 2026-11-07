/**
 * 官方目录读取：从 DSH 的 app.asar 里取 pi-ai 的内置模型数据。
 *
 * 为什么读 asar 而不是 import `@earendil-works/pi-ai/providers/all`：
 *   profile 的 node_modules 里没有这个包（DSH 把它打在 app.asar 内），
 *   第三方插件从 profile 解析不到；直接解析 asar 头是纯 Node 实现，
 *   既能离线单测，也不依赖宿主的模块解析规则。
 *
 * 数据本身随 DSH 升级更新 —— 这就是「新模型发布后自动适配」的来源。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * 读 asar 本体必须绕开 Electron 的 fs 补丁：宿主是 `DSH NEXT.exe` 以 run-as-node 跑的，
 * 补丁后的 fs 把 app.asar 当目录（statSync().isFile() 为 false，openSync 抛 ENOENT）。
 * 纯 Node 没有 original-fs，退回 node:fs，两边行为一致。
 */
const rawFs = (() => {
  try {
    return createRequire(import.meta.url)('original-fs');
  } catch {
    return fs;
  }
})();

const DATA_RE = /\/@earendil-works\/pi-ai\/dist\/providers\/data\/[^/]+\.json$/;

/** 解析 asar 头部，返回全量文件索引。 */
export function readAsarIndex(asarPath) {
  const fd = rawFs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    rawFs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    if (!Number.isFinite(headerSize) || headerSize <= 0 || jsonSize <= 0 || jsonSize > headerSize) {
      throw new Error('不是有效的 asar 文件（头部尺寸异常）');
    }
    const headerBuf = Buffer.alloc(jsonSize);
    rawFs.readSync(fd, headerBuf, 0, jsonSize, 16);
    const header = JSON.parse(headerBuf.toString('utf8'));

    const out = [];
    const walk = (node, prefix) => {
      for (const [key, value] of Object.entries(node.files ?? {})) {
        const filePath = `${prefix}/${key}`;
        if (value.files) walk(value, filePath);
        else out.push({ path: filePath, size: value.size, offset: Number(value.offset) });
      }
    };
    walk(header, '');
    return { index: out, dataStart: 8 + headerSize };
  } finally {
    rawFs.closeSync(fd);
  }
}

/** 按路径读取 asar 内的一个文件。 */
export function readAsarFile(asarPath, entryPath, precomputed) {
  const { index, dataStart } = precomputed ?? readAsarIndex(asarPath);
  const entry = index.find((item) => item.path === entryPath);
  if (!entry) throw new Error(`asar 里没有 ${entryPath}`);
  const fd = rawFs.openSync(asarPath, 'r');
  try {
    const buf = Buffer.alloc(entry.size);
    rawFs.readSync(fd, buf, 0, entry.size, dataStart + entry.offset);
    return buf;
  } finally {
    rawFs.closeSync(fd);
  }
}

/**
 * 按优先级列出 app.asar 可能出现的位置（纯函数，方便单测）。
 *
 * 宿主进程不是 Electron 主进程，`process.resourcesPath` 常常是 undefined；
 * 桌面版是用 `electron host.js <app.asar> <profile> <runtime>` 把宿主拉起来的，
 * 所以 app.asar 会出现在 argv 里，或者宿主本身就跑在 asar 内部（argv 里带
 * `...\resources\app.asar\lib\host.js`）——两种都从字符串里切出来。
 *
 * @param {{explicit?: string, env?: object, resourcesPath?: string, argv?: string[], execPath?: string}} input
 * @returns {string[]} 候选路径，去重后按可信度排序
 */
export function asarCandidates(input = {}) {
  const { explicit, env = {}, resourcesPath, argv = [], execPath, cwd } = input;
  const out = [];
  const add = (candidate) => {
    if (typeof candidate !== 'string' || candidate.length === 0) return;
    if (!out.includes(candidate)) out.push(candidate);
  };

  add(explicit);
  add(env.DSH_ASAR_PATH);
  if (resourcesPath) add(path.join(resourcesPath, 'app.asar'));

  for (const arg of argv) {
    const nested = /^(.*[\\/]resources[\\/]app\.asar)(?:[\\/]|$)/.exec(arg);
    if (nested !== null) add(nested[1]);
    if (arg.endsWith('.asar')) add(arg);
  }

  if (execPath) add(path.join(path.dirname(execPath), 'resources', 'app.asar'));

  // 最后一招：从工作目录往上找。桌面版把宿主的 cwd 设在 resources 附近，
  // 这一条纯粹是「上面几条都不灵」时的兜底。
  if (cwd) {
    let dir = path.resolve(cwd);
    for (let depth = 0; depth < 5; depth += 1) {
      add(path.join(dir, 'app.asar'));
      add(path.join(dir, 'resources', 'app.asar'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return out;
}

/** 本进程实际能试的位置（把 asarCandidates 的输入接到真实环境上）。 */
export function hostAsarCandidates(explicit) {
  return asarCandidates({
    explicit,
    env: process.env,
    resourcesPath: process.resourcesPath,
    argv: process.argv,
    execPath: process.execPath,
    cwd: process.cwd(),
  });
}

/**
 * 找 app.asar：显式配置 > 环境变量 > Electron resourcesPath > 命令行参数 > 可执行文件旁边 > 工作目录。
 */
export function resolveAsarPath(explicit) {
  const candidates = hostAsarCandidates(explicit);

  for (const candidate of candidates) {
    try {
      if (rawFs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* 换下一个候选 */
    }
  }
  return undefined;
}

function collect(node, bucket) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.id === 'string' && typeof node.api === 'string') {
    bucket.push({
      id: node.id,
      api: node.api,
      provider: typeof node.provider === 'string' ? node.provider : undefined,
      reasoning: node.reasoning,
      thinkingLevelMap: node.thinkingLevelMap ?? null,
      compat: node.compat ?? null,
      contextWindow: node.contextWindow,
      maxTokens: node.maxTokens,
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collect(value, bucket);
  }
}

/**
 * 读出全部内置模型条目。
 * @param {{asarPath?: string, dataDir?: string}} [options]
 * @returns {{entries: object[], source: string}}
 */
export function loadCatalogEntries(options = {}) {
  const seen = new Set();
  const entries = [];

  const take = (raw, source) => {
    const bucket = [];
    collect(raw, bucket);
    for (const entry of bucket) {
      const key = `${entry.provider ?? ''}|${entry.api}|${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
    return source;
  };

  const dataDir = options.dataDir;
  if (dataDir && fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir)) {
      if (!name.endsWith('.json')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      take(raw, path.join(dataDir, name));
    }
    return { entries, source: dataDir };
  }

  const asarPath = resolveAsarPath(options.asarPath);
  if (!asarPath) {
    const tried = hostAsarCandidates(options.asarPath);
    throw new Error(`找不到 app.asar（试过 ${tried.length} 个位置：${tried.join('、') || '无'}），请配置 asarPath 或设置 DSH_ASAR_PATH`);
  }

  const precomputed = readAsarIndex(asarPath);
  const dataFiles = precomputed.index.filter((item) => DATA_RE.test(item.path));
  if (dataFiles.length === 0) {
    throw new Error(`${asarPath} 里没有 pi-ai 的 provider 数据（布局可能变了）`);
  }
  for (const file of dataFiles) {
    const buf = readAsarFile(asarPath, file.path, precomputed);
    take(JSON.parse(buf.toString('utf8')), file.path);
  }
  return { entries, source: `${asarPath} (${dataFiles.length} 个 provider 数据文件)` };
}
