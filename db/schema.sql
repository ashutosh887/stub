CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY,
  type            TEXT NOT NULL,
  parent_id       UUID,
  name            TEXT NOT NULL,
  balance_micro   BIGINT NOT NULL DEFAULT 0,
  cap_micro       BIGINT,
  frozen          BOOLEAN NOT NULL DEFAULT false,
  velocity_limit_micro    BIGINT,
  velocity_window_seconds BIGINT,
  last_entry_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id              UUID PRIMARY KEY,
  transaction_id  UUID NOT NULL,
  account_id      UUID NOT NULL,
  kind            TEXT NOT NULL,
  amount_micro    BIGINT NOT NULL,
  agent_id        TEXT,
  session_id      TEXT,
  user_id         TEXT,
  intent          TEXT,
  receipt         JSONB,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS denials (
  id              UUID PRIMARY KEY,
  account_id      UUID NOT NULL,
  attempted_micro BIGINT NOT NULL,
  reason          TEXT NOT NULL,
  agent_id        TEXT,
  session_id      TEXT,
  intent          TEXT,
  receipt         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  transaction_id  UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_cache (
  cache_key       TEXT PRIMARY KEY,
  question        TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policies (
  id                       UUID PRIMARY KEY,
  account_id               UUID NOT NULL,
  label                    TEXT,
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  scope                    TEXT,
  limit_micro              BIGINT,
  window_seconds           BIGINT,
  vendor_allow             JSONB,
  vendor_block             JSONB,
  approval_threshold_micro BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id              UUID PRIMARY KEY,
  account_id      UUID NOT NULL,
  name            TEXT NOT NULL,
  api_key_hash    TEXT,
  api_key_preview TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY,
  agent_id     UUID NOT NULL,
  account_id   UUID NOT NULL,
  budget_micro BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS entries_account_created_idx ON entries (account_id, created_at);
CREATE INDEX ASYNC IF NOT EXISTS entries_txn_idx ON entries (transaction_id);
CREATE INDEX ASYNC IF NOT EXISTS entries_created_idx ON entries (created_at);
CREATE INDEX ASYNC IF NOT EXISTS denials_account_created_idx ON denials (account_id, created_at);
CREATE INDEX ASYNC IF NOT EXISTS denials_created_idx ON denials (created_at);
CREATE INDEX ASYNC IF NOT EXISTS agents_api_key_hash_idx ON agents (api_key_hash);
