import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp } from "@/lib/session";
import { APPS, measureAll, pickTransport } from "@/lib/measure";
import { pickNode } from "@/lib/nodes";
import { locateQuiet } from "@/lib/geo";
import { LivingPlanet } from "@/components/living-planet";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [tab, setTab] = useState<"home" | "pay" | "lane">("home");
  const [intro, setIntro] = useState(true);
  const phase = useApp((s) => s.phase);
  const results = useApp((s) => s.results);
  const advice = useApp((s) => s.advice);
  const [lastOrder, setLastOrder] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [plan, setPlan] = useState("start");
  const [months, setMonths] = useState(1);
  const price =
    plan === "plus" ? 1200 * months : plan === "max" ? 2800 : plan === "trial" ? 0 : 600 * months;

  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), 700);
    return () => window.clearTimeout(t);
  }, []);

  async function connect() {
    if (phase === "on") {
      useApp.getState().setPhase("idle", "Системное подключение отключено");
      return;
    }

    useApp.getState().setPhase("flying", "Определяю сеть и проверяю доступность…");

    // Refresh location before selecting the nearest candidate node. The old
    // flow selected a node from stale/default coordinates and only then ran
    // location discovery in the background.
    await locateQuiet();
    const me = useApp.getState().person;
    const node = pickNode(me.lat, me.lng);
    useApp.getState().setDest(node.city);
    useApp.getState().setPhase("flying", `${me.city} → кандидат ${node.city} · диагностика`);

    const rows = await Promise.race([
      measureAll(),
      new Promise<Awaited<ReturnType<typeof measureAll>>>((resolve) =>
        window.setTimeout(() => resolve([]), 4200),
      ),
    ]);

    const path = pickTransport(rows);
    useApp.getState().setResults(rows);

    const details = rows.length
      ? rows.map((row) => `${row.label}: ${row.note} · ${row.ms ?? "—"} мс`).join("\n")
      : "Браузерные пробы не завершились в установленное время.";

    useApp.getState().setAdvice(
      [
        "Браузерная диагностика XFreedom",
        details,
        "",
        `transport decision: ${path.transport} (${path.vector})`,
        "Системный VPN/туннель этим действием НЕ подключён.",
        "Для выбора HY2/TUIC/REALITY нужны native/server DNS, TCP, TLS, UDP/443 и QUIC-пробы.",
      ].join("\n"),
    );
    useApp
      .getState()
      .setPhase("diagnosed", `${me.city} · диагностика завершена · системный VPN не подключён`);
  }

  function pay() {
    if (price === 0) {
      setLastOrder("trial");
      return;
    }
    const row = useApp.getState().addOrder({ plan, amount: price, months });
    setLastOrder(row.id);
  }

  return (
    <main className="shell w-full px-4 pt-4 pb-28">
      {intro ? (
        <div className="intro">
          <div>
            <div className="intro-mark">XFreedom</div>
            <div className="intro-sub">Xservis</div>
          </div>
        </div>
      ) : null}

      <header className="relative z-10 mb-1 flex w-full items-end justify-between px-1">
        <div>
          <Link to="/admin" className="brand-link font-mono text-[11px] tracking-[0.28em] uppercase">
            xservis
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            <Link to="/" className="brand-title">
              XFreedom
            </Link>
          </h1>
        </div>
      </header>

      {tab === "home" ? (
        <section className="flex flex-1 flex-col items-center justify-center">
          <LivingPlanet onConnect={() => void connect()} />
        </section>
      ) : null}

      {tab === "pay" ? (
        <section className="mt-6 grid w-full gap-3">
          {(
            [
              ["trial", "Сутки", "0 ₽"],
              ["start", "Старт", "600 ₽ / мес"],
              ["plus", "Плюс", "1 200 ₽ / мес"],
              ["max", "Максимум", "2 800 ₽ / 3 мес"],
            ] as const
          ).map(([id, title, priceLabel]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPlan(id)}
              className={`plan-btn px-4 py-3 text-left ${plan === id ? "plan-btn-on" : ""}`}
            >
              <div className="flex justify-between">
                <span>{title}</span>
                <span className="font-mono text-sm">{priceLabel}</span>
              </div>
            </button>
          ))}
          {plan !== "trial" && plan !== "max" ? (
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  className={`month-btn text-sm ${months === m ? "month-btn-on" : ""}`}
                >
                  {m} мес
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="glass-btn w-full" onClick={pay}>
            {price === 0 ? "Включить сутки" : `Оплатить ${price.toLocaleString("ru-RU")} ₽`}
          </button>
          {lastOrder && lastOrder !== "trial" ? (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-sm">Заказ #{lastOrder}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Счёт создан. Касса Cryptomus включится, когда кабинет одобрят.
              </p>
            </div>
          ) : lastOrder === "trial" ? (
            <p className="text-sm text-[var(--color-ok)]">Сутки включены</p>
          ) : null}
        </section>
      ) : null}

      {tab === "lane" ? (
        <section className="mt-6 grid w-full gap-3">
          <p className="text-sm text-[var(--color-muted)]">Приоритетные приложения · браузерная проверка</p>
          <div className="grid grid-cols-2 gap-2">
            {APPS.map((a) => {
              const row = results.find((r) => r.id === a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className="lane-btn px-3 py-3 text-left"
                  onClick={() => window.open(a.href, "_blank", "noopener,noreferrer")}
                >
                  <div className="text-sm">{a.label}</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--color-faint)]">
                    {row ? `${row.note} · ${row.ms ?? "—"} мс` : "не проверено"}
                  </div>
                </button>
              );
            })}
          </div>
          <pre className="overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-[11px] whitespace-pre-wrap text-[var(--color-muted)]">
            {advice || "Сначала запусти проверку сети — здесь появятся измерения и ограничения доказательности."}
          </pre>
          {advice ? (
            <button
              type="button"
              className="glass-btn w-full"
              onClick={async () => {
                await navigator.clipboard.writeText(advice);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Скопировано" : "Скопировать диагностику"}
            </button>
          ) : null}
        </section>
      ) : null}

      <nav className="fixed right-0 bottom-0 left-0 bg-transparent px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-1">
          {(
            [
              ["home", "Главная"],
              ["pay", "Тариф"],
              ["lane", "Сеть"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`nav-btn text-sm ${tab === id ? "nav-btn-on" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
