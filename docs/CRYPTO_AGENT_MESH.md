# XFreedom Crypto Agent Mesh

This is a set of independent agents, not one prompt pretending to have many roles.

1. **Market Monitor** — Binance Spot WebSocket only; no trading permission.
2. **News Monitor** — receives normalized X/news events over webhook.
3. **Wallet Monitor** — receives Arkham/public-entity wallet alerts over webhook.
4. **Feature Agents** — deterministic normalization and significance filters.
5. **Strategy Agents** — trend, event, whale and small-cap specialists; each independently proposes or abstains.
6. **Fusion Agent** — combines proposals and requires independent evidence groups.
7. **Risk/Sharia Agent** — separate veto boundary; cannot place orders.
8. **Execution Agent** — only service allowed to hold exchange trade credentials; SPOT only.
9. **Evaluator Agent** — independently measures post-trade outcomes.
10. **Memory Agent** — curates decisions/outcomes into Qdrant.
11. **Supervisor** — health/status only; never invents trade signals.

## Hard separation of powers

- Monitor agents cannot trade.
- Strategy agents cannot see exchange API secrets.
- Risk agent cannot trade.
- Execution agent cannot create its own thesis.
- Evaluator cannot rewrite the original proposal after seeing the result.
- Memory agent stores facts/decisions/outcomes, not raw tick spam.

## Event flow

`raw.* -> features.* -> proposal.* -> proposal.fused -> trade.approved -> trade.executed -> evaluator -> memory.candidate -> Qdrant`

NATS JetStream is the durable event bus. Qdrant is long-term retrieval memory. PostgreSQL keeps immutable audit/trade records.

## A-class gate

Execution requires:
- >=4 independent evidence groups;
- fused score >=80;
- calibrated probability >= configured threshold (default 0.85);
- no Sharia EXCLUDE;
- REVIEW_REQUIRED assets are never auto-executed;
- explicit entry condition and invalidation.

The 0.85 threshold is an admission rule, not a promise of 85% win rate. Evaluator statistics must prove or reject it out of sample.

## Execution

- `paper` is default.
- `live` uses Binance Spot only when trade credentials are present.
- The execution API key should have trading permission only and no withdrawal permission.

Run as an overlay on the existing primary stack:

```bash
docker compose -f compose.primary.yml -f compose.crypto-agents.yml up -d --build
```
