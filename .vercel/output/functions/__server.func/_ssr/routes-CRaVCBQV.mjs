import { i as __toESM } from "../_runtime.mjs";
import { R as require_react, _ as Link, y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as renderLink, r as useApp, t as pickNode } from "./nodes-CLUeSZzE.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CRaVCBQV.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var APPS = [
	{
		id: "telegram",
		label: "Telegram",
		host: "telegram.org",
		href: "https://web.telegram.org/",
		url: "https://telegram.org/favicon.ico"
	},
	{
		id: "whatsapp",
		label: "WhatsApp",
		host: "web.whatsapp.com",
		href: "https://web.whatsapp.com/",
		url: "https://web.whatsapp.com/favicon.ico"
	},
	{
		id: "instagram",
		label: "Instagram",
		host: "instagram.com",
		href: "https://www.instagram.com/",
		url: "https://www.instagram.com/favicon.ico"
	},
	{
		id: "youtube",
		label: "YouTube",
		host: "youtube.com",
		href: "https://www.youtube.com/",
		url: "https://www.youtube.com/favicon.ico"
	}
];
function load(url, ms) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		const img = new Image();
		const done = (ok) => {
			img.onload = null;
			img.onerror = null;
			resolve({
				ok,
				ms: Math.round(performance.now() - t0)
			});
		};
		const t = window.setTimeout(() => done(false), ms);
		img.onload = () => {
			window.clearTimeout(t);
			done(true);
		};
		img.onerror = () => {
			window.clearTimeout(t);
			done(false);
		};
		img.src = `${url}?t=${Date.now()}`;
	});
}
async function doh(host) {
	try {
		const ctrl = new AbortController();
		const t = window.setTimeout(() => ctrl.abort(), 1600);
		const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
			headers: { Accept: "application/dns-json" },
			signal: ctrl.signal
		});
		window.clearTimeout(t);
		return !!(await res.json()).Answer?.some((a) => a.type === 1);
	} catch {
		return false;
	}
}
function klass(ok, ms, dohOk) {
	if (ok) return "none";
	if (dohOk && ms < 200) return "dns";
	if (ms >= 1300) return "tcp";
	return "http";
}
var NOTE = {
	none: "звонок",
	dns: "dns",
	tcp: "tcp",
	http: "http"
};
async function measureAll() {
	return Promise.all(APPS.map(async (a) => {
		const [hit, dns] = await Promise.all([load(a.url, 1400), doh(a.host)]);
		const block = klass(hit.ok, hit.ms, dns);
		return {
			id: a.id,
			label: a.label,
			host: a.host,
			href: a.href,
			ms: hit.ms,
			block,
			note: NOTE[block]
		};
	}));
}
function pickTransport(rows) {
	const blocks = rows.map((r) => r.block);
	if (blocks.every((b) => b === "none")) return {
		transport: "hysteria2",
		vector: "clean",
		sni: "www.cloudflare.com"
	};
	if (blocks.includes("dns")) return {
		transport: "hysteria2",
		vector: "dns-poison",
		sni: "www.microsoft.com"
	};
	if (blocks.includes("tcp")) return {
		transport: "amneziawg",
		vector: "ip-blackhole",
		sni: "www.cloudflare.com"
	};
	return {
		transport: "vless-reality",
		vector: "sni-filter",
		sni: "www.microsoft.com"
	};
}
function readTelegram() {
	const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
	if (!u) return;
	useApp.getState().setPerson({
		tgId: u.id,
		name: u.first_name,
		username: u.username
	});
}
async function ipFix() {
	try {
		const ctrl = new AbortController();
		const t = window.setTimeout(() => ctrl.abort(), 2400);
		const res = await fetch("https://ipwho.is/", { signal: ctrl.signal });
		window.clearTimeout(t);
		const body = await res.json();
		if (body.success === false) return null;
		return body;
	} catch {
		return null;
	}
}
function gpsFix() {
	if (!navigator.geolocation) return Promise.resolve(null);
	return new Promise((resolve) => {
		const t = window.setTimeout(() => resolve(null), 2400);
		navigator.geolocation.getCurrentPosition((p) => {
			window.clearTimeout(t);
			resolve(p);
		}, () => {
			window.clearTimeout(t);
			resolve(null);
		}, {
			enableHighAccuracy: true,
			timeout: 2200,
			maximumAge: 6e4
		});
	});
}
async function locateQuiet() {
	readTelegram();
	const [ip, gps] = await Promise.all([ipFix(), gpsFix()]);
	const cur = useApp.getState().person;
	useApp.getState().setPerson({
		ip: ip?.ip ?? cur.ip,
		city: ip?.city || cur.city,
		country: ip?.country || cur.country,
		lat: gps?.coords.latitude ?? ip?.latitude ?? cur.lat,
		lng: gps?.coords.longitude ?? ip?.longitude ?? cur.lng
	});
}
var MIN = 1;
var MAX = 16;
var HANDOFF = 5.2;
function LivingPlanet({ onConnect }) {
	const [zoom, setZoom] = (0, import_react.useState)(MIN);
	const zoomRef = (0, import_react.useRef)(MIN);
	const yaw = (0, import_react.useRef)(18);
	const auto = (0, import_react.useRef)(true);
	const drag = (0, import_react.useRef)(null);
	const pan = (0, import_react.useRef)(null);
	const [shift, setShift] = (0, import_react.useState)({
		x: 0,
		y: 0
	});
	const pinch = (0, import_react.useRef)(null);
	const anim = (0, import_react.useRef)(null);
	const spin = (0, import_react.useRef)(null);
	const stage = (0, import_react.useRef)(null);
	const phase = useApp((s) => s.phase);
	const person = useApp((s) => s.person);
	const dest = useApp((s) => s.dest);
	const status = useApp((s) => s.status);
	const busy = phase === "flying";
	const on = phase === "on";
	const marked = on || busy;
	(0, import_react.useEffect)(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let id = 0;
		const tick = () => {
			if (!reduce && auto.current && zoomRef.current < 3 && !busy) yaw.current = (yaw.current + .045) % 360;
			if (spin.current) {
				spin.current.style.transform = `rotate(${yaw.current}deg)`;
				spin.current.querySelectorAll(".pin-label").forEach((el) => {
					el.style.transform = `translate(-50%, calc(-100% - 8px)) rotate(${-yaw.current}deg)`;
				});
			}
			id = requestAnimationFrame(tick);
		};
		id = requestAnimationFrame(tick);
		const el = stage.current;
		const onWheel = (e) => {
			e.preventDefault();
			go(zoomRef.current + (e.deltaY > 0 ? -.7 : .7));
		};
		el?.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			cancelAnimationFrame(id);
			el?.removeEventListener("wheel", onWheel);
		};
	}, [busy]);
	function go(next) {
		const target = Math.min(MAX, Math.max(MIN, next));
		const start = zoomRef.current;
		const t0 = performance.now();
		if (anim.current) cancelAnimationFrame(anim.current);
		const step = (now) => {
			const t = Math.min(1, (now - t0) / 680);
			const e = 1 - (1 - t) ** 3;
			const v = start + (target - start) * e;
			zoomRef.current = v;
			setZoom(v);
			if (t < 1) anim.current = requestAnimationFrame(step);
		};
		anim.current = requestAnimationFrame(step);
	}
	const sat = zoom >= 5.08;
	const globeOp = zoom >= 5.6000000000000005 ? 0 : 1;
	const satOp = sat ? Math.min(1, (zoom - 5.08) / .65) : 0;
	const scale = 1 + Math.min(zoom - 1, 4.2) * .22;
	const tileZ = Math.min(17, Math.max(5, Math.round(4 + zoom)));
	const origin = tileXY(person.lat, person.lng, tileZ);
	const grid = [
		-1,
		0,
		1
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "flex flex-col items-center",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				ref: stage,
				className: "earth-stage",
				onTouchStart: (e) => {
					if (e.touches.length === 2) {
						drag.current = null;
						pan.current = null;
						pinch.current = {
							d: gap(e.touches),
							z: zoomRef.current
						};
						return;
					}
					if (sat) {
						pan.current = {
							x: e.touches[0].clientX,
							y: e.touches[0].clientY,
							ox: shift.x,
							oy: shift.y
						};
						return;
					}
					auto.current = false;
					drag.current = {
						x: e.touches[0].clientX,
						yaw: yaw.current
					};
				},
				onTouchMove: (e) => {
					if (pinch.current && e.touches.length === 2) {
						go(pinch.current.z * (gap(e.touches) / pinch.current.d));
						return;
					}
					if (pan.current && e.touches.length === 1) {
						setShift({
							x: pan.current.ox + (e.touches[0].clientX - pan.current.x),
							y: pan.current.oy + (e.touches[0].clientY - pan.current.y)
						});
						return;
					}
					if (!drag.current || e.touches.length !== 1) return;
					yaw.current = drag.current.yaw + (e.touches[0].clientX - drag.current.x) * .32;
				},
				onTouchEnd: () => {
					pinch.current = null;
					drag.current = null;
					pan.current = null;
					auto.current = true;
				},
				onMouseDown: (e) => {
					if (sat) {
						pan.current = {
							x: e.clientX,
							y: e.clientY,
							ox: shift.x,
							oy: shift.y
						};
						return;
					}
					auto.current = false;
					drag.current = {
						x: e.clientX,
						yaw: yaw.current
					};
				},
				onMouseMove: (e) => {
					if (pan.current && sat) {
						setShift({
							x: pan.current.ox + (e.clientX - pan.current.x),
							y: pan.current.oy + (e.clientY - pan.current.y)
						});
						return;
					}
					if (!drag.current) return;
					yaw.current = drag.current.yaw + (e.clientX - drag.current.x) * .32;
				},
				onMouseUp: () => {
					drag.current = null;
					pan.current = null;
					auto.current = true;
				},
				onMouseLeave: () => {
					drag.current = null;
					pan.current = null;
					auto.current = true;
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "planet-stage",
					style: { opacity: globeOp },
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "planet-wrap",
						style: { transform: `scale(${scale})` },
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "planet-spin",
							ref: spin,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: "/planet.webp",
								alt: "",
								className: "planet-img",
								draggable: false
							}), marked ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
									className: "route-svg",
									viewBox: "0 0 100 100",
									"aria-hidden": true,
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
										d: "M58.8 38.2 C 62 28, 54 22, 49.5 22.8",
										fill: "none",
										stroke: "#5eead4",
										strokeWidth: "0.45",
										strokeLinecap: "round",
										opacity: "0.85"
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "pin",
									style: {
										left: "58.8%",
										top: "38.2%"
									}
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "pin-label",
									style: {
										left: "58.8%",
										top: "38.2%"
									},
									children: person.city
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "pin pin-dest",
									style: {
										left: "49.5%",
										top: "22.8%"
									}
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "pin-label",
									style: {
										left: "49.5%",
										top: "22.8%"
									},
									children: dest
								})
							] }) : null]
						})
					})
				}), sat ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "sat-layer",
					style: { opacity: satOp },
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "sat-grid",
						style: { transform: `translate(${shift.x}px, ${shift.y}px)` },
						children: grid.map((dy) => grid.map((dx) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
							className: "sat-cell",
							alt: "",
							src: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileZ}/${origin.y + dy}/${origin.x + dx}`
						}, `${dx}:${dy}`)))
					}), marked ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "pin",
						style: {
							left: "50%",
							top: "50%"
						}
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "pin-label",
						style: {
							left: "50%",
							top: "50%"
						},
						children: person.city
					})] }) : null]
				}) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-2 flex items-center gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "zoom-btn",
						"aria-label": "Дальше",
						onClick: () => go(zoom - 2),
						children: "−"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: `glass-btn ${on || busy ? "glass-btn-on" : ""}`,
						disabled: busy,
						onClick: () => {
							if (on) go(MIN);
							onConnect();
						},
						children: on ? "Отключить" : busy ? "Держу" : "Подключить"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "zoom-btn",
						"aria-label": "Ближе",
						onClick: () => go(Math.max(zoom + 2.4, HANDOFF)),
						children: "+"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 max-w-sm px-4 text-center text-sm text-[var(--color-muted)]",
				children: status
			}),
			on ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-1 text-center font-mono text-[11px] text-[var(--color-faint)]",
				children: [
					person.city,
					person.ip ? ` · ${person.ip}` : "",
					" → ",
					dest
				]
			}) : null
		]
	});
}
function tileXY(lat, lng, z) {
	const n = 2 ** z;
	const x = Math.floor((lng + 180) / 360 * n);
	const r = lat * Math.PI / 180;
	return {
		x,
		y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)
	};
}
function gap(touches) {
	const a = touches[0];
	const b = touches[1];
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
function Home() {
	const [tab, setTab] = (0, import_react.useState)("home");
	const [intro, setIntro] = (0, import_react.useState)(true);
	const phase = useApp((s) => s.phase);
	const results = useApp((s) => s.results);
	const advice = useApp((s) => s.advice);
	const [lastOrder, setLastOrder] = (0, import_react.useState)(null);
	const [copied, setCopied] = (0, import_react.useState)(false);
	const [plan, setPlan] = (0, import_react.useState)("start");
	const [months, setMonths] = (0, import_react.useState)(1);
	const price = plan === "plus" ? 1200 * months : plan === "max" ? 2800 : plan === "trial" ? 0 : 600 * months;
	(0, import_react.useEffect)(() => {
		const t = window.setTimeout(() => setIntro(false), 700);
		return () => window.clearTimeout(t);
	}, []);
	async function connect() {
		if (phase === "on") {
			useApp.getState().setPhase("idle", "Нажми «Подключить» — маршрут соберётся сам");
			return;
		}
		const me = useApp.getState().person;
		const node = pickNode(me.lat, me.lng);
		useApp.getState().setDest(node.city);
		useApp.getState().setPhase("flying", `${me.city} → ${node.city}`);
		locateQuiet();
		const rows = await Promise.race([measureAll(), new Promise((r) => setTimeout(() => r([]), 4200))]);
		const path = pickTransport(rows);
		useApp.getState().setResults(rows);
		useApp.getState().setAdvice(renderLink(path.transport, path.sni, path.vector));
		useApp.getState().setPhase("on", `${me.city} → ${node.city}`);
	}
	function pay() {
		if (price === 0) {
			setLastOrder("trial");
			return;
		}
		const row = useApp.getState().addOrder({
			plan,
			amount: price,
			months
		});
		setLastOrder(row.id);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "shell w-full px-4 pt-4 pb-28",
		children: [
			intro ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "intro",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "intro-mark",
					children: "XFreedom"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "intro-sub",
					children: "Xservis"
				})] })
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", {
				className: "relative z-10 mb-1 flex w-full items-end justify-between px-1",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/admin",
					className: "brand-link font-mono text-[11px] tracking-[0.28em] uppercase",
					children: "xservis"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: "brand-title",
						children: "XFreedom"
					})
				})] })
			}),
			tab === "home" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "flex flex-1 flex-col items-center justify-center",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LivingPlanet, { onConnect: () => void connect() })
			}) : null,
			tab === "pay" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6 grid w-full gap-3",
				children: [
					[
						[
							"trial",
							"Сутки",
							"0 ₽"
						],
						[
							"start",
							"Старт",
							"600 ₽ / мес"
						],
						[
							"plus",
							"Плюс",
							"1 200 ₽ / мес"
						],
						[
							"max",
							"Максимум",
							"2 800 ₽ / 3 мес"
						]
					].map(([id, title, priceLabel]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setPlan(id),
						className: `plan-btn px-4 py-3 text-left ${plan === id ? "plan-btn-on" : ""}`,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex justify-between",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: title }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-sm",
								children: priceLabel
							})]
						})
					}, id)),
					plan !== "trial" && plan !== "max" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-3 gap-2",
						children: [
							1,
							2,
							3
						].map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: () => setMonths(m),
							className: `month-btn text-sm ${months === m ? "month-btn-on" : ""}`,
							children: [m, " мес"]
						}, m))
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "glass-btn w-full",
						onClick: pay,
						children: price === 0 ? "Включить сутки" : `Оплатить ${price.toLocaleString("ru-RU")} ₽`
					}),
					lastOrder && lastOrder !== "trial" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-sm",
							children: ["Заказ #", lastOrder]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-xs text-[var(--color-muted)]",
							children: "Счёт создан. Касса Cryptomus включится, когда кабинет одобрят."
						})]
					}) : lastOrder === "trial" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-[var(--color-ok)]",
						children: "Сутки включены"
					}) : null
				]
			}) : null,
			tab === "lane" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6 grid w-full gap-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-[var(--color-muted)]",
						children: "Четыре приоритета · 24/7"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-2 gap-2",
						children: APPS.map((a) => {
							const row = results.find((r) => r.id === a.id);
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "lane-btn px-3 py-3 text-left",
								onClick: () => window.open(a.href, "_blank", "noopener,noreferrer"),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-sm",
									children: a.label
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "mt-1 font-mono text-[11px] text-[var(--color-faint)]",
									children: row ? `${row.note} · ${row.ms} мс` : "открыть"
								})]
							}, a.id);
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
						className: "overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-[11px] whitespace-pre-wrap text-[var(--color-muted)]",
						children: advice || "Сначала «Подключить» — здесь будет ссылка узла."
					}),
					advice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "glass-btn w-full",
						onClick: async () => {
							await navigator.clipboard.writeText(advice.split("\n")[0] ?? advice);
							setCopied(true);
							window.setTimeout(() => setCopied(false), 1200);
						},
						children: copied ? "Скопировано" : "Скопировать ссылку"
					}) : null
				]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
				className: "fixed right-0 bottom-0 left-0 bg-transparent px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mx-auto grid max-w-lg grid-cols-3 gap-1",
					children: [
						["home", "Главная"],
						["pay", "Тариф"],
						["lane", "Канал"]
					].map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setTab(id),
						className: `nav-btn text-sm ${tab === id ? "nav-btn-on" : ""}`,
						children: label
					}, id))
				})
			})
		]
	});
}
//#endregion
export { Home as component };
