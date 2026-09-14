import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let ready = false;

export async function initDb() {
  if (ready || !process.env.DATABASE_URL) return;
  await pool.query(`
    create table if not exists crypto_agent_events (
      id text primary key,
      event_time timestamptz not null,
      kind text not null,
      asset text,
      agent_role text,
      payload jsonb not null
    );
    create table if not exists crypto_agent_trades (
      id text primary key,
      created_at timestamptz not null default now(),
      asset text not null,
      side text not null,
      mode text not null,
      proposal jsonb not null,
      execution jsonb not null,
      outcome jsonb
    );
    create index if not exists crypto_agent_events_time_idx on crypto_agent_events(event_time desc);
  `);
  ready = true;
}

export async function auditEvent(evt) {
  if (!process.env.DATABASE_URL) return;
  await initDb();
  await pool.query(
    `insert into crypto_agent_events(id,event_time,kind,asset,agent_role,payload)
     values($1,to_timestamp($2/1000.0),$3,$4,$5,$6::jsonb) on conflict(id) do nothing`,
    [evt.id, evt.eventTime || Date.now(), evt.kind || "unknown", evt.asset || null, process.env.AGENT_ROLE || null, JSON.stringify(evt)]
  );
}

export async function recordTrade(t) {
  if (!process.env.DATABASE_URL) return;
  await initDb();
  await pool.query(
    `insert into crypto_agent_trades(id,asset,side,mode,proposal,execution)
     values($1,$2,$3,$4,$5::jsonb,$6::jsonb)
     on conflict(id) do update set execution=excluded.execution`,
    [t.id, t.asset, t.side, t.execution?.mode || "paper", JSON.stringify(t.proposal || {}), JSON.stringify(t.execution || {})]
  );
}
