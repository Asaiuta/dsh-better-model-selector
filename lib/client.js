window.__ModuleLoader__.load({
	id: "dsh-better-model-selector",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		/** 插件的两行要挂进宿主的面板容器，得用 portal。 */
		const reactDom = require("react-dom");
		/** 宿主的 UI 基座：菜单、图标都是它的，不自造。 */
		const ui = require("@deepseek-ai/dsh-client-ui-primitives");
		const e = react.createElement;

		/** 设置命名空间（写给 pi-ai 适配器的）。 */
		const SETTINGS_NS = "llm-pi-ai";
		/** 界面文案的字典命名空间。 */
		const LOCALE_NS = "dsh-better-model-selector";
		/** 模型选择器自己声明、自己渲染的标题座位——模型名由我们负责画。 */
		const LABEL_SEAT = "conversation.input.model.label";
		/** 本插件在座位上的 id，冲突时报错和自查都靠它认自己。 */
		const SEAT_ID = "better-selector-window";

		/**
		 * 上下文窗口的候选值：全是 2 的幂，网关认，配置里写的就是这些数。
		 * 不进官方目录、不猜——由主人按自己网关的实际能力选。
		 * 下限是 262144（dsh 自己的默认窗口）：比它还小的档位开着也没意义。
		 */
		const LADDER = [262144, 524288, 1048576, 2097152];

		/**
		 * 视觉开关写进 `input` 的两种取值（pi-ai 只认 text / image 两种模态）。
		 * 「默认」不在这里：它是把字段删掉，交回官方目录 / provider 的 `defaultInput`。
		 */
		const VISION_INPUT = { on: ["text", "image"], off: ["text"] };

		//#region 字典
		/** 简体中文（key 集的事实来源）。 */
		const zh = {
			"row.label": "上下文长度",
			"option.default": "默认",
			"option.unset": "默认",
			"option.aria": "{model} 的上下文长度，当前 {value}",
			"option.unwritable": "这个模型不在用户配置层，改不了上下文",
			"option.readonly": "设置只读，改不了上下文",
			"option.failed": "写入失败：{message}",
			"vision.label": "视觉",
			"vision.default": "默认",
			"vision.on": "支持",
			"vision.off": "不支持",
			"vision.aria": "{model} 是否支持视觉，当前 {value}",
			"vision.unwritable": "这个模型不在用户配置层，改不了视觉",
			"vision.readonly": "设置只读，改不了视觉",
			"number.thousand": "{value}K",
			"number.million": "{value}M",
		};
		/** 英文，逐条对齐 zh 的 key 集。 */
		const en = {
			"row.label": "Context length",
			"option.default": "Default",
			"option.unset": "Default",
			"option.aria": "Context length of {model}, currently {value}",
			"option.unwritable": "This model is not in the user config layer, so its context length cannot be changed",
			"option.readonly": "Settings are read-only, so the context length cannot be changed",
			"option.failed": "Write failed: {message}",
			"vision.label": "Vision",
			"vision.default": "Default",
			"vision.on": "Supported",
			"vision.off": "Not supported",
			"vision.aria": "Vision support of {model}, currently {value}",
			"vision.unwritable": "This model is not in the user config layer, so its vision support cannot be changed",
			"vision.readonly": "Settings are read-only, so vision support cannot be changed",
			"number.thousand": "{value}K",
			"number.million": "{value}M",
		};
		//#endregion

		//#region 纯函数
		/** 沿普通对象走一段路径；数组或非对象立刻返回 undefined。 */
		function readAt(section, path) {
			let current = section;
			for (const key of path) {
				if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
				current = current[key];
			}
			return current;
		}

		/**
		 * 容量数字 → 262K / 1M。
		 *
		 * 与宿主 `ui-conversation` 的 `formatTokens` 同一套口径：十进制，≥100 取整。
		 * 不这么写的话，同一个 262144 会在上下文用量表和这里显示成两个数（256K vs 262K）。
		 */
		function formatTokens(value, t) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
			const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
			if (value < 1e3) return String(value);
			if (value < 1e6) return t("number.thousand", { value: scaled(value / 1e3) });
			return t("number.million", { value: scaled(value / 1e6) });
		}

		/** 失败信封 → 一行字。 */
		function failureText(error) {
			if (error === undefined || error === null) return "未知错误";
			return typeof error.message === "string" && error.message.length > 0 ? error.message : String(error.code ?? error);
		}

		/**
		 * 在设置视图里定位一个模型条目。
		 *
		 * 写下标必须落在**用户层**数组上：`models` 是整段替换式解析，用户层没有
		 * 这个数组时按解析后的下标写会落到 base 层之外，所以那种情况直接判不可写。
		 * @returns {{index: number, contextWindow?: number, maxTokens?: number, input?: string[]}|undefined}
		 */
		function locateModel(view, providerId, modelId) {
			if (typeof providerId !== "string" || typeof modelId !== "string") return undefined;
			const base = ["providers", providerId, "models"];
			const userModels = readAt(view.user, base);
			const effective = Array.isArray(userModels) ? userModels : readAt(view.value, base);
			if (!Array.isArray(userModels) || !Array.isArray(effective)) return undefined;
			const index = userModels.findIndex((item) => typeof item === "object" && item !== null && item.id === modelId);
			if (index < 0) return undefined;
			const entry = effective[index];
			const contextWindow = typeof entry?.contextWindow === "number" ? entry.contextWindow : undefined;
			const maxTokens = typeof entry?.maxTokens === "number" ? entry.maxTokens : undefined;
			const input = Array.isArray(entry?.input) ? entry.input : undefined;
			return { index, contextWindow, maxTokens, input };
		}

		/**
		 * 写入计划：把当前模型的窗口切到 cap。
		 * maxTokens 只在超过 cap 时跟着压，永远不往上抬。
		 */
		function windowOpsOf(providerId, index, cap, maxTokens) {
			// 下标必须是**字符串**：`settings/mutate` 的 ops schema 是
			// `{op:"set"|"unset", path: string[], value?}`，strict codec 的 path 是
			// `array of string`，塞 number 会被 typert 的 boundary validation 打回
			// （就是那条 `wire field "ops" failed boundary validation`）。
			const path = ["providers", providerId, "models", String(index)];
			const ops = [{ op: "set", path: [...path, "contextWindow"], value: cap }];
			if (typeof maxTokens === "number" && maxTokens > cap) ops.push({ op: "set", path: [...path, "maxTokens"], value: cap });
			return ops;
		}

		/** 「默认」的写入计划：把两个字段都交回去，dsh 用自己的默认窗口。 */
		function defaultOpsOf(providerId, index) {
			const path = ["providers", providerId, "models", String(index)];
			return [
				{ op: "unset", path: [...path, "contextWindow"] },
				{ op: "unset", path: [...path, "maxTokens"] },
			];
		}

		/** 菜单里选中的那一行：不是梯子上的值就原样带着，绝不四舍五入。 */
		function chipValueOf(contextWindow) {
			return typeof contextWindow === "number" ? String(contextWindow) : "default";
		}

		/**
		 * 菜单的全部行（宿主的 Menu 吃 `{ id, label }` 数据行）。
		 * 非梯子上的值（比如官方目录补进来的 1050000）单独列一行，不去改写它。
		 */
		function optionsOf(contextWindow, t) {
			const rows = [{ id: "default", label: t("option.default") }];
			if (typeof contextWindow === "number" && !LADDER.includes(contextWindow)) {
				rows.push({ id: String(contextWindow), label: formatTokens(contextWindow, t) });
			}
			for (const value of LADDER) rows.push({ id: String(value), label: formatTokens(value, t) });
			return rows;
		}

		/**
		 * 当前模型的视觉选项。
		 *
		 * 空数组和不写同义：宿主 `declaredInput` 都当「没表态」，往官方目录、再往
		 * provider 的 `defaultInput` 问下去——所以都算「默认」。写了就看有没有 image。
		 */
		function visionChoiceOf(input) {
			if (!Array.isArray(input) || input.length === 0) return "default";
			return input.includes("image") ? "on" : "off";
		}

		/** 视觉页的全部行。 */
		function visionOptionsOf(t) {
			return ["default", "on", "off"].map((id) => ({ id, label: t(`vision.${id}`) }));
		}

		/** 视觉的写入计划：支持 / 不支持写死 `input`，默认把它交回去。 */
		function visionOpsOf(providerId, index, choice) {
			const path = ["providers", providerId, "models", String(index), "input"];
			const input = VISION_INPUT[choice];
			return input === undefined ? [{ op: "unset", path }] : [{ op: "set", path, value: [...input] }];
		}
		//#endregion

		//#region 设置视图
		const IDLE = { status: "idle" };

		/**
		 * 一份共享的 llm-pi-ai 设置视图。
		 *
		 * 模型选择器会把标题座位渲染很多次（trigger 一次、根面板一次、每个模型行一次），
		 * 所以 `describe()` 只读一次，所有实例订阅同一个快照。
		 */
		function createView(settings) {
			let snapshot = IDLE;
			let inflight = null;
			const listeners = new Set();
			const publish = (next) => {
				snapshot = next;
				for (const listener of [...listeners]) listener();
			};
			const read = async () => {
				try {
					const described = await settings.describe();
					if (!described.ok) throw new Error(failureText(described.error));
					const view = described.value.namespaces.find((item) => item.ns === SETTINGS_NS);
					if (view === undefined) throw new Error(`设置里没有 ${SETTINGS_NS} 这一节`);
					publish({ status: "ready", view, writable: described.value.writable === true });
				} catch (error) {
					publish({ status: "failed", failure: error instanceof Error ? error.message : String(error) });
				}
				return snapshot;
			};
			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot() {
					return snapshot;
				},
				/** 读一次；已经有结果就不重复读。 */
				load() {
					if (inflight !== null) return inflight;
					if (snapshot.status === "ready") return Promise.resolve(snapshot);
					inflight = read().finally(() => {
						inflight = null;
					});
					return inflight;
				},
				/** 强制重读：自己写完盘、或别处改了文档之后。 */
				refresh() {
					if (inflight !== null) return inflight;
					inflight = read().finally(() => {
						inflight = null;
					});
					return inflight;
				},
			};
		}
		//#endregion

		//#region 组件
		/**
		 * 插件那几行的样式。全部照抄宿主 `.cell` 的实测值
		 * （ModelSelect.module.css：height 34 / padding 0 8 / gap 6 / 13-20 / radius md），
		 * 这样它跟「模型」「推理等级」两格排在一起是一套东西，而不是贴上去的一块。
		 */
		const css = [
			".ec-label{display:inline-flex;align-items:center;min-width:0;max-width:100%;vertical-align:middle}",
			".ec-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
			// 面板容器没认出来时的退路：退回「模型名 + 一行灰字」，和 triggerEffort 同一档色。
			".ec-dim{flex:none;margin-left:4px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}",
			// 外壳竖着排：收起时是插件的几行；展开时它们退场，换成整页选项。
			".ec-row-slot{display:flex;flex-direction:column;width:100%;min-width:100%}",
			".ec-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:auto;min-width:100%;height:34px;margin:0;padding:0 8px;font-family:inherit;font-size:13px;font-weight:400;line-height:20px;text-align:left;color:var(--dsw-alias-label-primary);background-color:transparent;border:none;border-radius:var(--dsw-radius-md);outline:none;cursor:pointer}",
			".ec-row:hover:not(:disabled),.ec-row:focus-visible{background-color:var(--dsw-alias-interactive-bg-hover)}",
			".ec-row:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".ec-row-label{flex:none;white-space:nowrap}",
			".ec-row-value{flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".ec-row-chevron{flex:none;width:12px;height:12px;color:var(--dsw-alias-menu-icon)}",
			// 下面这一组逐条照抄宿主 `.option` / `.optionCopy` / `.modelName` / `.check`
			// （ModelSelect.module.css）——它的「推理等级」页用的就是这几条，不是 `.cell`。
			".ec-option{box-sizing:border-box;width:auto;min-width:100%;min-height:34px;margin:0;padding:5px 7px;gap:6px;display:flex;align-items:center;border-radius:var(--dsw-radius-md);background-color:transparent;border:none;outline:none;color:inherit;font-family:inherit;font-size:13px;text-align:left;cursor:pointer}",
			".ec-option:hover:not(:disabled),.ec-option:focus-visible{background-color:var(--dsw-alias-interactive-bg-hover)}",
			".ec-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".ec-option-copy{flex:1;min-width:0;display:flex;flex-direction:column}",
			".ec-option-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px}",
			".ec-option-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary)}",
			".ec-option-check svg{width:14px;height:14px}",
			// 展开时把宿主 root 页那两格藏掉——这就是「换页」，不是往下长。
			".ec-paging > [role='menuitem']{display:none}",
			".ec-note{padding:2px 7px 6px;font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}",
		].join("");

		const TAG = "dsh-better-model-selector/window.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-better-model-selector";
			tag.dataset.pluginCss = TAG;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/**
		 * 座位上的占位者，一行摘要。
		 *
		 * `single` 座位同一优先级只允许一个占位者，占了就直接抛错，而抛出的错误里
		 * 只有 `registered by Gb` 这个名字——那是槽位服务提供者的 fiber 名，不是
		 * 真正占位的人。所以冲突时自己去翻快照，把 id 和优先级写进日志。
		 */
		function occupantSummary(slots, seat) {
			try {
				const roots = slots.snapshot(seat);
				const occupants = Array.isArray(roots) ? roots[0]?.occupants : undefined;
				if (!Array.isArray(occupants) || occupants.length === 0) return "读不到占位者";
				return occupants
					.map((item) =>
						[
							item.id ?? "(无 id)",
							`priority ${item.priority}`,
							item.registrant === undefined ? undefined : `by ${item.registrant}`,
							item.active === false ? "已让位" : undefined,
						]
							.filter((part) => part !== undefined)
							.join(" "),
					)
					.join(" / ");
			} catch (error) {
				// 不用 instanceof Error：跨 realm 抛过来的错误过不了这条判断。
				const message = typeof error?.message === "string" && error.message.length > 0 ? error.message : String(error);
				return `读占位者失败：${message}`;
			}
		}

		/**
		 * 从座位找到宿主的面板容器。
		 *
		 * 座位只落在「模型」那一格**里面**，宿主的根面板是「模型 / 推理等级」两格
		 * 硬编码在 JSX 里的，没有任何座位可以往里加第三格。所以往上爬两层：
		 * 座位 → 那一格 `[role="menuitem"]` → 面板容器（`role` 是 group 或 menu 的
		 * flex 列）。拿到容器就能把自己那几行 portal 到末尾，成为第三、四行。
		 *
		 * 认不出容器就返回 null，调用方退回行内文字，不硬塞。
		 */
		function findRowHost(slot) {
			const cell = typeof slot?.closest === "function" ? slot.closest('[role="menuitem"]') : null;
			const parent = cell === null || cell === undefined ? null : cell.parentElement;
			if (parent === null || parent === undefined || typeof parent.getAttribute !== "function") return null;
			const role = parent.getAttribute("role");
			return role === "group" || role === "menu" ? parent : null;
		}

		/**
		 * 换页：给宿主的面板容器加/去一个类，CSS 负责把 root 页那两格藏起来。
		 *
		 * 宿主的 pane 是它自己的 state（`drill("effort")` → `setPane`），插件进不去。
		 * 但「换页」的外观只是「panel 里只剩选项」——加一个类就够，且随时能撤。
		 */
		function applyPaging(host, on) {
			if (host === null || host === undefined) return;
			const list = host.classList;
			if (list === undefined || list === null) return;
			if (on) list.add("ec-paging");
			else list.remove("ec-paging");
		}

		/** 模型名。座位被占了以后 fallback 不再生效，名字只能我们自己画。 */
		function nameOf(model) {
			if (typeof model !== "object" || model === null) return "";
			return typeof model.name === "string" && model.name.length > 0 ? model.name : String(model.id ?? "");
		}

		/**
		 * 插件挂进面板的那几行（上下文长度 / 视觉）的元素树。
		 *
		 * 抽成纯函数只为一件事：不依赖真实 DOM 也能验它的形状——「不可写就不给可点的
		 * 东西」「收起时每项只有一行」「展开时整页都是那一项的选项」。
		 *
		 * **跟宿主「推理等级」那一页对齐**（`model-selection-client.js:1687-1720`）：
		 * 它是 `drill("effort")` → `setPane("effort")`，同一面板里**整页替换**，
		 * 选项用 `.option`（`min-height:34px` / `padding:5px 7px` / `optionCopy>modelName` /
		 * 右端 14px 的 `.check`），`busy` 时 `disabled`。所以这里也做成换页：
		 * 展开时这几行全部退场、只剩选项；`Escape` 退一级（收起），跟宿主的 `back()` 同义。
		 *
		 * @param context - 行描述（`rows`）、当前页（`page` 是展开的那一行 id，收起为 null）与回调。
		 * @returns 外层壳：收起时是几行可点的行，展开时是整页选项。壳负责拦手势。
		 */
		function panelRows(context) {
			const { t, rows, editable, page, failure, busy, shellRef, onPage, onSelect } = context;
			const current = rows.find((row) => row.id === page);

			// 这几行的 fiber 挂在「模型」那一格底下，手势得在自己这一层截住：
			// 冒泡到那一格就是 drill("model")，面板会直接跳进模型列表。
			const hold = (event) => {
				event.stopPropagation();
			};

			const shell = (children) =>
				e(
					"span",
					{
						ref: shellRef,
						className: "ec-row-slot",
						onPointerDown: hold,
						onMouseDown: hold,
						onClick: hold,
						onKeyDown: (event) => {
							// 宿主在非 root 页按 Escape 是 back()，不是关面板；这里等价于收起。
							if (current !== undefined && event.key === "Escape") {
								event.stopPropagation();
								event.preventDefault();
								onPage(null);
								return;
							}
							if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
							const root = event.currentTarget;
							if (root === null || root === undefined || typeof root.querySelectorAll !== "function") return;
							const items = Array.from(root.querySelectorAll("button:not(:disabled)"));
							if (items.length === 0) return;
							const at = items.indexOf(document.activeElement);
							const step = event.key === "ArrowDown" ? 1 : -1;
							let next;
							if (current !== undefined) {
								// 选项页里循环走。不拦的话会冒到宿主的 onRootKeyDown，
								// 它的 moveFocus 会去聚焦被藏起来的那两格（看不见还抢焦点）。
								next = items[at === -1 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length];
							} else {
								// 收起时只在自己这几行之间走；走到头不拦，交还宿主。
								next = at === -1 ? undefined : items[at + step];
								if (next === undefined) return;
							}
							event.preventDefault();
							event.stopPropagation();
							next.focus();
						},
					},
					...children,
				);

			if (current === undefined) {
				return shell(
					rows.map((row) => {
						const parts = [e("span", { className: "ec-row-label" }, row.label), e("span", { className: "ec-row-value" }, row.value)];
						// 改不了就只摆一行字：宿主的规矩是不适用就不给可点的东西（它的 trigger
						// 只在 locked 时 disable，那是有别的操作被打断；这里压根没有操作）。
						if (!editable) return e("button", { type: "button", className: "ec-row", "data-row-id": row.id, disabled: true, title: row.reason }, ...parts);
						return e(
							"button",
							{
								type: "button",
								className: "ec-row",
								"data-row-id": row.id,
								"aria-expanded": false,
								"aria-label": row.aria,
								onClick: () => {
									onPage(row.id);
								},
							},
							...parts,
							e(ui.IconChevronDownOutlineRegular, { className: "ec-row-chevron" }),
						);
					}),
				);
			}

			// 换页：只剩选项，和宿主 effort 页同构。
			const options = current.options.map((option) =>
				e(
					"button",
					{
						type: "button",
						className: "ec-option",
						role: "menuitemradio",
						"aria-checked": option.id === current.selectedId,
						"data-option-id": option.id,
						disabled: busy === true,
						onClick: () => {
							onSelect(current.id, option.id);
						},
					},
					e("span", { className: "ec-option-copy" }, e("span", { className: "ec-option-name" }, option.label)),
					e("span", { className: "ec-option-check" }, option.id === current.selectedId ? e(ui.IconCheckOutlineRegular) : null),
				),
			);

			return shell([...options, failure === undefined ? null : e("div", { className: "ec-note" }, t("option.failed", { message: failure }))]);
		}

		/**
		 * 模型标题座位。
		 *
		 * 三个位置各司其职：trigger 和模型行照旧只画名字（宿主自己会显示推理等级）；
		 * 根面板那一格画名字，另外把「上下文长度」「视觉」两行挂到面板末尾。
		 *
		 * 档位不在这里：模型选择器直接从 `reasoningEfforts` 算出档位表，
		 * 配置写对了它就对了。
		 */
		function ModelLabel(props) {
			const model = props.model;
			const provider = props.provider;
			const placement = props.placement;
			const settings = props.settings;
			const view = props.view;
			const t = props.t;

			const state = react.useSyncExternalStore(view.subscribe, view.getSnapshot);
			/** 展开的是哪一行（"window" / "vision"），收起时为 null。 */
			const [page, setPage] = react.useState(null);
			const [failure, setFailure] = react.useState(undefined);
			const [busy, setBusy] = react.useState(false);
			const [host, setHost] = react.useState(null);
			const slotRef = react.useRef(null);
			const shellRef = react.useRef(null);

			react.useEffect(() => {
				view.load();
			}, [view]);

			// 面板容器要**尽早**拿到，所以用 ref 回调而不是 useEffect。
			//
			// useEffect 在绘制之后跑：宿主的菜单第一帧只量到「模型 / 推理等级」两行，
			// 等插件的行挂上去再靠 rAF 的 place() 重算，位置就变了——表现是
			// 「菜单先出现在别处，再跳到正确位置」。ref 回调在 commit 阶段，
			// 同一个绘制周期里就能把这几行挂进面板，宿主量的高度是对的。
			const attach = (node) => {
				slotRef.current = node;
				if (node === null || placement !== "menu") return;
				const found = findRowHost(node);
				if (found !== null && found !== host) setHost(found);
			};

			// 展开就是换页：给宿主的面板加一个类，CSS 把 root 页那两格藏掉。
			// 卸载时一定要摘掉，否则面板关掉再打开，模型和推理等级那两行就永远不见了。
			react.useEffect(() => {
				applyPaging(host, page !== null);
				return () => applyPaging(host, false);
			}, [host, page]);

			// 焦点跟着页面走：换页后落在第一个选项上，收起后回到刚才点开的那一行。
			// 宿主 drill 之后也是把焦点交给新页第一个 item（paneFocus / itemRef）。
			const lastPage = react.useRef(null);
			react.useEffect(() => {
				const target = shellRef.current;
				if (target !== null && typeof target.querySelector === "function") {
					const next = page !== null ? target.querySelector("button:not(:disabled)") : lastPage.current !== null ? target.querySelector(`[data-row-id="${lastPage.current}"]`) : null;
					if (next !== null) next.focus();
				}
				lastPage.current = page;
			}, [page]);

			// 手势拦截**不挂在这一层**：座位长在「模型」那一格的 `.cellValue` 里，还写着
			// 模型名——挂上去连「点模型名进模型列表」都会被吃掉（宿主的官方行为是整格可点）。
			// React 的合成事件沿**组件树**冒泡，所以拦截放在 `panelRows` 的外壳上，
			// 那里只覆盖插件的几行和它们的选项页，碰不到模型名。

			const name = nameOf(model);
			const providerId = typeof provider?.id === "string" ? provider.id : undefined;
			const modelId = typeof model?.id === "string" ? model.id : undefined;
			const ready = state.status === "ready" || (state.status === "loading" && state.view !== undefined);
			const located = ready ? locateModel(state.view, providerId, modelId) : undefined;
			const size = located?.contextWindow;
			const value = !ready ? "—" : size === undefined ? t("option.unset") : formatTokens(size, t);
			const vision = visionChoiceOf(located?.input);
			const visionValue = !ready ? "—" : t(`vision.${vision}`);
			const editable = ready && state.writable === true && located !== undefined && !busy;
			const blocked = failure ?? (state.status === "failed" ? state.failure : undefined);
			const reasonOf = (unwritable, readonly) => blocked ?? (located === undefined ? t(unwritable) : t(readonly));
			const reason = reasonOf("option.unwritable", "option.readonly");

			const choose = async (rowId, next) => {
				if (located === undefined || !ready) return;
				const ops =
					rowId === "vision"
						? visionOpsOf(providerId, located.index, next)
						: next === "default"
							? defaultOpsOf(providerId, located.index)
							: windowOpsOf(providerId, located.index, Number(next), located.maxTokens);
				setBusy(true);
				setFailure(undefined);
				try {
					const written = await settings.mutate(SETTINGS_NS, ops, state.view.revision);
					if (!written.ok) throw new Error(failureText(written.error));
					// 成功才收起。失败要留在展开态，否则错误行跟着列表一起没了。
					setPage(null);
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				} finally {
					await view.refresh();
					setBusy(false);
				}
			};

			const nameOnly = (ref) =>
				e("span", { className: "ec-label", ref }, e("span", { className: "ec-name" }, name));

			// 触发按钮和模型行都只画名字：那一格/那一行的点击各有各的用途。
			if (placement !== "menu") return nameOnly(undefined);

			// 认不出面板容器就别硬塞：退回原样（名字 + 一行灰字），多少还看得见值。
			if (host === null) {
				return e(
					"span",
					{ className: "ec-label", ref: attach },
					e("span", { className: "ec-name" }, name),
					e("span", { className: "ec-dim", title: reason }, value),
				);
			}

			const row = panelRows({
				t,
				rows: [
					{
						id: "window",
						label: t("row.label"),
						value,
						aria: t("option.aria", { model: name, value }),
						reason,
						options: optionsOf(size, t),
						selectedId: chipValueOf(size),
					},
					{
						id: "vision",
						label: t("vision.label"),
						value: visionValue,
						aria: t("vision.aria", { model: name, value: visionValue }),
						reason: reasonOf("vision.unwritable", "vision.readonly"),
						options: visionOptionsOf(t),
						selectedId: vision,
					},
				],
				editable,
				page,
				failure,
				busy,
				shellRef,
				onPage: (next) => {
					// 换页就把上一页的错误丢掉，别让它跟到另一项的选项页里。
					setFailure(undefined);
					setPage(next);
				},
				onSelect: (rowId, optionId) => {
					choose(rowId, optionId);
				},
			});

			return e(
				"span",
				{ className: "ec-label", ref: attach },
				e("span", { className: "ec-name" }, name),
				reactDom.createPortal(row, host),
			);
		}
		//#endregion

		const inject = ["slots", "locale", "remote", "remote.settings"];

		/** 客户端插件体：把「上下文长度」「视觉」挂成模型面板的第三、四行。 */
		function apply(ctx) {
			const settings = ctx.get("remote").settings;
			const t = ctx.locale.bind(LOCALE_NS);
			const view = createView(settings);

			ctx.effect(() => {
				try {
					return ctx.locale.register(LOCALE_NS, { zh, en });
				} catch (error) {
					try {
						console.error("[better-selector] 字典注册失败", error);
					} catch {}
					return () => {};
				}
			}, "better-selector: dictionaries");

			ctx.effect(() => {
				try {
					return ctx.remote.$on("settings/document-updated", (ns) => {
						if (ns === SETTINGS_NS) view.refresh();
					});
				} catch {
					return () => {};
				}
			}, "better-selector: settings document events");

			ctx.inject(["slots"], (scope) => {
				const claim = (priority) =>
					scope.slots.register(
						{
							name: LABEL_SEAT,
							id: SEAT_ID,
							priority,
							locale: LOCALE_NS,
							inject: () => ({ settings, view, t }),
						},
						ModelLabel,
					);

				scope.slots.inject(LABEL_SEAT, () => {
					try {
						const unregister = claim(0);
						return () => {
							unregister();
						};
					} catch (error) {
						// 座位被别人先占了。宿主的规则是「最低优先级的那条渲染」，
						// 所以退到 -1 顶上去，而不是干脆不出现——这一格的模型名
						// 我们自己画得出来，少它只是少个窗口开关。
						const taken = occupantSummary(scope.slots, LABEL_SEAT);
						try {
							const unregister = claim(-1);
							try {
								console.warn(`[better-selector] 模型标题座位已被占用（${taken}），改挂优先级 -1 顶替`);
							} catch {}
							return () => {
								unregister();
							};
						} catch (retry) {
							try {
								console.error(`[better-selector] 模型标题座位拒绝注册（${taken}）`, retry);
							} catch {}
							return () => {};
						}
					}
				});
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		/** 纯函数与组件出口，只给测试用；宿主侧不消费。 */
		exports.__test = { ModelLabel, locateModel, windowOpsOf, defaultOpsOf, chipValueOf, optionsOf, visionChoiceOf, visionOptionsOf, visionOpsOf, formatTokens, occupantSummary, findRowHost, applyPaging, panelRows, LADDER, VISION_INPUT, LABEL_SEAT, SEAT_ID, LOCALE_NS, SETTINGS_NS, zh, en, createView };
		return module.exports;
	},
});
