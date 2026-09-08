import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BlockType = "none" | "dns" | "tcp" | "http";

export type Probe = {
  id: string;
  label: string;
  host: string;
  href: string;
  ms: number | null;
  block: BlockType;
  note: string;
};

export type Order = {
  id: string;
  plan: string;
  amount: number;
  months: number;
  status: "wait" | "ok";
  at: number;
};

export type Person = {
  tgId?: number;
  name?: string;
  username?: string;
  ip: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
};

type S = {
  phase: "idle" | "flying" | "on";
  status: string;
  dest: string;
  person: Person;
  results: Probe[];
  orders: Order[];
  advice: string;
  setPhase: (p: S["phase"], status: string) => void;
  setPerson: (part: Partial<Person>) => void;
  setDest: (dest: string) => void;
  setResults: (rows: Probe[]) => void;
  addOrder: (o: Omit<Order, "id" | "at" | "status">) => Order;
  markOrder: (id: string, status: Order["status"]) => void;
  setAdvice: (t: string) => void;
};

const CAIRO: Person = {
  ip: "",
  city: "Каир",
  country: "Египет",
  lat: 30.0444,
  lng: 31.2357,
};

export const useApp = create<S>()(
  persist(
    (set, get) => ({
      phase: "idle",
      status: "Нажми «Подключить» — маршрут соберётся сам",
      dest: "Франкфурт",
      person: CAIRO,
      results: [],
      orders: [],
      advice: "",
      setPhase: (phase, status) => set({ phase, status }),
      setPerson: (part) => set({ person: { ...get().person, ...part } }),
      setDest: (dest) => set({ dest }),
      setResults: (results) => set({ results }),
      addOrder: (input) => {
        const row: Order = {
          ...input,
          id: crypto.randomUUID().slice(0, 8),
          at: Date.now(),
          status: "wait",
        };
        set({ orders: [row, ...get().orders] });
        return row;
      },
      markOrder: (id, status) =>
        set({ orders: get().orders.map((o) => (o.id === id ? { ...o, status } : o)) }),
      setAdvice: (advice) => set({ advice }),
    }),
    {
      name: "xf-app",
      partialize: (s) => ({ orders: s.orders, person: s.person }),
    },
  ),
);
