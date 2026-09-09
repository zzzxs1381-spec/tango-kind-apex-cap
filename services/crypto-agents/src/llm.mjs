import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { cfg } from "./config.mjs";

const Proposal = z.object({
  asset: z.string(),
  action: z.enum(["BUY_SPOT", "SELL_SPOT", "HOLD", "NO_TRADE"]),
  horizon: z.enum(["15m", "1h", "24h", "3d", "7d", "30d"]),
  score: z.number().min(0).max(100),
  probability: z.number().min(0).max(1),
  thesis: z.string(),
  confirmations: z.array(z.object({ group: z.string(), evidence: z.string() })),
  contradictions: z.array(z.string()),
  entryCondition: z.string(),
  invalidation: z.string(),
  shariaStatus: z.enum(["SCREENED_SUPPORT", "REVIEW_REQUIRED", "EXCLUDE"]),
  confidence: z.enum(["low", "medium", "high"]),
});

function instructions(strategy) {
  const base = [
    "You are one independent specialist in a crypto SPOT-only trading research mesh.",
    "Never use futures, perpetuals, options, margin, leverage, interest lending or prediction markets.",
    "NO_TRADE is preferred when evidence is weak.",
    "Do not call an asset halal without project-specific evidence; otherwise REVIEW_REQUIRED.",
    "Count independent evidence groups, not correlated indicators from one group.",
    "Be conservative, falsifiable, and include entry condition plus invalidation."
  ].join("\n");
  const modes = {
    trend: "Focus on regime-gated momentum and breakout/retest structure using spot volume and breadth.",
    event: "Focus on genuinely novel high-credibility events, causal transmission, and priced-in probability.",
    whale: "Focus on publicly attributed wallet/entity flows. Exchange deposits are potential supply, not proof of sale.",
    onchain: "Focus on MVRV/SOPR/realized-cap/LTH-STH/exchange flows and require corroboration.",
    smallcap: "Focus on product-before-hype, users/revenue/developers, MC/FDV, float, unlocks and token value capture.",
    macro: "Focus on Fed/rates/USD/equities/oil/liquidity and cross-asset regime."
  };
  return base + "\n" + (modes[strategy] || "Use broad multi-factor evidence.");
}

export async function generateProposal(strategy, featurePacket) {
  const agent = new Agent({
    name: `strategy-${strategy}`,
    instructions: instructions(strategy),
    model: cfg.openaiModel,
    outputType: Proposal,
  });
  const result = await run(agent, JSON.stringify(featurePacket));
  return result.finalOutput;
}
