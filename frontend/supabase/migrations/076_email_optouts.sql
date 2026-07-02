-- 076_email_optouts.sql
-- Email suppression list for Campfire. Before this, the List-Unsubscribe header pointed at
-- a mailto that nothing processed, so unsubscribes were never honored (CAN-SPAM/CASL gap +
-- sender-reputation risk). This table is the source of truth; the app filters every
-- recipient list against it and the /api/campfire/unsubscribe endpoint writes to it.

create table if not exists public.campfire_email_optouts (
  email      text primary key,      -- always stored lowercased/trimmed
  reason     text,                  -- 'user', 'bounce', 'complaint', 'admin', …
  created_at timestamptz not null default now()
);

alter table public.campfire_email_optouts enable row level security;
-- No public policies: only the service role (server routes) reads/writes this.
