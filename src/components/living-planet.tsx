import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/session";

const MIN = 1;
const MAX = 16;
const HANDOFF = 5.2;

export function LivingPlanet({ onConnect }: { onConnect: () => void }) {
  const [zoom, setZoom] = useState(MIN);
  const zoomRef = useRef(MIN);
  const yaw = useRef(18);
  const auto = useRef(true);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const anim = useRef<number | null>(null);
  const spin = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const phase = useApp((s) => s.phase);
  const person = useApp((s) => s.person);
  const dest = useApp((s) => s.dest);
  const status = useApp((s) => s.status);
  const busy = phase === "flying";
  const diagnosed = phase === "diagnosed";
  const on = phase === "on";
  const marked = on || busy || diagnosed;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let id = 0;
    const tick = () => {
      if (!reduce && auto.current && zoomRef.current < 3 && !busy) {
        yaw.current = (yaw.current + 0.045) % 360;
      }
      if (spin.current) {
        spin.current.style.transform = `rotate(${yaw.current}deg)`;
        spin.current.querySelectorAll<HTMLElement>(".pin-label").forEach((el) => {
          el.style.transform = `translate(-50%, calc(-100% - 8px)) rotate(${-yaw.current}deg)`;
        });
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    const el = stage.current;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      go(zoomRef.current + (e.deltaY > 0 ? -0.7 : 0.7));
    };
    el?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(id);
      el?.removeEventListener("wheel", onWheel);
    };
  }, [busy]);

  function go(next: number) {
    const target = Math.min(MAX, Math.max(MIN, next));
    const start = zoomRef.current;
    const t0 = performance.now();
    if (anim.current) cancelAnimationFrame(anim.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 680);
      const e = 1 - (1 - t) ** 3;
      const v = start + (target - start) * e;
      zoomRef.current = v;
      setZoom(v);
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }

  const sat = zoom >= HANDOFF - 0.12;
  const globeOp = zoom >= HANDOFF + 0.4 ? 0 : 1;
  const satOp = sat ? Math.min(1, (zoom - (HANDOFF - 0.12)) / 0.65) : 0;
  const scale = 1 + Math.min(zoom - 1, HANDOFF - 1) * 0.22;
  const tileZ = Math.min(17, Math.max(5, Math.round(4 + zoom)));
  const origin = tileXY(person.lat, person.lng, tileZ);
  const grid = [-1, 0, 1];

  return (
    <section className="flex flex-col items-center">
      <div
        ref={stage}
        className="earth-stage"
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            drag.current = null;
            pan.current = null;
            pinch.current = { d: gap(e.touches), z: zoomRef.current };
            return;
          }
          if (sat) {
            pan.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
              ox: shift.x,
              oy: shift.y,
            };
            return;
          }
          auto.current = false;
          drag.current = { x: e.touches[0].clientX, yaw: yaw.current };
        }}
        onTouchMove={(e) => {
          if (pinch.current && e.touches.length === 2) {
            go(pinch.current.z * (gap(e.touches) / pinch.current.d));
            return;
          }
          if (pan.current && e.touches.length === 1) {
            setShift({
              x: pan.current.ox + (e.touches[0].clientX - pan.current.x),
              y: pan.current.oy + (e.touches[0].clientY - pan.current.y),
            });
            return;
          }
          if (!drag.current || e.touches.length !== 1) return;
          yaw.current = drag.current.yaw + (e.touches[0].clientX - drag.current.x) * 0.32;
        }}
        onTouchEnd={() => {
          pinch.current = null;
          drag.current = null;
          pan.current = null;
          auto.current = true;
        }}
        onMouseDown={(e) => {
          if (sat) {
            pan.current = { x: e.clientX, y: e.clientY, ox: shift.x, oy: shift.y };
            return;
          }
          auto.current = false;
          drag.current = { x: e.clientX, yaw: yaw.current };
        }}
        onMouseMove={(e) => {
          if (pan.current && sat) {
            setShift({
              x: pan.current.ox + (e.clientX - pan.current.x),
              y: pan.current.oy + (e.clientY - pan.current.y),
            });
            return;
          }
          if (!drag.current) return;
          yaw.current = drag.current.yaw + (e.clientX - drag.current.x) * 0.32;
        }}
        onMouseUp={() => {
          drag.current = null;
          pan.current = null;
          auto.current = true;
        }}
        onMouseLeave={() => {
          drag.current = null;
          pan.current = null;
          auto.current = true;
        }}
      >
        <div className="planet-stage" style={{ opacity: globeOp }}>
          <div className="planet-wrap" style={{ transform: `scale(${scale})` }}>
            <div className="planet-spin" ref={spin}>
              <img src="/planet.webp" alt="" className="planet-img" draggable={false} />
              {marked ? (
                <>
                  <svg className="route-svg" viewBox="0 0 100 100" aria-hidden>
                    <path
                      d="M58.8 38.2 C 62 28, 54 22, 49.5 22.8"
                      fill="none"
                      stroke="#5eead4"
                      strokeWidth="0.45"
                      strokeLinecap="round"
                      opacity="0.85"
                    />
                  </svg>
                  <span className="pin" style={{ left: "58.8%", top: "38.2%" }} />
                  <span className="pin-label" style={{ left: "58.8%", top: "38.2%" }}>
                    {person.city}
                  </span>
                  <span className="pin pin-dest" style={{ left: "49.5%", top: "22.8%" }} />
                  <span className="pin-label" style={{ left: "49.5%", top: "22.8%" }}>
                    {dest}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        {sat ? (
          <div className="sat-layer" style={{ opacity: satOp }}>
            <div className="sat-grid" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
              {grid.map((dy) =>
                grid.map((dx) => (
                  <img
                    key={`${dx}:${dy}`}
                    className="sat-cell"
                    alt=""
                    src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileZ}/${origin.y + dy}/${origin.x + dx}`}
                  />
                )),
              )}
            </div>
            {marked ? (
              <>
                <span className="pin" style={{ left: "50%", top: "50%" }} />
                <span className="pin-label" style={{ left: "50%", top: "50%" }}>
                  {person.city}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="zoom-btn" aria-label="Дальше" onClick={() => go(zoom - 2)}>
          −
        </button>
        <button
          type="button"
          className={`glass-btn ${on || busy ? "glass-btn-on" : ""}`}
          disabled={busy}
          onClick={() => {
            if (on) go(MIN);
            onConnect();
          }}
        >
          {on ? "Отключить" : busy ? "Проверяю" : diagnosed ? "Проверить снова" : "Проверить сеть"}
        </button>
        <button
          type="button"
          className="zoom-btn"
          aria-label="Ближе"
          onClick={() => go(Math.max(zoom + 2.4, HANDOFF))}
        >
          +
        </button>
      </div>
      <p className="mt-3 max-w-sm px-4 text-center text-sm text-[var(--color-muted)]">{status}</p>
      {on || diagnosed ? (
        <p className="mt-1 text-center font-mono text-[11px] text-[var(--color-faint)]">
          {diagnosed ? "диагностика · " : ""}
          {person.city}
          {person.ip ? ` · ${person.ip}` : ""} → {dest}
        </p>
      ) : null}
    </section>
  );
}

function tileXY(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
}

function gap(touches: React.TouchList) {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
