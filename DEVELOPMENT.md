# 实现说明

面向改这个插件的人。用户文档在 [README.md](README.md)。

名字说的是"模型选择器变好了"，但**真正决定档位对错的在主机半边**：它去本机 `app.asar` 里读官方目录，
按官方范围改配置；浏览器半边只是把结果画出来，另外多给一行「上下文长度」。
所以 asar 找不到、插件被停用的时候，选择器看着还在，档位却是错的——这是两个半边的关系。

## 行为契约

1. **只抄官方范围**：档位集合与发送值来自 pi-ai 内置的 `thinkingLevelMap`，容量来自同一条记录的 `contextWindow` / `maxTokens`，不做任何推断性补档或倍增。
2. **同名多通道取众数**：官方目录里同一模型常有多个通道版本（`deepseek-v4-pro` 有 8 条），票数最多的签名胜出；平局取交集；交集为空则不动。
3. **认不出就不动**：官方目录里没有、族内档位又互相矛盾的模型，保持配置原样，不猜。
4. **不发网络请求**：数据全部来自本机 app.asar，插件运行期零请求。

配套的编辑约束：

- 只改目标模型的 `reasoningEfforts` 块与 `contextWindow` / `maxTokens` 两行，`compat` / `input` / `name` / 注释逐字节保留
- 写盘前回读校验（provider / 模型数必须不变），并自动备份最近 5 份
- 幂等：同一份配置跑第二遍零改动

## 两个维度各自的策略

| 维度 | 默认 | 可选 | 为什么 |
|---|---|---|---|
| 档位 `reasoningEfforts` | `catalog` | `fill` | 手抄模板普遍偏宽（34 个模型共用一套五档），按官方重写才对得上 |
| 容量 `contextWindow` / `maxTokens` | **`off`** | `fill` / `catalog` | 官方动辄报 1M / 1050000，但多数中转网关实际只服务 256K，写大了直接 400 或静默截断。dsh 自己的 262144 默认值反而最通用 |

## 数据从哪来

`<DSH 安装目录>/resources/app.asar` 内的 `@earendil-works/pi-ai/dist/providers/data/*.json`
（43 个通道、本机实测 1650 条模型）。

找 asar 的顺序：插件配置的 `asarPath` > `DSH_ASAR_PATH` > Electron 的 `resourcesPath` >
命令行参数（桌面版用 `electron host.js <app.asar> …` 起宿主进程，asar 就在 argv 里）>
可执行文件旁边的 `resources/app.asar` > 工作目录往上找。都不中才停用，并把试过的位置打进日志。

## 匹配顺序

| 顺序 | 方式 | 例子 |
|---|---|---|
| 1 | 原 id 精确 | `gpt-6.1-sol` |
| 2 | 归一化后精确 | `[free]deepseek-v4.1-flash` → `deepseek-v4.1-flash`；`z-ai/glm-5.3` → `glm-5.3`；`deepseek-v4.1-flash-coding` 剥掉 `-coding` |
| 3 | 家族回退（同族同版本、且族内多数签名一致） | `deepseek-v4.1-flash-1017` → 借 `deepseek-v4.1-flash` |
| 4 | 都不中 | 保持原样，日志点名 |

## 界面：模型面板的第三行

宿主的根面板本来是两行：**模型** / **推理等级**（`model-selection-client.js` 里两格
`button.cell[role="menuitem"]` 硬编码在 JSX，没有任何座位能往里加第三格）。
所以插件挂在**模型选择器自己声明、自己渲染**的标题座位
`conversation.input.model.label`（`kind: single`、`inline: true`、scope `session`），
在 `menu` 那一路往上爬两层拿到面板容器，把「上下文长度」这一行 `createPortal` 到末尾：

```
MenuSurface(role=group)        ← findRowHost() 往上两层
├─ button.cell「模型」          ← 座位在它的 .cellValue 里面
├─ button.cell「推理等级」
└─ span.ec-row-slot            ← 插件 portal 进来的第三行 / 展开后是整页选项
```

点第三行会发生什么，**照搬宿主的「推理等级」**（`drill("effort")` → `setPane("effort")`，
见 `model-selection-client.js:1346` / `:1687`）：同一面板里**整页替换**，不是在面板上叠一层浮层。

| | 收起（root 页） | 展开（选项页） |
|---|---|---|
| 面板里有什么 | 模型 / 推理等级 / 上下文长度 三行 | 只剩上下文选项 |
| 第三行本身 | `.ec-row`（照抄 `.cell`） | **退场** |
| 选项行 | — | `.ec-option`（照抄 `.option`） |
| Escape | 宿主关面板 | **退一级**：收回 root 页（宿主 `back()` 同义） |

换页不是我们的 state：`pane` 是宿主的。插件只给面板加一个 `ec-paging` 类，
CSS `.ec-paging > [role="menuitem"]{display:none}` 把 root 页那两格藏掉——
**收起或卸载时一定摘掉**，否则面板再打开就永远只剩选项。

| `placement` | 位置 | 渲染成什么 |
|---|---|---|
| `trigger` | 收起的那个按钮 | 只有模型名 |
| `menu` | 根面板「模型」那一格 | 模型名（填满这一格），外加第三行 |
| `option` | 模型列表的每一行 | 只有模型名——那一行的点击是「选这个模型」，不该挂第二个控件 |

| 项 | 说明 |
|---|---|
| 行样式 | 收起那一行逐条照抄 `.cell`：`height:34px` / `padding:0 8px` / `gap:6px` / `13-20px` / `--dsw-radius-md`；值用 `--dsw-alias-label-tertiary`、箭头用 `--dsw-alias-menu-icon` |
| 选项样式 | 逐条照抄 `.option`：`min-height:34px` / `padding:5px 7px` / `optionCopy > modelName` / 右端 `.check` 14px；`busy` 时 `disabled` |
| 选项 | 默认 / 262K / 524K / 1M / 2.1M —— **低于 262K 不列**：那是 dsh 自己的默认窗口以下，调小没有意义 |
| 写入 | 只改**这一个模型**的 `models.<i>.contextWindow`；`maxTokens` 仅在超过所选窗口时跟着压 |
| 「默认」 | 两个字段都 unset，回到 dsh 的默认窗口（`defaultContextWindow` 是可配置的，所以不写死具体值） |
| 生效 | 立即写官方 settings 文档（`llm-pi-ai` 命名空间），带 revision 校验，无需重启 |
| 不可写时 | **不渲染控件**，只留一行纯文本 + `title` 说明原因（用户配置层没有该模型的 `models` 数组，或整份设置只读） |
| 写入失败 | 错误行留在选项页末尾（`.ec-note`），不静默吞掉；失败**不收起**，否则错误跟着选项一起没了 |
| 焦点 | 展开后落在第一个选项上，收起后回到第三行（宿主 drill 后也是把焦点交给新页第一个 item） |

两句容易误解的地方：

- **数字口径跟宿主一致，不是 1024 进制**。宿主 `ui-conversation` 的 `formatTokens` 是十进制、≥100 取整，
  所以 `262144` 显示成 `262K`（不是 `256K`）、`1048576` 显示成 `1M`（不是 `1.05M`）。
  不这么写的话，同一个数字会在上下文用量表和这里显示成两个值。配置里写的仍是 2 的幂，选项 id 也是原值。
- **非梯子上的值会原样多列一行**（比如之前用 `--capacity catalog` 补进来的 `1050000` → `1.1M`），
  选它写回去的还是 `1050000`，不四舍五入。

占了这个座位以后，`renderSlot(..., { fallback: model.name })` 的兜底**不再生效**，
所以模型名由本插件画出来。设置读不出来、模型对不上、认不下面板容器，都只降级成
「名字 [+ 一行灰字]」，绝不让名字消失，也绝不画一个点不动的置灰控件。

### 为什么 portal，而不是并排再加一格

| 座位 | 类型 | 能不能用 |
|---|---|---|
| `conversation.input.model` | `single` | 内置选择器占着，抢了等于把整个选择器重写一遍 |
| `conversation.input.right` | `list` | 能共存，但那是「并排第二个控件」，不是增强 |
| `conversation.input.model.label` | `single` / `inline` | 选择器自己声明、自己调 `renderSlot`，位置就在模型名旁边 |

`single` 座位只容一个占位者（同优先级会抛错），所以这是"接进那个选择器"而不是"再造一个"。
座位已经被别人占了的话，宿主给的规则是**最低优先级那条渲染**，所以本插件会退到 `priority: -1`
顶上去（模型名本来就是我们画的，少它只是少个上下文开关），并在日志里点名占位者是谁，不静默盖掉。

六个坑，都在代码里挡掉了：

- **手势会"穿越"到宿主那一格**：座位长在「模型」那一格**里面**
  （`button.cell[role=menuitem]` → `.cellValue` → `span[data-provider-id]` → 座位），
  而 React 的合成事件沿**组件树**冒泡、不沿 DOM 树。所以第三行哪怕 portal 到了面板末尾，
  点它还是会把事件送回那一格的 `onClick: drill("model")`，面板直接跳进模型列表——
  表现就是"点上下文长度，进了模型选择"。拦截挂在**第三行自己的外壳**（`span.ec-row-slot`）上，
  **不能挂在座位那一层**：那一层里写着模型名，挂了连「点模型名进模型列表」都会被吃掉
  （宿主是整格可点，点文字、点空白、点箭头都算）。
- **Escape 的语义**：宿主 `onRootKeyDown` 在非 root 页按 Escape 是 `back()`
  （退一级回到 root），只有 root 页才关面板。所以选项页里我们自己接住 Escape 并
  `stopPropagation`，否则会直接关掉整个面板，比宿主"更狠"。
- **点外关闭**：宿主 `closeOutside` 听在 `document` 的 `mousedown` 上，外壳那层 `stopPropagation`
  顺带拦住它——点自己的行和选项不会关掉面板。**注意别用 `document` 捕获阶段去拦**：
  React 18 的监听器挂在根容器上，在 `document` 上截断会让 React 根本收不到事件。
- **认不出容器就不塞**：容器不是 `role=group|menu` 就退回行内「名字 + 灰字」，
  宁可少一行，也不往 `body` 上挂一块悬空的残片。
- **容器要在 commit 阶段就拿到**：用 `useEffect` 取容器会晚一帧——宿主先按「模型 / 推理等级」
  两行量好位置、摆上面板，第三行才挂进去，于是"菜单先出现在别处，再跳到正确位置"。
  改用 ref 回调（`span.ec-label` 上的 `ref`）在 commit 里 `setHost`，同一个绘制周期里
  第三行就已经在面板里，宿主量到的高度是对的。
- **`settings/mutate` 的 `ops[].path` 每一项都必须是字符串**：它的 strict codec 是
  `{ op: "set"|"unset", path: string[], value? }`，模型下标写成 `number` 会被 typert 的
  boundary validation 打回（`wire field "ops" failed boundary validation`），
  所以下标是 `String(index)`，不是 `index`。

### 档位为什么不动

模型选择器显示的档位不是它自己写死的，而是宿主按配置算出来的：

```
providers.<id>.models[].reasoningEfforts
  → getSupportedThinkingLevels(model)          ← llm-pi-ai
  → reasoning: { efforts: [...], defaultEffort }
  → 对话栏下拉的档位列表
```

所以宿主侧把 `reasoningEfforts` 按官方目录写对之后，那个选择器自己就变成
「每个模型只给自己那几档」。界面上不需要第二个档位控件，重写它只会把一条本来正确的链路再实现一遍。

`xhigh` / `max` 这类档位有个额外条件：必须在 `thinkingLevelMap` 里**有键**才出现
（`llm-pi-ai-asar.js:776`：`if (level === "xhigh" || level === "max") return mapped !== void 0`），
光把 `efforts` 列进去是不够的。

## 手工排查

```sh
node bin/sync.mjs --patch <cordis.patch.yml> --dry-run --explain   # 逐模型看会怎么改
node bin/sync.mjs --patch <cordis.patch.yml>                       # 真正写入
node bin/sync.mjs --patch <...> --capacity fill                    # 想把官方窗口也补上时才开
node bin/sync.mjs --patch <...> --demote                           # 官方说「没档位」的写成 false
```

`--explain` 每行末尾标注来源：`exact` / `normalized` / `family`。

## 测试

```sh
npm test                                        # 全部契约测试
DSH_ASAR_PATH=<...>/resources/app.asar npm test # 额外跑数据源冒烟测试，默认跳过的两条会跑起来
```

客户端 `lib/client.js` 是浏览器 IIFE（`window.__ModuleLoader__`），测试用 `vm` 造一个假宿主加载它，
所以不需要真 DSH。默认跳过的两条是必须读真 asar 的数据源用例，给了 `DSH_ASAR_PATH` 才会跑。

新增或改行为时先写断言再加实现；界面与写入的断言在 `tests/client.test.mjs`，
配置改写在 `tests/sync.test.mjs` / `tests/patch.test.mjs`，匹配规则在 `tests/match.test.mjs`。
