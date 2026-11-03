# dsh-better-model-selector

给 DSH 的模型选择器补上两样东西：**每个模型只给官方那几档推理等级**，和**一行「上下文长度」**。

自定义网关（中转站、自建反代）里的模型，DSH 不知道该怎么给档位：要么一套五档全给，要么干脆没有。
但 `sol` 只认 `low/medium/high/xhigh`，`deepseek` 只有 `high/max`，`gpt` 系列有的四个有的两个。
这个插件按 DSH **自带的官方模型目录**逐模型对齐，一档不多给。

上下文窗口则默认一个字都不改——中转站报的窗口常常比实际能给的大，写大了直接 400。
真要放大，在模型面板里现点一下，只影响当前这个模型，随时能退回默认。

## 装完是什么样

打开对话栏的模型选择器，根面板从两行变三行：

```
模型          gpt-6.1-sol      ›
推理等级      high             ›
上下文长度    默认              ›     ← 这一行是插件加的
```

点「上下文长度」是**整页替换**，和点「推理等级」的手感一致（不是在面板上再叠一层浮层）：

```
默认   ✓
262K
524K
1M
2.1M
```

| 选项 | 含义 |
|---|---|
| 默认 | 不写任何配置，用 DSH 自己的默认窗口 |
| 262K / 524K / 1M / 2.1M | 把这个模型的窗口设成这个值 |
| 更小的值 | **不列**——比 DSH 默认还小，调了没意义 |

三条使用上的约定：

- **选中立即生效**，不用重启，下一次请求就按新窗口算。
- **只改当前这一个模型**。同一个网关下的其他模型不动；只有 `maxTokens` 超过你选的窗口时，它才会跟着降下来。
- **按 `Esc` 退一级**：选项页回到三行，再按一次才关面板。

## 安装

```sh
cd ~/.dsh/profiles/desktop
pnpm add git+https://github.com/Asaiuta/dsh-better-model-selector.git
# 然后在 package.json 的 dsh.profile.bundles 里加上 "dsh-better-model-selector"
# 重启 DSH
```

本地改代码调试时换成 `pnpm add link:/path/to/dsh-better-model-selector`。

> 本插件**没有发布到 npm**：`dsh-better-model-selector` 这个名字在 npm 上已经属于另一个
> 同领域但实现不同的插件（[Khellendros97/dsh-better-model-selector](https://github.com/Khellendros97/dsh-better-model-selector)），
> 所以只从 GitHub 装。

装好之后日志里会有这么几行，可以拿来确认它在干活：

```
[better-selector] 官方目录已加载：1650 条（…/app.asar (43 个 provider 数据文件)）
[better-selector] 目标配置: …\profiles\desktop\cordis.patch.yml / 档位: catalog / 容量: off
[better-selector] 已更新 34 个模型（启动），备份 cordis.patch.yml.bak-better-selector-…
[better-selector] 官方不给档位的模型 3 个，配置保持原样: ziyong/MiniMax-M3, …
```

## 配置

在 `cordis.patch.yml` 里给插件加 config，全都可以省略：

```yaml
- id: better-selector
  config:
    mode: catalog        # 档位：catalog（默认，按官方重写）| fill（只补缺失）
    capacity: off        # 容量：off（默认，一个字段都不写）| fill（只补缺失）| catalog（按官方重写）
    demote: false        # 官方判定「无档位」时是否写 reasoningEfforts: false
    patchPath: null      # 不填则按 DSH_HOME/profiles/<profile> 推导
    backup: true
    watch: true          # 监听配置变化后自动同步
```

日常用默认值就行。**只有想让插件顺手把官方窗口也写进配置时才动 `capacity`**——多数网关撑不住官方报的数。

## 档位是怎么定的

数据来自 DSH 自带的官方模型目录（就在安装目录里），不是插件自己维护的表格。
DSH 升级时这份目录一起更新，所以**新模型发布后不用等插件发版**，重启一次就跟上了。

- 官方给过哪几档就写哪几档，不推断、不补档、不倍增。
- 同一个模型官方目录里有多条通道记录时，取票数最多的那套签名；平局取交集，交集为空就不动。
- 名字对不上时依次试：原 id → 去掉前缀后缀（`[free]`、`z-ai/`、`-coding`）→ 同族借用 → 都不中就保持原样，日志点名。
- **运行期零网络请求**，数据全在本机。

## 常见问题

**档位还是不对？** 先确认 DSH 重启过（配置和插件都只在启动时读一次）。其次看网关是否真的支持——
插件只保证"官方目录里这个模型有哪几档"，管不了中转站后端认不认。

**第三行的值显示「默认」，但实际窗口不是 262K？** 「默认」的意思是"这个模型没写过窗口配置"，
具体数值由 DSH 的 `defaultContextWindow` 决定，插件不写死也不显示它。

**第三行是灰字、点不动？** 两种情况：这个模型不在用户配置层（上层 `models` 数组里没有它的条目），
或者整份设置是只读的。悬停会显示具体原因。插件不会画一个点不动的控件骗你。

**想看它到底改了哪些行？** 日志里的 `[better-selector]` 前缀，或者手工跑一遍只看不写：

```sh
node bin/sync.mjs --patch <cordis.patch.yml> --dry-run --explain
```

每一行末尾会标出来源是 `exact` / `normalized` / `family`。

## 已知限制

- **官方口径不等于网关能力**。网关把 `gpt-5.6-sol` 接到只认 `high` 的后端，官方范围就会偏宽；
  官方报 1M、实际只给 256K 更常见。插件不探测端点（设计如此），所以窗口默认不动，交给你手选。
- **同族借用是推断**。`claude-fable-5-1-reversed` 这种官方没有的变体会借同代 Claude 的档位；
  不想要就删掉那一行，或者用 `mode: fill` 让它不再被改写。
- **只处理块序列写法的 `models`**。`models: []` 这种 flow 写法直接跳过并报错，不猜。
- **`compat` 一律不动**。档位范围对了，但网关若还需要 `thinkingFormat` / `supportsReasoningEffort`，仍要你自己配。

## 卸载

从 `bundles` 里删掉名字、`pnpm remove dsh-better-model-selector`、重启。

插件写进 `cordis.patch.yml` 的档位和窗口会留在原地（删掉它们，档位就回到"要么五档要么没有"的状态）。
改之前它自己备份了最近 5 份，文件名形如 `cordis.patch.yml.bak-better-selector-2026-11-03_10-42-45`，想还原直接拷回去。

## 开发

```sh
npm test                                        # 契约测试
DSH_ASAR_PATH=<...>/resources/app.asar npm test # 额外跑数据源冒烟测试
```

实现细节、宿主的接口边界、踩过的坑都记在 [DEVELOPMENT.md](DEVELOPMENT.md)。

---

MIT License
