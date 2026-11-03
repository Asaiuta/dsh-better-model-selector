/**
 * 契约：模型选择器里的那个窗口切换器。
 *
 * 真正会改配置的只有两件事，全部在这里锚住：
 *   1. 选中某一格 → 只写这一个模型的 contextWindow，maxTokens 仅在超限时跟着压
 *   2. 选中「默认」→ 两个字段都 unset，交回 dsh 的默认窗口
 *
 * 另外三条是「遵守宿主风格」的可执行形式：
 *   3. 座位是模型选择器**自己声明**的 `conversation.input.model.label`；占了以后
 *      renderSlot 的 fallback（model.name）不再生效，所以模型名必须由这个组件画
 *      ——绝不允许返回 null。
 *   4. 不可写时**不渲染控件**（不画 disabled 的死控件），只留一行字。
 *   5. 数字走宿主 `formatTokens` 同款口径（十进制、≥100 取整），文案走 locale 字典。
 *
 * 客户端文件是浏览器 IIFE（window.__ModuleLoader__），所以用 vm 造一个假宿主加载它。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** 假宿主 primitive：图标只是占位，重点是 props 契约。 */
const fakeMenu = function Menu() {
  return null;
};
const fakeChevron = function IconChevronDownOutlineRegular() {
  return null;
};
const fakeCheck = function IconCheckOutlineRegular() {
  return null;
};
const primitivesStub = { Menu: fakeMenu, IconChevronDownOutlineRegular: fakeChevron, IconCheckOutlineRegular: fakeCheck };

/** portal 只是把树挂到别处，测试里记下容器就够。 */
const reactDomStub = {
  createPortal: (node, container) => ({ type: 'ec-portal', props: { container }, children: [node] }),
};

/**
 * 在假 window 里跑一遍客户端文件，拿到模块声明。
 * @param reactStub - 可替换的 react（渲染测试要能记录元素树）。
 * @param globals - 额外的沙箱全局（测试要截 console 时用）。
 */
function loadModule(reactStub, globals = {}) {
  const registered = [];
  const sandbox = { window: { __ModuleLoader__: { load: (decl) => registered.push(decl) } }, console: { error() {}, warn() {} }, ...globals };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  assert.equal(registered.length, 1, '必须且只能声明一个模块');
  const declaration = registered[0];
  const stub = reactStub ?? {
    createElement: () => null,
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    useSyncExternalStore: (subscribe, get) => get(),
  };
  const fakeRequire = (id) => {
    if (id === 'react') return stub;
    if (id === 'react-dom') return reactDomStub;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
    throw new Error(`意外的 require：${id}`);
  };
  const exports = declaration.factory(fakeRequire);
  return { declaration, exports };
}

/** 有状态的微型 hook 运行时：setState 之后重跑一次组件函数就能看到新状态。 */
function hookRuntime() {
  const slots = [];
  let index = 0;
  return {
    slots,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useSyncExternalStore: (subscribe, get) => get(),
    useEffect: () => {},
    useState: (initial) => {
      const at = index++;
      const slot = slots[at] ?? { value: initial };
      slots[at] = slot;
      return [slot.value, (next) => void (slot.value = next)];
    },
    useRef: (initial) => {
      const at = index++;
      const slot = slots[at] ?? { ref: { current: initial } };
      slots[at] = slot;
      return slot.ref;
    },
    begin() {
      index = 0;
    },
  };
}

const { declaration, exports } = loadModule();
const { locateWindow, windowOpsOf, defaultOpsOf, chipValueOf, optionsOf, formatTokens, occupantSummary, findRowHost, applyPaging, windowRow, LADDER, LABEL_SEAT, SEAT_ID, LOCALE_NS, SETTINGS_NS, zh, en, createView } = exports.__test;

/** vm 里造出来的数组/对象原型属于另一个 realm，比较前先摊平成纯 JSON。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 照字典渲染的 `t`；缺 key 直接炸，这样「文案漏了」会变成红灯而不是界面上的 key。 */
const dictionary = plain(zh);
const t = (key, params) => {
  const text = dictionary[key];
  if (text === undefined) throw new Error(`缺文案：${key}`);
  return params === undefined ? text : text.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
};
/** 渲染树的全部可见文字。**模型名绝不允许消失**这条就靠它断言。 */
const textOf = (node) => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node?.children ?? []).map(textOf).join('');
};

/** 深度找某类节点。 */
const findAll = (node, predicate, out = []) => {
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, predicate, out);
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, out);
  return out;
};

const VIEW = {
  user: {
    providers: {
      ziyong: {
        models: [
          { id: 'gpt-6.1-sol', contextWindow: 1050000, maxTokens: 128000 },
          { id: 'deepseek-v4-flash' },
        ],
      },
      inherited: {},
    },
  },
  value: {
    providers: {
      ziyong: {
        models: [
          { id: 'gpt-6.1-sol', contextWindow: 1050000, maxTokens: 128000 },
          { id: 'deepseek-v4-flash' },
        ],
      },
      inherited: { models: [{ id: 'only-in-base' }] },
    },
  },
};

test('模块声明与导出面', () => {
  assert.equal(declaration.id, 'dsh-better-model-selector');
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(plain(exports.inject), ['slots', 'locale', 'remote', 'remote.settings'], 'locale 是字典服务的依赖');
  assert.equal(LABEL_SEAT, 'conversation.input.model.label', '只挂模型选择器自己声明的那个标题座位');
  assert.notEqual(LOCALE_NS, SETTINGS_NS, '字典命名空间和设置命名空间不是一回事');
  assert.equal(SETTINGS_NS, 'llm-pi-ai');
});

test('apply：注册座位 + 注册字典', () => {
  const registrations = [];
  const injected = [];
  const dictionaries = [];
  const ctx = {
    get: () => ({ settings: { describe() {}, mutate() {} } }),
    locale: {
      bind: (ns) => (key) => `${ns}/${key}`,
      register: (ns, dict) => {
        dictionaries.push({ ns, dict });
        return () => {};
      },
    },
    effect: (fn) => fn(),
    remote: { $on: () => () => {} },
    inject: (_names, callback) => callback({ slots: ctx.slots }),
    slots: {
      inject: (name, callback) => {
        injected.push(name);
        callback();
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
      snapshot: () => [{ type: 'slot', name: LABEL_SEAT, occupants: [] }],
    },
  };
  exports.apply(ctx);
  assert.deepEqual(injected, ['conversation.input.model.label']);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'conversation.input.model.label');
  assert.equal(registrations[0].options.id, SEAT_ID);
  assert.equal(registrations[0].options.priority, 0, '座位空着就按默认优先级占');
  assert.equal(registrations[0].options.locale, 'dsh-better-model-selector');
  assert.equal(typeof registrations[0].component, 'function');
  assert.deepEqual(dictionaries.map((item) => item.ns), ['dsh-better-model-selector']);
});

//#region 座位冲突
/**
 * 按宿主的真实规则造一个座位：
 * `single` 座位同一优先级只许一个占位者，重复就抛（错误文案照抄宿主）。
 */
function seatHost(occupants = []) {
  const taken = occupants.map((item) => ({ ...item }));
  const log = { attempts: [], registrations: [], warned: [], errored: [] };
  const slots = {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      const priority = options.priority ?? 0;
      log.attempts.push(priority);
      if (taken.some((item) => item.priority === priority)) {
        throw new Error(
          `single slot "${options.name}" already has a registration at priority ${priority} (registered by Gb) — register at a different priority to shadow it (lowest renders)`,
        );
      }
      taken.push({ id: options.id, priority });
      log.registrations.push({ options, component, priority });
      return () => {
        const at = taken.findIndex((item) => item.id === options.id && item.priority === priority);
        if (at >= 0) taken.splice(at, 1);
      };
    },
    snapshot: (name) => [
      {
        type: 'slot',
        name,
        occupants: taken.map((item) => ({ id: item.id, priority: item.priority, active: true, registrant: 'Gb' })),
      },
    ],
  };
  const ctx = {
    get: () => ({ settings: { describe() {}, mutate() {} } }),
    locale: { bind: (ns) => (key) => `${ns}/${key}`, register: () => () => {} },
    effect: (fn) => fn(),
    remote: { $on: () => () => {} },
    inject: (_names, callback) => callback({ slots }),
    slots,
  };
  return { ctx, log, taken };
}

test('座位被别人占了：退到优先级 -1 顶替，并把占位者写进日志', () => {
  const host = seatHost([{ id: 'somebody-else', priority: 0 }]);
  const warn = [];
  loadModule(undefined, { console: { error() {}, warn: (message) => warn.push(String(message)) } }).exports.apply(host.ctx);

  assert.deepEqual(host.log.attempts, [0, -1], '先试 0，确认被占才退 -1');
  assert.deepEqual(
    host.log.registrations.map((item) => item.priority),
    [-1],
    '占住的只有 -1 那一次',
  );
  assert.equal(host.log.registrations[0].options.id, SEAT_ID);
  assert.equal(warn.length, 1, '顶替必须留话，不能静默盖掉别人的控件');
  assert.match(warn[0], /somebody-else/, '日志里要认出占位者是谁');
});

test('连 -1 都被占：只报错，不把异常扔给宿主', () => {
  const host = seatHost([
    { id: 'somebody-else', priority: 0 },
    { id: 'another-one', priority: -1 },
  ]);
  const errors = [];
  const module = loadModule(undefined, { console: { warn() {}, error: (...args) => errors.push(args) } });
  assert.doesNotThrow(() => module.exports.apply(host.ctx), '注册失败不能把宿主拖下水');
  assert.equal(host.log.registrations.length, 0);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /somebody-else/);
});

test('occupantSummary 把座位快照摊成一行', () => {
  const slots = {
    snapshot: () => [
      { occupants: [{ id: 'better-selector-window', priority: 0, active: true, registrant: 'Gb' }] },
    ],
  };
  assert.equal(occupantSummary(slots, LABEL_SEAT), 'better-selector-window priority 0 by Gb');

  const crowded = {
    snapshot: () => [
      { occupants: [{ id: 'a', priority: 0 }, { id: undefined, priority: -1, active: false }] },
    ],
  };
  assert.equal(occupantSummary(crowded, LABEL_SEAT), 'a priority 0 / (无 id) priority -1 已让位', '没 id 和让位也要说清楚');
  assert.equal(occupantSummary({ snapshot: () => [] }, LABEL_SEAT), '读不到占位者');
  assert.match(
    occupantSummary({ snapshot: () => { throw new Error('座位未声明'); } }, LABEL_SEAT),
    /读占位者失败：座位未声明/,
    '查不到就直说，不抛',
  );
});
//#endregion

test('字典：zh 与 en 的 key 集逐条对齐', () => {
  const zhKeys = Object.keys(plain(zh)).sort();
  const enKeys = Object.keys(plain(en)).sort();
  assert.deepEqual(enKeys, zhKeys);
  for (const key of zhKeys) assert.notEqual(dictionary[key].length, 0, `${key} 不能是空串`);
});

test('一次 describe 喂给所有座位实例', async () => {
  let reads = 0;
  const view = createView({
    describe: async () => {
      reads += 1;
      return { ok: true, value: { writable: true, namespaces: [{ ns: 'llm-pi-ai', revision: 7, user: {}, value: {} }] } };
    },
  });
  assert.equal(view.getSnapshot().status, 'idle', '没读之前就是 idle');
  const [first, second] = await Promise.all([view.load(), view.load()]);
  assert.equal(reads, 1, '并发调用只发一次 describe');
  assert.equal(first, second, '两次拿到同一份快照');
  assert.equal(first.status, 'ready');
  assert.equal(first.writable, true);
  assert.equal(first.view.revision, 7);
  await view.load();
  assert.equal(reads, 1, '已经就绪就不再读');
  await view.refresh();
  assert.equal(reads, 2, 'refresh 才重读');
});

test('设置读不出来时降级成一行错误，不抛给渲染层', async () => {
  const view = createView({ describe: async () => ({ ok: false, error: { message: '设置文档不可写' } }) });
  const state = await view.load();
  assert.equal(state.status, 'failed');
  assert.equal(state.failure, '设置文档不可写');

  const missing2 = createView({ describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }) });
  assert.equal((await missing2.load()).failure, '设置里没有 llm-pi-ai 这一节');
});

test('locateWindow 从用户层数组取下标，读实际生效的容量', () => {
  assert.deepEqual(plain(locateWindow(VIEW, 'ziyong', 'gpt-6.1-sol')), { index: 0, contextWindow: 1050000, maxTokens: 128000 });
  assert.deepEqual(plain(locateWindow(VIEW, 'ziyong', 'deepseek-v4-flash')), { index: 1 });
  assert.equal(locateWindow(VIEW, 'ziyong', '不存在'), undefined, '模型不在数组里就不写');
  assert.equal(locateWindow(VIEW, 'inherited', 'only-in-base'), undefined, '用户层没有 models 数组就不能按下标写');
});

test('选中某一格：写 contextWindow，maxTokens 只在超限时跟着压', () => {
  assert.deepEqual(plain(windowOpsOf('ziyong', 0, 262144, 128000)), [
    { op: 'set', path: ['providers', 'ziyong', 'models', '0', 'contextWindow'], value: 262144 },
  ]);
  assert.deepEqual(plain(windowOpsOf('ziyong', 0, 65536, 128000)), [
    { op: 'set', path: ['providers', 'ziyong', 'models', '0', 'contextWindow'], value: 65536 },
    { op: 'set', path: ['providers', 'ziyong', 'models', '0', 'maxTokens'], value: 65536 },
  ]);
  assert.deepEqual(
    plain(windowOpsOf('ziyong', 1, 1048576, undefined)),
    [{ op: 'set', path: ['providers', 'ziyong', 'models', '1', 'contextWindow'], value: 1048576 }],
    'maxTokens 没写过就不凭空补',
  );
});

test('选中「默认」：两个字段都 unset', () => {
  assert.deepEqual(plain(defaultOpsOf('ziyong', 3)), [
    { op: 'unset', path: ['providers', 'ziyong', 'models', '3', 'contextWindow'] },
    { op: 'unset', path: ['providers', 'ziyong', 'models', '3', 'maxTokens'] },
  ]);
});

test('ops 的 path 每一项都是 string', () => {
  // `settings/mutate` 的 ops 是 strict codec：`path: string[]`、additionalProperties:false。
  // 模型下标塞 number 会被 typert 的 boundary validation 打回，报
  // `typert gateway: settings/mutate: wire field "ops" failed boundary validation`。
  const all = [
    ...windowOpsOf('ziyong', 0, 262144, 4096),
    ...windowOpsOf('ziyong', 12, 1048576, undefined),
    ...defaultOpsOf('ziyong', 7),
  ];
  assert.ok(all.length > 0);
  for (const op of all) {
    assert.ok(op.op === 'set' || op.op === 'unset', `op 只能是 set/unset，实际 ${op.op}`);
    assert.ok(Array.isArray(op.path), 'path 必须是数组');
    for (const key of op.path) {
      assert.equal(typeof key, 'string', `path 里出现非字符串项：${String(key)}`);
    }
  }
});

test('菜单选中行不做四舍五入', () => {
  assert.equal(chipValueOf(undefined), 'default');
  assert.equal(chipValueOf(262144), '262144');
  assert.equal(chipValueOf(1050000), '1050000', '官方补进来的非梯子值原样带着');
});

test('数字口径与宿主 formatTokens 一致：十进制、≥100 取整', () => {
  assert.equal(formatTokens(262144, t), '262K', '不是 256K——宿主的上下文用量表显示的就是 262K');
  assert.equal(formatTokens(1048576, t), '1M', '不是 1.05M');
  assert.equal(formatTokens(2097152, t), '2.1M');
  assert.equal(formatTokens(131072, t), '131K');
  assert.equal(formatTokens(32768, t), '32.8K');
  assert.equal(formatTokens(999, t), '999');
  assert.equal(formatTokens(undefined, t), '—');
});

test('菜单行：默认 + 梯子，非梯子值单独一行且排在梯子前面', () => {
  assert.deepEqual(plain(optionsOf(undefined, t)), [
    { id: 'default', label: '默认' },
    { id: '262144', label: '262K' },
    { id: '524288', label: '524K' },
    { id: '1048576', label: '1M' },
    { id: '2097152', label: '2.1M' },
  ]);
  assert.deepEqual(plain(optionsOf(262144, t)).map((row) => row.id).slice(0, 2), ['default', '262144'], '梯子上的值不重复列');
  assert.deepEqual(plain(optionsOf(1050000, t)).map((row) => row.id).slice(0, 2), ['default', '1050000'], '非梯子值紧跟默认出现');
});

test('梯子全是 2 的幂，且从 262K 起——更小的窗口没有意义', () => {
  assert.deepEqual(plain(LADDER), [262144, 524288, 1048576, 2097152]);
  for (const value of LADDER) assert.ok(value >= 262144, `${value} 低于 dsh 的默认窗口`);
  for (const value of LADDER) assert.equal(Math.log2(value) % 1, 0, `${value} 不是 2 的幂`);
});

//#region 渲染层：座位被占以后模型名由我们负责，第三行挂进宿主面板
/** 有状态的微型 hook 运行时：setState 之后重跑一次组件函数就能看到新状态。 */
const hookState = { slots: [], index: 0 };

const recordingReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useSyncExternalStore: (subscribe, get) => get(),
  useEffect: () => {},
  useState: (initial) => {
    const at = hookState.index++;
    const slot = hookState.slots[at] ?? { value: initial };
    hookState.slots[at] = slot;
    return [slot.value, (next) => void (slot.value = next)];
  },
  useRef: (initial) => {
    const at = hookState.index++;
    const slot = hookState.slots[at] ?? { ref: { current: initial } };
    hookState.slots[at] = slot;
    return slot.ref;
  },
};

const rendered = loadModule(recordingReact).exports;
const { ModelLabel } = rendered.__test;

/** 面板容器的替身：createPortal 只需要一个容器，认得出来是它就行。 */
const PANEL = { id: 'fake-panel' };

/** 渲染一次（hook 游标归零，状态保留）。 */
function mount(props) {
  hookState.index = 0;
  return ModelLabel(props);
}

/**
 * 渲染出「第三行」那一路：`host` 是组件里第 4 个 useState（open / failure / busy / host），
 * 预置它就不必去伪造 DOM 与 effect。
 */
function mountInPanel(props) {
  hookState.slots[3] = { value: PANEL };
  return mount(props);
}

/** 第三行那层外壳（含展开出来的选项）。 */
const shellOf = (node) => findAll(node, (n) => n.props.className === 'ec-row-slot')[0];

/** 第三行本身（收起态时外壳里只有它一个 button）。 */
const headOf = (node) => findAll(shellOf(node), (n) => n.type === 'button')[0];

/** 点一下第三行把它展开（hookState 会记住 open=true，重放一次就能看到选项）。 */
function expandRow(props) {
  headOf(mountInPanel(props)).props.onClick();
  return mountInPanel(props);
}

/** 展开 → 点某一格 → 等写入落地，返回重新渲染后的树。 */
async function pickOption(props, id) {
  const opened = expandRow(props);
  const option = findAll(opened, (n) => n.props['data-option-id'] === id)[0];
  assert.ok(option !== undefined, `展开后没有 ${id} 这一格`);
  option.props.onClick();
  await settle();
  return mountInPanel(props);
}

/** 每个用例从干净的组件状态开始。 */
function resetHooks() {
  hookState.slots.length = 0;
  hookState.index = 0;
}

/** 把控制权交回事件循环，等 choose() 里的 await 走完。 */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const SOL = { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' };
const FLASH = { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' };
const PROVIDER = { id: 'ziyong', name: 'ziyong' };
const NOOP_SETTINGS = { mutate: async () => ({ ok: true }) };

/** 造一份已就绪的设置视图。 */
function readiedView(namespaces = [{ ns: 'llm-pi-ai', revision: 3, user: VIEW.user, value: VIEW.value }], writable = true) {
  const view = createView({ describe: async () => ({ ok: true, value: { writable, namespaces } }) });
  return view.load().then(() => view);
}

test('trigger 和模型行只画名字——宿主自己会显示推理等级', async () => {
  resetHooks();
  const view = await readiedView();
  for (const placement of ['trigger', 'option']) {
    const node = mount({ provider: PROVIDER, model: SOL, placement, settings: NOOP_SETTINGS, view, t });
    assert.equal(node.type, 'span', `${placement} 必须是 inline 的 span`);
    assert.equal(textOf(node), 'GPT-6.1 Sol', `${placement} 只画名字，不塞窗口尾巴`);
    assert.equal(findAll(node, (n) => n.type === fakeMenu).length, 0, `${placement} 里不许有菜单`);
    assert.equal(findAll(node, (n) => n.type === 'button').length, 0, `${placement} 里不许有按钮`);
    assert.equal(findAll(node, (n) => n.type === 'ec-portal').length, 0, `${placement} 不往面板里挂东西`);
  }
});

test('认不下面板容器时退回行内：名字 + 一行灰字，值不丢', async () => {
  resetHooks();
  const view = await readiedView();
  const node = mount({ provider: PROVIDER, model: SOL, placement: 'menu', settings: NOOP_SETTINGS, view, t });
  assert.equal(textOf(node), 'GPT-6.1 Sol1.1M');
  const dim = findAll(node, (n) => n.props.className === 'ec-dim')[0];
  assert.equal(dim.props.title, '设置只读，改不了上下文', '原因挂在 title 上');
  assert.equal(findAll(node, (n) => n.type === 'button').length, 0, '退路里也不放控件');
});

test('第三行挂在面板末尾：标签 + 当前值 + 箭头（收起态）', async () => {
  resetHooks();
  const view = await readiedView();
  const node = mountInPanel({ provider: PROVIDER, model: SOL, placement: 'menu', settings: NOOP_SETTINGS, view, t });

  const portals = findAll(node, (n) => n.type === 'ec-portal');
  assert.equal(portals.length, 1, '第三行必须 portal 进宿主面板');
  assert.equal(portals[0].props.container, PANEL);

  const names = findAll(node, (n) => n.props.className === 'ec-name');
  assert.equal(textOf(names[0]), 'GPT-6.1 Sol', '座位里那份名字照旧要画');

  const head = headOf(node);
  assert.equal(head.props.className, 'ec-row', '整行一副宿主 .cell 的样式');
  assert.equal(textOf(head), '上下文长度1.1M');
  assert.equal(head.props['aria-label'], 'GPT-6.1 Sol 的上下文长度，当前 1.1M');
  assert.equal(head.props['aria-expanded'], false);
  assert.equal(head.props['aria-haspopup'], undefined, '它不是弹出浮层的按钮，是就地展开');
  assert.equal(head.props.disabled, undefined, '可写就是能点的');
  assert.equal(findAll(node, (n) => n.props.className === 'ec-option').length, 0, '收起时整页只有这一行');
  assert.equal(findAll(node, (n) => n.type === fakeMenu).length, 0, '不用浮层菜单');
});

test('面板容器靠 ref 回调在 commit 阶段拿到，不等 effect', async () => {
  // 用 effect 取容器会晚一帧：宿主第一帧只量到「模型 / 推理等级」两行，
  // 位置按两行算好之后第三行才挂上去，于是「菜单先出现在别处，再跳到正确位置」。
  resetHooks();
  const view = await readiedView();
  const node = mount({ provider: PROVIDER, model: SOL, placement: 'menu', settings: NOOP_SETTINGS, view, t });

  const label = findAll(node, (n) => n.props.className === 'ec-label')[0];
  assert.equal(typeof label.props.ref, 'function', '座位那层必须带 ref 回调');
  assert.equal(label.props.onClick, undefined, '座位那层不挂手势，否则模型名就点不动了');
  assert.equal(label.props.onPointerDown, undefined);
  assert.equal(label.props.onMouseDown, undefined);

  assert.equal(hookState.slots[3].value, null, '开始还没有容器');
  const panel = { role: 'group', getAttribute: (key) => (key === 'role' ? 'group' : null) };
  const cell = { parentElement: panel };
  label.props.ref({ closest: (sel) => (sel === '[role="menuitem"]' ? cell : null) });
  assert.equal(hookState.slots[3].value, panel, 'ref 回调里就把 host 定下来');

  label.props.ref(null);
  assert.equal(hookState.slots[3].value, panel, '拔掉节点不清 host，也不许炸');
});

test('展开就是换页：第三行退场，整页只剩选项（和宿主「推理等级」同构）', async () => {
  resetHooks();
  const view = await readiedView();
  const props = { provider: PROVIDER, model: SOL, placement: 'menu', settings: NOOP_SETTINGS, view, t };
  const node = expandRow(props);

  // 宿主 drill 之后 root 页那两格就没了；我们换页后同样没有第三行，也没有浮层。
  assert.equal(findAll(node, (n) => n.props.className === 'ec-row').length, 0, '换页后第三行退场');
  assert.equal(findAll(node, (n) => n.type === fakeMenu).length, 0, '不弹浮层');
  assert.equal(findAll(node, (n) => n.type === 'ec-portal').length, 1, '仍然只有进面板那一处 portal');

  const options = findAll(node, (n) => n.props['data-option-id'] !== undefined);
  assert.deepEqual(
    plain(options.map((row) => row.props['data-option-id'])),
    ['default', '1050000', '262144', '524288', '1048576', '2097152'],
    '默认 + 非梯子值 + 梯子',
  );
  assert.equal(options.every((row) => row.props.className === 'ec-option'), true, '用宿主 .option 那一套度量');
  assert.equal(options.every((row) => row.props.role === 'menuitemradio'), true, '一组单选项');
  assert.equal(options.every((row) => row.props.disabled === false), true, '不在写入中就可点');

  const checked = options.filter((row) => row.props['aria-checked'] === true);
  assert.deepEqual(plain(checked.map((row) => row.props['data-option-id'])), ['1050000'], '只有当前那一格打勾');
  assert.equal(findAll(node, (n) => n.type === fakeCheck).length, 1, '勾只画一个');

  // 宿主的行结构：option > (optionCopy > modelName) + check
  const first = options[0];
  assert.equal(first.children[0].props.className, 'ec-option-copy');
  assert.equal(first.children[0].children[0].props.className, 'ec-option-name');
  assert.equal(first.children[1].props.className, 'ec-option-check');
});

test('换页靠给宿主面板加一个类，收起或卸载一定摘掉', async () => {
  const classes = new Set();
  const host = { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };

  applyPaging(host, true);
  assert.deepEqual([...classes], ['ec-paging']);
  applyPaging(host, false);
  assert.equal(classes.size, 0, '收起要摘掉，否则模型和推理等级两行永远不见');

  applyPaging(null, true);
  applyPaging({}, true);
  assert.equal(classes.size, 0, '认不出的面板不许抛');
});

test('Escape 是退一级（收起列表），不是关面板', async () => {
  let toggles = 0;
  const shell = rendered.__test.windowRow({
    t,
    name: 'GPT-6.1 Sol',
    value: '1.1M',
    size: 1050000,
    editable: true,
    reason: undefined,
    open: true,
    failure: undefined,
    busy: false,
    onToggle: () => void (toggles += 1),
    onSelect: () => {},
  });

  let stopped = 0;
  let prevented = 0;
  const event = (key) => ({ key, stopPropagation: () => void (stopped += 1), preventDefault: () => void (prevented += 1) });

  shell.props.onKeyDown(event('Escape'));
  assert.equal(toggles, 1, 'Escape 收回 root 页');
  assert.equal(stopped, 1, '别再漏给宿主——它会把整个面板关掉');
  assert.equal(prevented, 1);

  shell.props.onKeyDown(event('a'));
  assert.equal(toggles, 1, '别的键不管');
});

test('模型名保持可点：拦截不许挂在座位那一层', async () => {
  resetHooks();
  const view = await readiedView();
  const node = mountInPanel({ provider: PROVIDER, model: SOL, placement: 'menu', settings: NOOP_SETTINGS, view, t });

  // 座位在「模型」那一格的 .cellValue 里，写着模型名。宿主的官方行为是整格可点
  // （点名字、点空白、点箭头都 drill 进模型列表），所以这层一个手势都不许拦。
  for (const name of ['onPointerDown', 'onMouseDown', 'onClick']) {
    assert.equal(node.props[name], undefined, `${name} 不许挂在座位上，否则点模型名就进不去模型列表`);
  }
});

test('第三行的手势拦在自己的外壳上——展开的选项也算在内', async () => {
  resetHooks();
  const view = await readiedView();
  const props = { provider: PROVIDER, model: SOL, placement: 'menu', settings: NOOP_SETTINGS, view, t };
  const node = expandRow(props);

  // 第三行 portal 到面板末尾，但 fiber 仍在「模型」那一格底下（那一格 onClick 是
  // drill("model")）。React 按组件树冒泡，所以拦截挂在第三行这层外壳上。
  const shell = shellOf(node);
  assert.ok(shell, '第三行要有自己的外壳');
  for (const name of ['onPointerDown', 'onMouseDown', 'onClick']) {
    assert.equal(typeof shell.props[name], 'function', `${name} 要挂在外壳上`);
    let stopped = 0;
    shell.props[name]({ stopPropagation: () => void (stopped += 1) });
    assert.equal(stopped, 1, `${name} 必须 stopPropagation`);
  }

  // 选项必须在这层壳底下，否则点档位会顺着 fiber 冒到「模型」那一格。
  assert.ok(findAll(shell, (n) => n.props['data-option-id'] !== undefined).length > 0, '选项在壳里');

  // 截住不等于吞掉：点一下确实换页了（第三行退场、选项出来）。
  assert.equal(findAll(shell, (n) => n.props.className === 'ec-row').length, 0, '第三行已退场');
  assert.equal(findAll(shell, (n) => n.props['data-option-id'] !== undefined).length, 6, '六格选项都在壳里');
});

test('改不了时第三行只是一行字：没有选项、没有箭头、原因进 title', async () => {
  // 元素树要用会记录 createElement 的那个实例，默认 stub 一律返回 null。
  const row = rendered.__test.windowRow({
    t,
    name: 'Only In Base',
    value: '默认',
    size: undefined,
    editable: false,
    reason: '这个模型不在用户配置层，改不了上下文',
    open: false,
    failure: undefined,
    onToggle: () => {},
    onSelect: () => {},
  });
  assert.equal(row.type, 'button');
  assert.equal(row.props.disabled, true);
  assert.equal(row.props.className, 'ec-row');
  assert.equal(row.props.title, '这个模型不在用户配置层，改不了上下文');
  assert.equal(findAll(row, (n) => n.props['data-option-id'] !== undefined).length, 0, '不适用就不给选项');
  assert.equal(findAll(row, (n) => n.type === fakeChevron).length, 0, '不给箭头——那一行不能点开');
  assert.equal(textOf(row), '上下文长度默认');
});

test('findRowHost：从座位往上两层找面板容器', () => {
  const panel = { getAttribute: (name) => (name === 'role' ? 'group' : null) };
  const cell = { parentElement: panel };

  assert.equal(findRowHost({ closest: () => cell }), panel, 'role=group 就是宿主的面板容器');
  assert.equal(
    findRowHost({ closest: () => ({ parentElement: { getAttribute: () => 'menu' } }) }).getAttribute('role'),
    'menu',
    'role=menu 也认',
  );
  assert.equal(findRowHost({ closest: () => null }), null, '不在格子里就放弃');
  assert.equal(findRowHost({ closest: () => ({ parentElement: null }) }), null);
  assert.equal(findRowHost({ closest: () => ({ parentElement: { getAttribute: () => 'toolbar' } }) }), null, '父容器不是面板就不算');
  assert.equal(findRowHost(null), null, '还没挂载时也没有');
  assert.equal(findRowHost({}), null, '不是元素就没有 closest');
});

test('写入失败：错误行留在展开的列表末尾，不吞', async () => {
  resetHooks();
  const view = await readiedView();
  const settings = { mutate: async () => ({ ok: false, error: { message: '配置已被别处改动' } }) };
  const props = { provider: PROVIDER, model: SOL, placement: 'menu', settings, view, t };

  const after = await pickOption(props, '262144');
  const note = findAll(after, (n) => n.props.className === 'ec-note')[0];
  assert.ok(note !== undefined, '失败要留在展开态，否则错误行跟着列表一起没了');
  assert.equal(textOf(note), '写入失败：配置已被别处改动');
  assert.equal(findAll(after, (n) => n.props['data-option-id'] !== undefined).length, 6, '失败留在选项页');
});

test('写入成功后收起列表，不留下错误行，并把视图重读一遍', async () => {
  resetHooks();
  let reads = 0;
  const view = createView({
    describe: async () => {
      reads += 1;
      return { ok: true, value: { writable: true, namespaces: [{ ns: 'llm-pi-ai', revision: 3, user: VIEW.user, value: VIEW.value }] } };
    },
  });
  await view.load();
  const written = [];
  const settings = {
    mutate: async (ns, ops, revision) => {
      written.push({ ns, ops, revision });
      return { ok: true };
    },
  };
  const props = { provider: PROVIDER, model: SOL, placement: 'menu', settings, view, t };

  const after = await pickOption(props, '262144');

  assert.deepEqual(
    plain(written),
    [
      {
        ns: 'llm-pi-ai',
        revision: 3,
        ops: [{ op: 'set', path: ['providers', 'ziyong', 'models', '0', 'contextWindow'], value: 262144 }],
      },
    ],
    'maxTokens 128000 没超限，不跟着压',
  );
  assert.equal(reads, 2, '写完之后重读一次');
  assert.equal(findAll(after, (n) => n.props.className === 'ec-note').length, 0, '成功不留错误行');
  assert.equal(headOf(after).props['aria-expanded'], false, '成功就收起');
});

test('选中「默认」发的是两个 unset', async () => {
  resetHooks();
  const view = await readiedView();
  const written = [];
  const settings = { mutate: async (ns, ops) => void written.push(ops) ?? { ok: true } };
  const props = { provider: PROVIDER, model: SOL, placement: 'menu', settings, view, t };
  await pickOption(props, 'default');
  assert.deepEqual(plain(written[0]), [
    { op: 'unset', path: ['providers', 'ziyong', 'models', '0', 'contextWindow'] },
    { op: 'unset', path: ['providers', 'ziyong', 'models', '0', 'maxTokens'] },
  ]);
});

test('没设过窗口的模型：第三行显示默认，选中梯子下发 set', async () => {
  resetHooks();
  const view = await readiedView();
  const written = [];
  const settings = { mutate: async (ns, ops) => void written.push(ops) ?? { ok: true } };
  const props = { provider: PROVIDER, model: FLASH, placement: 'menu', settings, view, t };

  assert.equal(textOf(headOf(mountInPanel(props))), '上下文长度默认');

  await pickOption(props, '524288');
  assert.deepEqual(plain(written[0]), [
    { op: 'set', path: ['providers', 'ziyong', 'models', '1', 'contextWindow'], value: 524288 },
  ]);
});
//#endregion
