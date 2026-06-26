-- Stub ledger schema for Aurora DSQL (PostgreSQL-16 subset).
-- Constraints respected: no foreign keys, no triggers, no sequences (client-generated
-- UUIDs avoid OCC hot spots), BIGINT micro-USD money (1 = $0.000001), JSONB receipts.
-- Each statement runs in its own implicit transaction (DSQL DDL constraint).

CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY,
  type            TEXT NOT NULL,
  parent_id       UUID,
  name            TEXT NOT NULL,
  balance_micro   BIGINT NOT NULL DEFAULT 0,
  cap_micro       BIGINT,
  frozen          BOOLEAN NOT NULL DEFAULT false,
  last_entry_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS frozen BOOLEAN;
UPDATE accounts SET frozen = false WHERE frozen IS NULL;

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

CREATE TABLE IF NOT EXISTS policies (
  id                       UUID PRIMARY KEY,
  account_id               UUID NOT NULL,
  scope                    TEXT NOT NULL,
  limit_micro              BIGINT,
  window_seconds           BIGINT,
  vendor_allow             JSONB,
  vendor_block             JSONB,
  approval_threshold_micro BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id           UUID PRIMARY KEY,
  account_id   UUID NOT NULL,
  name         TEXT NOT NULL,
  api_key_hash TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY,
  agent_id     UUID NOT NULL,
  account_id   UUID NOT NULL,
  budget_micro BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
