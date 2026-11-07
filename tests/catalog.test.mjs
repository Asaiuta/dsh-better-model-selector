/**
 * 数据源冒烟测试：真的从这台机器的 app.asar 里读出官方目录。
 * 找不到 asar 时跳过（CI / 别的机器不该因此失败）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { asarCandidates, resolveAsarPath, loadCatalogEntries } from '../lib/catalog.mjs';

test('asar 候选：桌面版的命令行里带 asar，两种写法都要认', () => {
  // 用泛化路径，别把本机安装位置写进公开仓库——这里的断言只关心路径形态。
  // 保留中间的空格：宿主装在有空格或中文名的目录里时，这条正则也得认。
  const asar = 'D:/Programs/DSH NEXT/resources/app.asar';
  const fromHostJs = asarCandidates({
    argv: ['node', `${asar}/lib/host.js`, asar, 'C:/profile'],
  });
  assert.deepEqual(fromHostJs, [asar], 'host.js 与裸 asar 参数是同一个路径，不重复列');

  const bare = asarCandidates({ argv: ['node', 'x.js', asar] });
  assert.deepEqual(bare, [asar]);
});

test('asar 候选：显式配置 > 环境变量 > resourcesPath > argv > 可执行文件旁 > 工作目录', () => {
  // cwd 要用 resolve 出来的真路径：`D:/work/deep` 在 POSIX 上不是绝对路径，
  // 会被 path.resolve 当成相对路径拼到当前工作目录后面，断言就永远不成立。
  const deep = path.resolve('work', 'deep');
  const list = asarCandidates({
    explicit: 'D:/explicit/app.asar',
    env: { DSH_ASAR_PATH: 'D:/env/app.asar' },
    resourcesPath: 'D:/electron/resources',
    argv: ['node', 'D:/argv/app.asar'],
    execPath: 'D:/app/DSH.exe',
    cwd: deep,
  });
  assert.equal(list[0], 'D:/explicit/app.asar');
  assert.equal(list[1], 'D:/env/app.asar');
  assert.equal(list[2], path.join('D:/electron/resources', 'app.asar'), 'resourcesPath 拼出来的是平台路径');
  assert.ok(list.includes('D:/argv/app.asar'), 'argv 里出现过的 asar 要收进来');
  assert.ok(list.includes(path.join('D:/app', 'resources', 'app.asar')), '可执行文件旁边的标准布局');
  assert.ok(list.includes(path.join(deep, 'app.asar')), '工作目录本身');
  assert.ok(list.includes(path.join(path.dirname(deep), 'app.asar')), '往上找一层');
});

test('asar 候选：什么都没给就是空列表，不编路径', () => {
  assert.deepEqual(asarCandidates(), []);
  assert.deepEqual(asarCandidates({ argv: ['node', 'server.js'] }), []);
});

test('找不到 asar 时 resolveAsarPath 返回 undefined，由调用方决定降级', () => {
  // DSH_ASAR_PATH 是更低一级的候选，跑数据源用例时会被设上，这里必须摘掉。
  const saved = process.env.DSH_ASAR_PATH;
  delete process.env.DSH_ASAR_PATH;
  try {
    assert.equal(resolveAsarPath('D:/definitely/not/here/app.asar'), undefined);
  } finally {
    if (saved !== undefined) process.env.DSH_ASAR_PATH = saved;
  }
});

test('能找到本机的 app.asar，并读出上千条官方模型', (t) => {
  const asarPath = resolveAsarPath();
  if (!asarPath) {
    t.skip('这台机器上没有 app.asar');
    return;
  }
  const { entries, source } = loadCatalogEntries({ asarPath });
  assert.ok(entries.length > 800, `只读到 ${entries.length} 条，来源 ${source}`);

  const gpt = entries.filter((entry) => entry.id === 'gpt-6.1-sol');
  assert.ok(gpt.length >= 2, 'gpt-6.1-sol 应该出现在多个通道里');
  assert.ok(gpt.some((entry) => entry.thinkingLevelMap && entry.thinkingLevelMap.xhigh === 'xhigh'));

  const flash = entries.find((entry) => entry.id === 'deepseek-v4-flash');
  assert.ok(flash, 'deepseek-v4-flash 应该在目录里');
});

test('Electron 运行时里也能读 asar（宿主的 fs 补丁把 app.asar 当目录）', (t) => {
  const electron = process.env.DSH_ELECTRON_EXE;
  const asarPath = resolveAsarPath();
  if (!electron || !asarPath) {
    t.skip('需要 DSH_ELECTRON_EXE 与 DSH_ASAR_PATH');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'better-selector-'));
  try {
    const output = path.join(dir, 'result.json');
    const script = path.join(dir, 'probe.mjs');
    const catalogUrl = new URL('../lib/catalog.mjs', import.meta.url).href;
    // GUI 子系统的 exe 不保证 stdout 可读，结果走文件。
    fs.writeFileSync(script, [
      `import { writeFileSync } from 'node:fs';`,
      `import { resolveAsarPath, loadCatalogEntries } from ${JSON.stringify(catalogUrl)};`,
      `const found = resolveAsarPath(${JSON.stringify(asarPath)});`,
      `const { entries } = loadCatalogEntries({ asarPath: found });`,
      `writeFileSync(${JSON.stringify(output)}, JSON.stringify({ electron: process.versions.electron, found, count: entries.length }));`,
    ].join('\n'));
    const run = spawnSync(electron, [script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 30000,
    });
    assert.equal(run.status, 0, String(run.stderr));
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.ok(result.electron, '必须真的跑在 Electron 里，否则这条用例什么也没证明');
    assert.equal(result.found, asarPath);
    assert.ok(result.count > 800, `只读到 ${result.count} 条`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('目录里每条带档位表的记录都只含合法的档位键', (t) => {
  const asarPath = resolveAsarPath();
  if (!asarPath) {
    t.skip('这台机器上没有 app.asar');
    return;
  }
  const { entries } = loadCatalogEntries({ asarPath });
  const allowed = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  for (const entry of entries) {
    if (!entry.thinkingLevelMap) continue;
    for (const key of Object.keys(entry.thinkingLevelMap)) {
      assert.ok(allowed.has(key), `${entry.id} 出现未知档位键 ${key}`);
    }
  }
});
