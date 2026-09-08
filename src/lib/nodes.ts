import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Node = {
  id: string;
  city: string;
  host: string;
  port: number;
  uuid: string;
  hyPass: string;
  publicKey: string;
  lat: number;
  lng: number;
  live: boolean;
};

const SEED: Node[] = [
  { id: "ru1", city: "Россия", host: "", port: 443, uuid: "", hyPass: "", publicKey: "", lat: 55.75, lng: 37.62, live: true },
  { id: "fra1", city: "Франкфурт", host: "", port: 443, uuid: "", hyPass: "", publicKey: "", lat: 50.11, lng: 8.68, live: true },
  { id: "hel1", city: "Хельсинки", host: "", port: 443, uuid: "", hyPass: "", publicKey: "", lat: 60.17, lng: 24.94, live: true },
  { id: "sin1", city: "Сингапур", host: "", port: 443, uuid: "", hyPass: "", publicKey: "", lat: 1.35, lng: 103.82, live: true },
];

type Fleet = {
  nodes: Node[];
  patch: (id: string, part: Partial<Node>) => void;
};

export const useFleet = create<Fleet>()(
  persist(
    (set, get) => ({
      nodes: SEED,
      patch: (id, part) => set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, ...part } : n)) }),
    }),
    { name: "xf-fleet" },
  ),
);

function dist(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pickNode(lat: number, lng: number) {
  const live = useFleet.getState().nodes.filter((n) => n.live);
  const pool = live.length ? live : useFleet.getState().nodes;
  return [...pool].sort((a, b) => dist(lat, lng, a.lat, a.lng) - dist(lat, lng, b.lat, b.lng))[0];
}

export function renderLink(transport: string, sni: string, vector: string) {
  const n =
    useFleet.getState().nodes.find((x) => x.live && x.host) ??
    useFleet.getState().nodes[0];
  if (!n.host) return `нет хоста · впиши узел в панели\nвектор готов · ${transport} · ${vector}`;
  if (transport === "hysteria2") {
    const pass = n.hyPass || "PASS";
    return `hy2://${pass}@${n.host}:${n.port}?insecure=0&sni=${sni}#${n.city}\nвектор ${vector} · ${transport}`;
  }
  const id = n.uuid || "UUID";
  return `vless://${id}@${n.host}:${n.port}?type=tcp&security=reality&sni=${sni}&fp=chrome&pbk=${n.publicKey}#${n.city}\nвектор ${vector} · ${transport}`;
}
