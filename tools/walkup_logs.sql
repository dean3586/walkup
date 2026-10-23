-- Playback log for the walk-up app. Phones add entries with the public
-- (anon) key; they cannot read, change or delete them. Run once in the
-- Supabase SQL editor of the project that holds walkup_config.
create table if not exists public.walkup_logs (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  logged_at timestamptz not null,
  device text not null check (length(device) <= 64),
  message text not null check (length(message) <= 2000)
);

alter table public.walkup_logs enable row level security;

create policy "phones add log entries"
  on public.walkup_logs for insert to anon
  with check (true);

grant insert on public.walkup_logs to anon;
