import { i as __toESM } from "../_runtime.mjs";
import { R as require_react, _ as Link, y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as useFleet, r as useApp } from "./nodes-CLUeSZzE.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin-CHIRmN_c.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var KEY = "xf-admin-ok";
function Admin() {
	const [ok, setOk] = (0, import_react.useState)(() => typeof window !== "undefined" ? sessionStorage.getItem(KEY) === "1" : false);
	const [pin, setPin] = (0, import_react.useState)("");
	const orders = useApp((s) => s.orders);
	const person = useApp((s) => s.person);
	const mark = useApp((s) => s.markOrder);
	const [merchant, setMerchant] = (0, import_react.useState)("");
	const nodes = useFleet((s) => s.nodes);
	const patch = useFleet((s) => s.patch);
	if (!ok) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto grid min-h-screen max-w-sm place-content-center gap-3 px-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "font-[family-name:var(--font-display)] text-2xl font-semibold",
				children: "Панель"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: pin,
				onChange: (e) => setPin(e.target.value),
				className: "h-11 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3",
				placeholder: "ключ"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "glass-btn w-full",
				onClick: () => {
					if (pin.trim() === "malik") {
						sessionStorage.setItem(KEY, "1");
						setOk(true);
					}
				},
				children: "Войти"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "brand-link text-center text-sm",
				children: "назад"
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto h-dvh max-w-lg overflow-y-auto px-4 py-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mb-4 flex justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-[family-name:var(--font-display)] text-2xl font-semibold",
					children: "Админ"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/",
					className: "brand-link text-sm",
					children: "приложение"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mb-2 text-sm text-[var(--color-muted)]",
				children: "Сессия"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mb-6 font-mono text-xs text-[var(--color-muted)]",
				children: [
					person.city,
					", ",
					person.country,
					person.ip ? ` · ${person.ip}` : "",
					person.tgId ? ` · tg ${person.tgId}` : ""
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mb-2 text-sm text-[var(--color-muted)]",
				children: "Узлы"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mb-6 grid gap-3",
				children: nodes.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "grid gap-2 rounded-xl border border-[var(--color-line)] px-3 py-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-sm",
							children: [
								n.city,
								" · ",
								n.id
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							defaultValue: n.host,
							placeholder: "хост",
							onBlur: (e) => patch(n.id, { host: e.target.value.trim() }),
							className: "h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							defaultValue: n.hyPass,
							placeholder: "пароль Hy2",
							onBlur: (e) => patch(n.id, { hyPass: e.target.value.trim() }),
							className: "h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							defaultValue: n.uuid,
							placeholder: "UUID VLESS",
							onBlur: (e) => patch(n.id, { uuid: e.target.value.trim() }),
							className: "h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
						})
					]
				}, n.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mb-2 text-sm text-[var(--color-muted)]",
				children: "Cryptomus merchant UUID"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: merchant,
				onChange: (e) => setMerchant(e.target.value),
				className: "mb-4 h-11 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm",
				placeholder: "uuid"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mb-2 text-sm text-[var(--color-muted)]",
				children: "Заказы"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "grid gap-2",
				children: orders.length ? orders.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "rounded-xl border border-[var(--color-line)] px-3 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm",
						children: [
							"#",
							o.id,
							" · ",
							o.plan,
							" · ",
							o.amount,
							" ₽ · ",
							o.status
						]
					}), o.status === "wait" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mt-2 text-sm text-[var(--color-ok)]",
						onClick: () => mark(o.id, "ok"),
						children: "отметить оплату"
					}) : null]
				}, o.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-[var(--color-muted)]",
					children: "пока пусто"
				})
			})
		]
	});
}
//#endregion
export { Admin as component };
