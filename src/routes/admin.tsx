import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useApp } from "@/lib/session";
import { useFleet } from "@/lib/nodes";

export const Route = createFileRoute("/admin")({ component: ControlCenter });

type Health = "ready" | "needs-config" | "offline";

const services: Array<{ name: string; health: Health; note: string }> = [
  { name: "Control Center", health: "ready", note: "Интерфейс и локальное состояние готовы" },
  { name: "Model Router", health: "needs-config", note: "Нужны серверные ключи провайдеров" },
  { name: "MCP Gateway", health: "needs-config", note: "Подключение серверов инструментов" },
  { name: "PostgreSQL", health: "needs-config", note: "Нужен DATABASE_URL" },
  { name: "Qdrant", health: "needs-config", note: "Нужен URL/ключ Qdrant" },
  { name: "Temporal", health: "needs-config", note: "Нужен durable workflow backend" },
  { name: "Telemetry", health: "needs-config", note: "OpenTelemetry exporter" },
  { name: "Watchdog", health: "needs-config", note: "Запускается вместе с backend worker" },
];

const agents = [
  ["Supervisor", "Планирует, делегирует, проверяет результат"],
  ["Coding", "Код, тесты, GitHub и исправления"],
  ["Research", "Поиск, анализ и проверка источников"],
  ["Infrastructure", "AWS, деплой, диагностика окружения"],
  ["Memory", "Postgres, Qdrant и знания проекта"],
  ["Diagnostics", "Логи, сбои, retries и recovery"],
] as const;

function Badge({ health }: { health: Health }) {
  const text = health === "ready" ? "готово" : health === "needs-config" ? "нужна настройка" : "offline";
  return <span className="rounded-full border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide">{text}</span>;
}

function ControlCenter() {
  const person = useApp((s) => s.person);
  const orders = useApp((s) => s.orders);
  const nodes = useFleet((s) => s.nodes);

  const readyCount = useMemo(() => services.filter((s) => s.health === "ready").length, []);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">XFreedom OS</p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Control Center</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
            Безопасная панель управления. Секреты и пароли узлов больше не должны храниться в браузере.
          </p>
        </div>
        <Link to="/" className="glass-btn px-4 py-2 text-sm">Открыть приложение</Link>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-muted)]">Сервисы</p>
          <p className="mt-2 text-2xl font-semibold">{readyCount}/{services.length}</p>
        </div>
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-muted)]">Агенты</p>
          <p className="mt-2 text-2xl font-semibold">{agents.length}</p>
        </div>
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-muted)]">Узлы</p>
          <p className="mt-2 text-2xl font-semibold">{nodes.length}</p>
        </div>
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-muted)]">Заказы</p>
          <p className="mt-2 text-2xl font-semibold">{orders.length}</p>
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Состояние системы</h2>
          <div className="grid gap-2">
            {services.map((service) => (
              <div key={service.name} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] px-3 py-3">
                <div>
                  <p className="text-sm">{service.name}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">{service.note}</p>
                </div>
                <Badge health={service.health} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Агенты</h2>
          <div className="grid gap-2">
            {agents.map(([name, note]) => (
              <div key={name} className="rounded-xl border border-[var(--color-line)] px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm">{name}</p>
                  <span className="font-mono text-[10px] uppercase text-[var(--color-muted)]">defined</span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Публичные данные узлов</h2>
          <div className="grid gap-2">
            {nodes.map((node) => (
              <div key={node.id} className="flex items-center justify-between rounded-xl border border-[var(--color-line)] px-3 py-3">
                <div>
                  <p className="text-sm">{node.city}</p>
                  <p className="font-mono text-[11px] text-[var(--color-muted)]">{node.id} · {node.host || "host не задан"}</p>
                </div>
                <span className="text-xs text-[var(--color-muted)]">{node.live ? "active" : "disabled"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Текущая сессия</h2>
          <p className="text-sm">{person.city}, {person.country}</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">
            {person.ip || "IP не определён"}{person.tgId ? ` · tg ${person.tgId}` : ""}
          </p>
          <div className="mt-4 rounded-xl border border-[var(--color-line)] px-3 py-3 text-xs text-[var(--color-muted)]">
            Следующий этап запуска backend: server-side secrets, model router, MCP, Postgres/Qdrant, Temporal и watchdog.
          </div>
        </div>
      </section>
    </main>
  );
}
