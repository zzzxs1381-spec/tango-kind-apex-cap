# Agent contracts / NATS subjects

| Subject | Producer | Consumers |
|---|---|---|
| raw.market.snapshot | Market Monitor | Market Feature Agent |
| raw.news.event | News Monitor | News Feature Agent |
| raw.wallet.event | Wallet Monitor | Wallet Feature Agent |
| features.* | Feature Agents | Strategy Agents |
| proposal.<strategy> | Strategy Agents | Fusion Agent |
| proposal.fused | Fusion Agent | Risk Agent |
| trade.approved | Risk Agent | Execution Agent |
| trade.vetoed | Risk Agent | Memory/Evaluation |
| trade.executed | Execution Agent | Evaluator |
| memory.candidate | Risk/Evaluator | Memory Agent |
| system.* | Every service | Supervisor |

Each event carries a stable idempotency key so JetStream duplicate detection and downstream storage can reject duplicates.
