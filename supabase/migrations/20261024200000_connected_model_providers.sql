-- Additive connected-provider foundation. Existing OpenRouter keys/chat are unchanged.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic','chatgpt')),
  label text not null check (length(label) between 1 and 120),
  subject text,
  workspace_id text,
  status text not null check (status in ('connected','identity_only','needs_reconnect','disabled')),
  granted_scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);
alter table public.provider_connections enable row level security;
revoke all on public.provider_connections from public, anon, authenticated;
grant select on public.provider_connections to authenticated;
grant all on public.provider_connections to service_role;
create policy provider_connections_self_read on public.provider_connections for select to authenticated
  using(user_id=auth.uid());

create table private.provider_credentials (
  connection_id uuid primary key references public.provider_connections(id) on delete cascade,
  encrypted_secret text check (length(encrypted_secret)<=131072),
  version bigint not null default 1,
  lease_id uuid,
  lease_until timestamptz
);
revoke all on private.provider_credentials from public, anon, authenticated;
grant all on private.provider_credentials to service_role;

alter table public.threads add column provider_connection_id uuid;
alter table public.threads add constraint thread_provider_requires_model check(provider_connection_id is null or selected_model is not null);
alter table public.threads add constraint thread_provider_same_owner
  foreign key(provider_connection_id,user_id) references public.provider_connections(id,user_id)
  deferrable initially deferred;
create index threads_provider_connection on public.threads(provider_connection_id) where provider_connection_id is not null;

-- Legacy threads have no auth.users owner FK. Remove connected threads before credentials cascade away.
create function public.cleanup_connected_provider_threads() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  delete from public.threads where user_id=old.id and provider_connection_id is not null;
  return old;
end $$;
revoke all on function public.cleanup_connected_provider_threads() from public,anon,authenticated;
create trigger users_remove_connected_threads before delete on auth.users
for each row execute function public.cleanup_connected_provider_threads();

create function public.guard_thread_provider_binding() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if old.provider_connection_id is distinct from new.provider_connection_id then
    raise exception 'Choose a provider when creating a new conversation';
  end if;
  return new;
end $$;
create trigger threads_keep_provider before update of provider_connection_id on public.threads
for each row execute function public.guard_thread_provider_binding();

-- Service-only broker. Ciphertext is encrypted/decrypted in Edge Functions with per-user/record authenticated data.
-- Version and lease checks prevent late refreshes or pending reconnects from resurrecting a disconnected account.
create function public.provider_secret(
  p_action text,p_user uuid,p_id uuid,p_metadata jsonb default null,p_secret text default null,
  p_version bigint default null,p_lease uuid default null
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.provider_connections; s private.provider_credentials;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized'; end if;
  if p_user is null or p_id is null then raise exception 'Not authorized'; end if;
  -- The lock also serializes first creation, where there is not yet a row to lock.
  perform pg_advisory_xact_lock(hashtextextended('provider:'||p_id::text,0));
  select * into c from public.provider_connections where id=p_id for update;
  if found and c.user_id<>p_user then raise exception 'Not authorized'; end if;
  select * into s from private.provider_credentials where connection_id=p_id for update;
  if p_action='get' then
    if c.id is null then return null; end if;
  elsif p_action='save' then
    if c.id is not null and (p_version is null or s.version is null or p_version is distinct from s.version) then raise exception 'Connection changed'; end if;
    if c.id is null and coalesce(p_version,0)<>0 then raise exception 'Connection changed'; end if;
    if p_secret is null or length(p_secret)=0 then raise exception 'Missing credential'; end if;
    if p_lease is not null and (s.lease_id is distinct from p_lease or s.lease_until is null or s.lease_until<=now()) then raise exception 'Refresh lease expired'; end if;
    if c.id is not null and c.provider<>(p_metadata->>'provider') then raise exception 'Provider changed'; end if;
    insert into public.provider_connections(id,user_id,provider,label,subject,workspace_id,status,granted_scopes,expires_at)
    values(p_id,p_user,p_metadata->>'provider',p_metadata->>'label',p_metadata->>'subject',p_metadata->>'workspace_id',
      p_metadata->>'status',array(select jsonb_array_elements_text(coalesce(p_metadata->'granted_scopes','[]'::jsonb))),
      nullif(p_metadata->>'expires_at','')::timestamptz)
    on conflict(id) do update set label=excluded.label,subject=excluded.subject,workspace_id=excluded.workspace_id,
      status=excluded.status,granted_scopes=excluded.granted_scopes,expires_at=excluded.expires_at,updated_at=now();
    insert into private.provider_credentials(connection_id,encrypted_secret,version) values(p_id,p_secret,1)
    on conflict(connection_id) do update set encrypted_secret=excluded.encrypted_secret,
      version=provider_credentials.version+1,lease_id=null,lease_until=null;
  elsif p_action='lease' then
    if p_lease is null or c.status is distinct from 'connected' or s.encrypted_secret is null or s.version is distinct from p_version then return null; end if;
    if s.lease_until>now() then return null; end if;
    update private.provider_credentials set lease_id=p_lease,lease_until=now()+interval '45 seconds' where connection_id=p_id;
  elsif p_action='disconnect' then
    if c.id is null then return null; end if;
    update public.provider_connections set status='disabled',expires_at=null,granted_scopes='{}',updated_at=now() where id=p_id;
    update private.provider_credentials set encrypted_secret=null,version=version+1,lease_id=null,lease_until=null where connection_id=p_id;
    -- Pending OAuth callbacks and leases can no longer save with their old version.
  elsif p_action='invalidate' then
    if c.id is null or s.version is distinct from p_version then return null; end if;
    update public.provider_connections set status='needs_reconnect',updated_at=now() where id=p_id;
    update private.provider_credentials set lease_id=null,lease_until=null where connection_id=p_id;
  else raise exception 'Unknown provider action';
  end if;
  select * into c from public.provider_connections where id=p_id;
  select * into s from private.provider_credentials where connection_id=p_id;
  return jsonb_build_object('connection',to_jsonb(c),'encrypted_secret',s.encrypted_secret,'version',s.version,
    'lease_id',s.lease_id,'lease_until',s.lease_until);
end $$;
revoke all on function public.provider_secret(text,uuid,uuid,jsonb,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.provider_secret(text,uuid,uuid,jsonb,text,bigint,uuid) to service_role;

create table private.provider_oauth_transactions (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_hash text unique,
  binding_hash text,
  encrypted_payload text not null,
  expires_at timestamptz not null
);
create index provider_oauth_expiry on private.provider_oauth_transactions(expires_at);
revoke all on private.provider_oauth_transactions from public,anon,authenticated;
grant all on private.provider_oauth_transactions to service_role;

create function public.provider_oauth_state(
  p_action text,p_state_hash text default null,p_user uuid default null,p_ticket_hash text default null,
  p_binding_hash text default null,p_payload text default null,p_expires timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare t private.provider_oauth_transactions;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized'; end if;
  delete from private.provider_oauth_transactions where expires_at<=now();
  if p_action='create' then
    if p_expires is null or p_expires<=now() or p_expires>now()+interval '11 minutes' then raise exception 'Invalid expiry'; end if;
    insert into private.provider_oauth_transactions values(p_state_hash,p_user,p_ticket_hash,null,p_payload,p_expires) returning * into t;
  elsif p_action='bind' then
    update private.provider_oauth_transactions set ticket_hash=null,binding_hash=p_binding_hash
      where ticket_hash=p_ticket_hash and expires_at>now() returning * into t;
  elsif p_action='consume' then
    delete from private.provider_oauth_transactions where state_hash=p_state_hash and binding_hash=p_binding_hash
      and binding_hash is not null and expires_at>now() returning * into t;
  elsif p_action='finish' then
    -- Finalization also requires the original Polyphonic login, preventing cross-browser account binding.
    delete from private.provider_oauth_transactions where ticket_hash=p_ticket_hash and user_id=p_user
      and binding_hash is null and expires_at>now() returning * into t;
  else raise exception 'Unknown OAuth action'; end if;
  if t.state_hash is null then return null; end if;
  return to_jsonb(t)-'ticket_hash'-'binding_hash';
end $$;
revoke all on function public.provider_oauth_state(text,text,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.provider_oauth_state(text,text,uuid,text,text,text,timestamptz) to service_role;

-- Atomic paid-dispatch claim per canonical user row. A disconnect/timeout never implicitly starts it again.
create table private.provider_turns (
  user_message_id uuid primary key references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) deferrable initially deferred,
  assistant_id uuid,
  state text not null check(state in ('dispatched','finished','unknown')),
  created_at timestamptz not null default now()
);
revoke all on private.provider_turns from public,anon,authenticated;
grant all on private.provider_turns to service_role;
create function public.provider_turn(p_action text,p_user uuid,p_message uuid,p_thread uuid,p_connection uuid,p_assistant uuid default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare t private.provider_turns;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized'; end if;
  -- Serialize authorization with disconnect; a claimed turn may finish, but a disabled connection cannot start another.
  perform 1 from public.provider_connections where id=p_connection and user_id=p_user for update;
  if not found then raise exception 'Not authorized'; end if;
  if not exists(select 1 from public.messages m join public.threads th on th.id=m.thread_id
    join public.provider_connections c on c.id=th.provider_connection_id
    where m.id=p_message and m.user_id=p_user and m.thread_id=p_thread and m.role='user'
    and th.user_id=p_user and th.provider_connection_id=p_connection
    and (p_action<>'claim' or c.status='connected')) then raise exception 'Not authorized'; end if;
  if p_action='status' then
    select * into t from private.provider_turns where user_message_id=p_message and user_id=p_user and thread_id=p_thread and connection_id=p_connection;
    return jsonb_build_object('claimed',false,'state',t.state,'assistant_id',t.assistant_id);
  elsif p_action='claim' then
    if p_assistant is null then raise exception 'Missing assistant reservation'; end if;
    update private.provider_turns set state='unknown' where thread_id=p_thread and state='dispatched' and created_at<now()-interval '10 minutes';
    if exists(select 1 from private.provider_turns where thread_id=p_thread and state='dispatched' and user_message_id<>p_message) then raise exception 'A turn is already in flight'; end if;
    insert into private.provider_turns(user_message_id,user_id,thread_id,connection_id,assistant_id,state)
      values(p_message,p_user,p_thread,p_connection,p_assistant,'dispatched') on conflict do nothing returning * into t;
    if t.user_message_id is not null then return jsonb_build_object('claimed',true); end if;
    select * into t from private.provider_turns where user_message_id=p_message;
    if t.user_id<>p_user or t.thread_id<>p_thread or t.connection_id<>p_connection then raise exception 'Not authorized'; end if;
    return jsonb_build_object('claimed',false,'state',t.state,'assistant_id',t.assistant_id);
  elsif p_action in ('finish','unknown') then
    if p_action='finish' and not exists(select 1 from public.messages where id=p_assistant and user_id=p_user and thread_id=p_thread and role='assistant') then raise exception 'Not authorized'; end if;
    if p_action='finish' and not exists(select 1 from private.provider_turns where user_message_id=p_message and user_id=p_user
      and thread_id=p_thread and connection_id=p_connection and assistant_id=p_assistant) then raise exception 'Assistant reservation changed'; end if;
    update private.provider_turns set state=case when p_action='finish' then 'finished' else 'unknown' end,
      assistant_id=case when p_action='finish' then p_assistant else assistant_id end
      where user_message_id=p_message and user_id=p_user and thread_id=p_thread and connection_id=p_connection
      and (state='dispatched' or (p_action='finish' and state='unknown'));
    return '{}'::jsonb;
  else raise exception 'Unknown turn action'; end if;
end $$;
revoke all on function public.provider_turn(text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.provider_turn(text,uuid,uuid,uuid,uuid,uuid) to service_role;
