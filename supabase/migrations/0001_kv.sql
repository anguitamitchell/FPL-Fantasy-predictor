-- Generic key/value store used by lib/store (snapshots, finished-GW live data, API-Football cache).
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kv enable row level security;
-- No policies: only the service-role key (server side) can read/write.
