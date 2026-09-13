CREATE TABLE IF NOT EXISTS xf_native_sessions (
  id text PRIMARY KEY,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  generation bigint NOT NULL DEFAULT 0,
  sequence bigint NOT NULL DEFAULT 0,
  tun_seen boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS xf_native_stages (
  session_id text NOT NULL REFERENCES xf_native_sessions(id) ON DELETE CASCADE,
  generation bigint NOT NULL,
  sequence bigint NOT NULL,
  stage text NOT NULL,
  evidence jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,generation,sequence)
);
CREATE INDEX IF NOT EXISTS xf_native_sessions_expiry ON xf_native_sessions(expires_at);
-- Operations retention: DELETE FROM xf_native_sessions WHERE expires_at < now() - interval '7 days';
