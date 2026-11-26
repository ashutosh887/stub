GRANT SELECT ON accounts, entries, denials, reservations, idempotency_keys, query_cache, policies, agents, account_shards TO stub_app;

GRANT INSERT ON entries, denials, reservations, idempotency_keys, query_cache, policies, agents, account_shards TO stub_app;

GRANT UPDATE (balance_micro, last_entry_hash, frozen, sharded) ON accounts TO stub_app;
GRANT UPDATE (balance_micro, last_entry_hash) ON account_shards TO stub_app;
GRANT UPDATE (status, settled_micro, transaction_id, settled_at) ON reservations TO stub_app;
GRANT UPDATE (enabled) ON policies TO stub_app;

GRANT DELETE ON policies TO stub_app;
