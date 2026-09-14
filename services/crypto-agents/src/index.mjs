import crypto from "node:crypto";
import http from "node:http";
import { cfg } from "./config.mjs";
import { initBus, publish, consume } from "./bus.mjs";
import { startMarketStream, placeSpotOrder } from "./binance.mjs";
import { generateProposal } from "./llm.mjs";
import { remember } from "./qdrant.mjs";
import { auditEvent, recordTrade } from "./db.mjs";

const hashId = (prefix, payload) => `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0,24)}`;
const now = () => Date.now();

async function marketMonitor() {
  startMarketStream(async snap => {
    const evt = {
      id: hashId("mkt", [snap.symbol, Math.floor(snap.observedAt / 1000)]),
      kind: "market_snapshot",
      eventTime: snap.observedAt,
      asset: snap.symbol.toUpperCase(),
      ...snap
    };
    await auditEvent(evt);
    await publish("raw.market.snapshot", evt, evt.id);
  });
}

function webhookServer(kind, subject) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, {"content-type":"application/json"});
      return res.end(JSON.stringify({ok:true, role:cfg.role}));
    }
    if (req.method !== "POST") { res.writeHead(404); return res.end(); }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const parsed = JSON.parse(body || "{}");
      const evt = {
        id: hashId(kind, parsed),
        kind,
        eventTime: parsed.eventTime || parsed.timestamp || now(),
        source: parsed.source || cfg.role,
        payload: parsed
      };
      await auditEvent(evt);
      await publish(subject, evt, evt.id);
      res.writeHead(202, {"content-type":"application/json"});
      res.end(JSON.stringify({accepted:true,id:evt.id}));
    } catch (err) {
      res.writeHead(400);
      res.end(String(err));
    }
  });
  server.listen(cfg.httpPort, "0.0.0.0");
}

async function featureNormalizer(filter, durable, category) {
  await consume(filter, durable, async evt => {
    const score = category === "wallet" ? 75 : category === "news" ? 65 : 55;
    const packet = {
      ...evt,
      category,
      normalizedAt: now(),
      significanceScore: score,
      featureGroup: category
    };
    if (score >= cfg.minEventScore) {
      await publish(`features.${category}`, packet, hashId(`feat-${category}`, packet));
    }
  });
}

async function strategyAgent() {
  await consume("features.*", `strategy-${cfg.strategy}`, async packet => {
    if ((packet.significanceScore || 0) < cfg.minEventScore) return;
    const proposal = await generateProposal(cfg.strategy, packet);
    if (!proposal || proposal.action === "NO_TRADE" || proposal.score < cfg.minProposalScore) return;
    const out = {
      id: hashId(`proposal-${cfg.strategy}`, [proposal, packet.id]),
      createdAt: now(),
      strategy: cfg.strategy,
      sourceEventId: packet.id,
      ...proposal
    };
    await publish(`proposal.${cfg.strategy}`, out, out.id);
  });
}

const fusion = new Map();
async function fusionAgent() {
  await consume("proposal.*", "fusion-agent", async p => {
    const key = `${p.asset}:${p.horizon}`;
    const arr = (fusion.get(key) || []).filter(x => now() - x.createdAt < 5 * 60_000);
    arr.push(p);
    fusion.set(key, arr);

    const uniqueStrategies = [...new Set(arr.map(x => x.strategy))];
    const independentGroups = new Set(arr.flatMap(x => (x.confirmations || []).map(c => c.group)));
    const buy = arr.filter(x => x.action === "BUY_SPOT");
    const sell = arr.filter(x => x.action === "SELL_SPOT");
    const side = buy.length > sell.length ? "BUY_SPOT" : sell.length > buy.length ? "SELL_SPOT" : "NO_TRADE";
    if (side === "NO_TRADE" || independentGroups.size < 4 || uniqueStrategies.length < 2) return;

    const chosen = side === "BUY_SPOT" ? buy : sell;
    const probability = chosen.reduce((s,x) => s + x.probability, 0) / chosen.length;
    const score = chosen.reduce((s,x) => s + x.score, 0) / chosen.length;
    const fused = {
      id: hashId("fused", [key, chosen.map(x => x.id).sort()]),
      createdAt: now(),
      asset: p.asset,
      horizon: p.horizon,
      action: side,
      score,
      probability,
      strategies: uniqueStrategies,
      independentGroups: [...independentGroups],
      proposals: chosen
    };
    await publish("proposal.fused", fused, fused.id);
  });
}

async function riskAgent() {
  await consume("proposal.fused", "risk-agent", async p => {
    const shariaBad = p.proposals.some(x => x.shariaStatus === "EXCLUDE");
    const reviewRequired = p.proposals.some(x => x.shariaStatus === "REVIEW_REQUIRED");
    const aClass = p.probability >= cfg.minAClassProbability && p.score >= 80 && p.independentGroups.length >= 4;
    const approved = !shariaBad && aClass;
    const decision = {
      ...p,
      riskDecision: approved ? "APPROVE" : "VETO",
      signalClass: aClass ? "A" : "B",
      reviewRequired,
      vetoReasons: [
        shariaBad ? "SHARIA_EXCLUDE" : null,
        !aClass ? "A_CLASS_GATE_NOT_MET" : null
      ].filter(Boolean)
    };
    await publish(approved ? "trade.approved" : "trade.vetoed", decision, hashId("risk", decision));
    await publish("memory.candidate", {...decision, category:"decision", agentRole:"risk-agent", eventTime:now()}, hashId("mem-risk", decision));
  });
}

async function executionAgent() {
  await consume("trade.approved", "execution-agent", async p => {
    if (p.reviewRequired) return;
    const side = p.action === "BUY_SPOT" ? "BUY" : "SELL";
    const symbol = p.asset.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const order = side === "BUY"
      ? { symbol, side, type:"MARKET", quoteOrderQty: cfg.maxOrderQuote }
      : { symbol, side, type:"MARKET", quantity: p.quantity };
    if (side === "SELL" && !order.quantity) return;
    const execution = await placeSpotOrder(order);
    const trade = {
      id: hashId("trade", [p.id, execution]),
      asset: symbol,
      side,
      proposal: p,
      execution,
      executedAt: now()
    };
    await recordTrade(trade);
    await publish("trade.executed", trade, trade.id);
  });
}

async function evaluatorAgent() {
  await consume("trade.executed", "evaluator-agent", async trade => {
    const memory = {
      id: hashId("eval", trade.id),
      category: "trade_outcome_pending",
      agentRole: "evaluator-agent",
      eventTime: now(),
      asset: trade.asset,
      tradeId: trade.id,
      horizons: ["1m","5m","15m","1h","24h","3d","7d","30d"],
      status: "PENDING"
    };
    await publish("memory.candidate", memory, memory.id);
  });
}

async function memoryAgent() {
  await consume("memory.candidate", "memory-agent", async record => {
    await remember(record);
  });
}

async function supervisor() {
  setInterval(() => publish("system.heartbeat", {
    id: hashId("hb", [cfg.role, Math.floor(now()/30000)]),
    kind: "heartbeat",
    role: cfg.role,
    eventTime: now()
  }), 30_000);
}

await initBus();
console.log(JSON.stringify({level:"info", message:"crypto agent starting", role:cfg.role, strategy:cfg.strategy}));

switch (cfg.role) {
  case "market-monitor": await marketMonitor(); break;
  case "news-monitor": webhookServer("news_event", "raw.news.event"); break;
  case "wallet-monitor": webhookServer("wallet_event", "raw.wallet.event"); break;
  case "feature-market": await featureNormalizer("raw.market.snapshot", "feature-market", "market"); break;
  case "feature-news": await featureNormalizer("raw.news.event", "feature-news", "news"); break;
  case "feature-wallet": await featureNormalizer("raw.wallet.event", "feature-wallet", "wallet"); break;
  case "strategy-agent": await strategyAgent(); break;
  case "fusion-agent": await fusionAgent(); break;
  case "risk-agent": await riskAgent(); break;
  case "execution-agent": await executionAgent(); break;
  case "evaluator-agent": await evaluatorAgent(); break;
  case "memory-agent": await memoryAgent(); break;
  default: await supervisor(); break;
}
