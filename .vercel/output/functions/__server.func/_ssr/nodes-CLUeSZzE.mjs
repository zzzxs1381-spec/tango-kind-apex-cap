import { n as create, t as persist } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/nodes-CLUeSZzE.js
var CAIRO = {
	ip: "",
	city: "Каир",
	country: "Египет",
	lat: 30.0444,
	lng: 31.2357
};
var useApp = create()(persist((set, get) => ({
	phase: "idle",
	status: "Нажми «Подключить» — маршрут соберётся сам",
	dest: "Франкфурт",
	person: CAIRO,
	results: [],
	orders: [],
	advice: "",
	setPhase: (phase, status) => set({
		phase,
		status
	}),
	setPerson: (part) => set({ person: {
		...get().person,
		...part
	} }),
	setDest: (dest) => set({ dest }),
	setResults: (results) => set({ results }),
	addOrder: (input) => {
		const row = {
			...input,
			id: crypto.randomUUID().slice(0, 8),
			at: Date.now(),
			status: "wait"
		};
		set({ orders: [row, ...get().orders] });
		return row;
	},
	markOrder: (id, status) => set({ orders: get().orders.map((o) => o.id === id ? {
		...o,
		status
	} : o) }),
	setAdvice: (advice) => set({ advice })
}), {
	name: "xf-app",
	partialize: (s) => ({
		orders: s.orders,
		person: s.person
	})
}));
var SEED = [
	{
		id: "ru1",
		city: "Россия",
		host: "",
		port: 443,
		uuid: "",
		hyPass: "",
		publicKey: "",
		lat: 55.75,
		lng: 37.62,
		live: true
	},
	{
		id: "fra1",
		city: "Франкфурт",
		host: "",
		port: 443,
		uuid: "",
		hyPass: "",
		publicKey: "",
		lat: 50.11,
		lng: 8.68,
		live: true
	},
	{
		id: "hel1",
		city: "Хельсинки",
		host: "",
		port: 443,
		uuid: "",
		hyPass: "",
		publicKey: "",
		lat: 60.17,
		lng: 24.94,
		live: true
	},
	{
		id: "sin1",
		city: "Сингапур",
		host: "",
		port: 443,
		uuid: "",
		hyPass: "",
		publicKey: "",
		lat: 1.35,
		lng: 103.82,
		live: true
	}
];
var useFleet = create()(persist((set, get) => ({
	nodes: SEED,
	patch: (id, part) => set({ nodes: get().nodes.map((n) => n.id === id ? {
		...n,
		...part
	} : n) })
}), { name: "xf-fleet" }));
function dist(aLat, aLng, bLat, bLng) {
	const R = 6371;
	const dLat = (bLat - aLat) * Math.PI / 180;
	const dLng = (bLng - aLng) * Math.PI / 180;
	const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function pickNode(lat, lng) {
	const live = useFleet.getState().nodes.filter((n) => n.live);
	return [...live.length ? live : useFleet.getState().nodes].sort((a, b) => dist(lat, lng, a.lat, a.lng) - dist(lat, lng, b.lat, b.lng))[0];
}
function renderLink(transport, sni, vector) {
	const n = useFleet.getState().nodes.find((x) => x.live && x.host) ?? useFleet.getState().nodes[0];
	if (!n.host) return `нет хоста · впиши узел в панели\nвектор готов · ${transport} · ${vector}`;
	if (transport === "hysteria2") return `hy2://${n.hyPass || "PASS"}@${n.host}:${n.port}?insecure=0&sni=${sni}#${n.city}\nвектор ${vector} · ${transport}`;
	return `vless://${n.uuid || "UUID"}@${n.host}:${n.port}?type=tcp&security=reality&sni=${sni}&fp=chrome&pbk=${n.publicKey}#${n.city}\nвектор ${vector} · ${transport}`;
}
//#endregion
export { useFleet as i, renderLink as n, useApp as r, pickNode as t };
