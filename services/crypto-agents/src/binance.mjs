import crypto from "node:crypto";
import WebSocket from "ws";
import { cfg } from "./config.mjs";

export function startMarketStream(onSnapshot) {
  const streams = cfg.symbols.flatMap(s => [`${s}@bookTicker`, `${s}@aggTrade`]).join("/");
  let ws;
  let retry = 1000;
  const latest = new Map();
  let timer;

  const connect = () => {
    ws = new WebSocket(`${cfg.binanceWs}?streams=${streams}`);
    ws.on("open", () => { retry = 1000; });
    ws.on("message", raw => {
      try {
        const msg = JSON.parse(raw.toString());
        const d = msg.data || msg;
        const symbol = (d.s || "").toLowerCase();
        if (!symbol) return;
        const prev = latest.get(symbol) || { symbol };
        if (d.e === "bookTicker" || (d.b && d.a)) {
          prev.bid = Number(d.b);
          prev.ask = Number(d.a);
          prev.mid = (prev.bid + prev.ask) / 2;
        }
        if (d.e === "aggTrade" || d.p) {
          prev.last = Number(d.p);
          prev.lastQty = Number(d.q);
          prev.tradeTime = d.T || Date.now();
        }
        prev.eventTime = d.E || Date.now();
        latest.set(symbol, prev);
      } catch {}
    });
    ws.on("close", () => {
      clearInterval(timer);
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    });
    ws.on("error", () => { try { ws.close(); } catch {} });
    timer = setInterval(() => {
      const observedAt = Date.now();
      for (const snap of latest.values()) onSnapshot({ ...snap, observedAt, source: "binance-spot" });
    }, 1000);
  };
  connect();
  return () => { clearInterval(timer); try { ws?.close(); } catch {} };
}

function qs(params) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([,v]) => v !== undefined && v !== null)
      .map(([k,v]) => [k, String(v)])
  ).toString();
}

export async function placeSpotOrder({ symbol, side, type = "MARKET", quantity, quoteOrderQty, price, timeInForce }) {
  if (cfg.executionMode !== "live") {
    return { mode: "paper", symbol, side, type, quantity, quoteOrderQty, price, timeInForce, at: Date.now() };
  }
  if (!cfg.binanceApiKey || !cfg.binanceApiSecret) throw new Error("Live execution requires Binance trade credentials");
  const params = {
    symbol: symbol.toUpperCase(), side, type, quantity, quoteOrderQty, price, timeInForce,
    timestamp: Date.now(), recvWindow: 5000
  };
  const query = qs(params);
  const signature = crypto.createHmac("sha256", cfg.binanceApiSecret).update(query).digest("hex");
  const res = await fetch(`${cfg.binanceBaseUrl}/api/v3/order?${query}&signature=${signature}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": cfg.binanceApiKey }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Binance order rejected: ${JSON.stringify(data)}`);
  return { mode: "live", ...data };
}
