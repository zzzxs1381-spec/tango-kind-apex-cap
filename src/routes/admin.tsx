import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp } from "@/lib/session";
import { useFleet } from "@/lib/nodes";

const KEY = "xf-admin-ok";

export const Route = createFileRoute("/admin")({ component: Admin });

function Admin() {
  const [ok, setOk] = useState(() =>
    typeof window !== "undefined" ? sessionStorage.getItem(KEY) === "1" : false,
  );
  const [pin, setPin] = useState("");
  const orders = useApp((s) => s.orders);
  const person = useApp((s) => s.person);
  const mark = useApp((s) => s.markOrder);
  const [merchant, setMerchant] = useState("");
  const nodes = useFleet((s) => s.nodes);
  const patch = useFleet((s) => s.patch);

  if (!ok) {
    return (
      <main className="mx-auto grid min-h-screen max-w-sm place-content-center gap-3 px-4">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Панель</h1>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="h-11 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3"
          placeholder="ключ"
        />
        <button
          type="button"
          className="glass-btn w-full"
          onClick={() => {
            if (pin.trim() === "malik") {
              sessionStorage.setItem(KEY, "1");
              setOk(true);
            }
          }}
        >
          Войти
        </button>
        <Link to="/" className="brand-link text-center text-sm">
          назад
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto h-dvh max-w-lg overflow-y-auto px-4 py-6">
      <div className="mb-4 flex justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Админ</h1>
        <Link to="/" className="brand-link text-sm">
          приложение
        </Link>
      </div>
      <h2 className="mb-2 text-sm text-[var(--color-muted)]">Сессия</h2>
      <p className="mb-6 font-mono text-xs text-[var(--color-muted)]">
        {person.city}, {person.country}
        {person.ip ? ` · ${person.ip}` : ""}
        {person.tgId ? ` · tg ${person.tgId}` : ""}
      </p>
      <h2 className="mb-2 text-sm text-[var(--color-muted)]">Узлы</h2>
      <ul className="mb-6 grid gap-3">
        {nodes.map((n) => (
          <li key={n.id} className="grid gap-2 rounded-xl border border-[var(--color-line)] px-3 py-3">
            <p className="text-sm">
              {n.city} · {n.id}
            </p>
            <input
              defaultValue={n.host}
              placeholder="хост"
              onBlur={(e) => patch(n.id, { host: e.target.value.trim() })}
              className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
            />
            <input
              defaultValue={n.hyPass}
              placeholder="пароль Hy2"
              onBlur={(e) => patch(n.id, { hyPass: e.target.value.trim() })}
              className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
            />
            <input
              defaultValue={n.uuid}
              placeholder="UUID VLESS"
              onBlur={(e) => patch(n.id, { uuid: e.target.value.trim() })}
              className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
            />
          </li>
        ))}
      </ul>
      <p className="mb-2 text-sm text-[var(--color-muted)]">Cryptomus merchant UUID</p>
      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        className="mb-4 h-11 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-raised)] px-3 font-mono text-sm"
        placeholder="uuid"
      />
      <h2 className="mb-2 text-sm text-[var(--color-muted)]">Заказы</h2>
      <ul className="grid gap-2">
        {orders.length ? (
          orders.map((o) => (
            <li key={o.id} className="rounded-xl border border-[var(--color-line)] px-3 py-3">
              <p className="text-sm">
                #{o.id} · {o.plan} · {o.amount} ₽ · {o.status}
              </p>
              {o.status === "wait" ? (
                <button type="button" className="mt-2 text-sm text-[var(--color-ok)]" onClick={() => mark(o.id, "ok")}>
                  отметить оплату
                </button>
              ) : null}
            </li>
          ))
        ) : (
          <p className="text-sm text-[var(--color-muted)]">пока пусто</p>
        )}
      </ul>
    </main>
  );
}
