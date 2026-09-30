-- The Polyphonic connector (supabase/functions/polyphonic-connect).
create table if not exists public.connector_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text not null default '',
  redirect_host text,
  agent_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id),
  constraint connector_grants_client_id_len check (char_length(client_id) between 1 and 200),
  constraint connector_grants_client_name_len check (char_length(client_name) <= 200),
  constraint connector_grants_agent_ids_len check (cardinality(agent_ids) <= 64)
);

alter table public.connector_grants enable row level security;

drop policy if exists "Connector grants: own rows readable" on public.connector_grants;
create policy "Connector grants: own rows readable"
  on public.connector_grants for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Connector grants: own session inserts" on public.connector_grants;
create policy "Connector grants: own session inserts"
  on public.connector_grants for insert to authenticated
  with check ((select auth.uid()) = user_id and (select auth.jwt() ->> 'client_id') is null);

drop policy if exists "Connector grants: own session updates" on public.connector_grants;
create policy "Connector grants: own session updates"
  on public.connector_grants for update to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt() ->> 'client_id') is null)
  with check ((select auth.uid()) = user_id and (select auth.jwt() ->> 'client_id') is null);

drop policy if exists "Connector grants: own session deletes" on public.connector_grants;
create policy "Connector grants: own session deletes"
  on public.connector_grants for delete to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt() ->> 'client_id') is null);

drop trigger if exists connector_grants_updated_at on public.connector_grants;
create trigger connector_grants_updated_at
  before update on public.connector_grants
  for each row execute function public.update_updated_at_column();

create table if not exists public.connector_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  tool text not null,
  agent_id text,
  ok boolean not null,
  code text,
  created_at timestamptz not null default now()
);

create index if not exists connector_calls_user_client_time_idx
  on public.connector_calls (user_id, client_id, created_at desc);
create index if not exists connector_calls_user_agent_tool_time_idx
  on public.connector_calls (user_id, agent_id, tool, created_at desc);

alter table public.connector_calls enable row level security;

drop policy if exists "Connector calls: own rows readable" on public.connector_calls;
create policy "Connector calls: own rows readable"
  on public.connector_calls for select to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists entity_activity_log_connector_visits_idx
  on public.entity_activity_log (user_id, agent_id, created_at desc)
  where activity_type = 'connector_visit';