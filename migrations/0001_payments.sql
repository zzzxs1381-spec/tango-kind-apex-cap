CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('freekassa', 'cryptomus')),
  plan_id TEXT NOT NULL,
  amount NUMERIC(18,8) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  provider_payment_id TEXT,
  checkout_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_payment_uidx
  ON payment_orders(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('freekassa', 'cryptomus')),
  event_key TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, event_key)
);

CREATE INDEX IF NOT EXISTS payment_events_order_idx
  ON payment_events(order_id, created_at DESC);
