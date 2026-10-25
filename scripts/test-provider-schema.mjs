// Runs only an in-memory PostgreSQL/WASM fixture; never connects to Supabase or a model provider.
// npm exec --yes --package=@electric-sql/pglite@0.3.14 -- node scripts/test-provider-schema.mjs
// PGlite has one backend connection. Queued contenders exercise CAS/idempotency, but cannot
// prove cross-session lock scheduling; that still requires a real PostgreSQL concurrency check.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const pgliteVersion = '0.3.14';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(repoRoot, 'supabase/migrations/20261024200000_connected_model_providers.sql');

async function loadPGlite() {
  // npm exec exposes its temporary node_modules/.bin on PATH, rather than changing ESM resolution.
  const roots = [
    join(repoRoot, 'node_modules'),
    ...(process.env.PATH ?? '').split(delimiter)
      .filter((entry) => entry.endsWith('/node_modules/.bin'))
      .map((entry) => dirname(entry)),
  ];
  for (const root of new Set(roots)) {
    const packagePath = join(root, '@electric-sql/pglite/package.json');
    if (!existsSync(packagePath)) continue;
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (metadata.version === pgliteVersion) {
      return import(pathToFileURL(join(dirname(packagePath), metadata.module)).href);
    }
  }
  throw new Error(`Run with npm exec --yes --package=@electric-sql/pglite@${pgliteVersion} -- node scripts/test-provider-schema.mjs`);
}

const { PGlite } = await loadPGlite();

// Keep the relevant legacy constraints/RLS accurate: threads.user_id and messages.user_id
// deliberately have no auth.users FK in the existing canonical schema. Inventing that cascade
// here would hide a provider-bound thread preventing account deletion.
const baseline = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.threads (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    title text,
    selected_model text
  );
  alter table public.threads enable row level security;
  create policy thread_self_read on public.threads for select using (auth.uid() = user_id);
  create policy thread_self_insert on public.threads for insert with check (auth.uid() = user_id);
  create policy thread_self_update on public.threads for update using (auth.uid() = user_id);
  create policy thread_self_delete on public.threads for delete using (auth.uid() = user_id);
  create policy thread_service on public.threads for all using (auth.role() = 'service_role');
  create table public.messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.threads(id) on delete cascade,
    user_id uuid not null,
    role text not null,
    content text not null default ''
  );
  alter table public.messages enable row level security;
  create policy message_self_read on public.messages for select using (auth.uid() = user_id);
  create policy message_self_insert on public.messages for insert with check (auth.uid() = user_id);
  create policy message_self_update on public.messages for update using (auth.uid() = user_id);
  create policy message_self_delete on public.messages for delete using (auth.uid() = user_id);
  create policy message_service on public.messages for all using (auth.role() = 'service_role');
`;

test('connected-provider schema regression', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(baseline);
  await db.exec(readFileSync(migrationPath, 'utf8'));

  const users = [randomUUID(), randomUUID(), randomUUID()];
  await db.query('insert into auth.users(id) select unnest($1::uuid[])', [users]);
  const [alice, bob, deleting] = users;

  async function asRole(role, user, callback, claimRole = role) {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claim.role', $1, true), set_config('request.jwt.claim.sub', $2, true)", [claimRole ?? '', user ?? '']);
      return callback(tx);
    });
  }

  const service = (callback) => asRole('service_role', null, callback);
  const value = async (client, sql, params = []) => (await client.query(sql, params)).rows[0]?.value;
  const denied = (operation, message = /permission denied|Not authorized/) => assert.rejects(operation, message);

  async function secret(client, action, options) {
    const { user = alice, id, metadata = null, ciphertext = null, version = null, lease = null } = options;
    return value(client, 'select public.provider_secret($1, $2, $3, $4::jsonb, $5, $6, $7) as value',
      [action, user, id, metadata === null ? null : JSON.stringify(metadata), ciphertext, version, lease]);
  }

  const metadata = (overrides = {}) => ({
    provider: 'anthropic', label: 'Fixture API account', subject: null, workspace_id: null,
    status: 'connected', granted_scopes: [], expires_at: null, ...overrides,
  });

  async function connection(user = alice, overrides = {}) {
    const id = randomUUID();
    const row = await service((tx) => secret(tx, 'save', {
      user, id, metadata: metadata(overrides), ciphertext: 'fixture-encrypted-credential', version: 0,
    }));
    return row;
  }

  async function thread(user, connectionId = null) {
    const id = randomUUID();
    await db.query('insert into public.threads(id, user_id, provider_connection_id, selected_model) values ($1, $2, $3, $4)', [id, user, connectionId, connectionId ? 'claude-fixture' : null]);
    return id;
  }

  async function message(user, threadId, role = 'user', id = randomUUID()) {
    await db.query('insert into public.messages(id, user_id, thread_id, role, content) values ($1, $2, $3, $4, $5)',
      [id, user, threadId, role, 'local fixture']);
    return id;
  }

  async function oauth(client, action, options = {}) {
    const { state = null, user = null, ticket = null, binding = null, payload = null, expires = null } = options;
    return value(client, 'select public.provider_oauth_state($1, $2, $3, $4, $5, $6, $7) as value',
      [action, state, user, ticket, binding, payload, expires]);
  }

  async function oauthFixture(user = alice, overrides = {}) {
    const options = {
      state: `state-${randomUUID()}`, user, ticket: `ticket-${randomUUID()}`,
      payload: 'fixture-encrypted-oauth-payload', expires: new Date(Date.now() + 300_000).toISOString(),
      ...overrides,
    };
    await service((tx) => oauth(tx, 'create', options));
    return options;
  }

  async function turn(client, action, options) {
    const { user = alice, userMessage, threadId, connectionId, assistant = null } = options;
    return value(client, 'select public.provider_turn($1, $2, $3, $4, $5, $6) as value',
      [action, user, userMessage, threadId, connectionId, assistant]);
  }

  await t.test('metadata is owner-readable while all secrets and broker writes are service-only', async () => {
    const a = await connection(alice);
    const b = await connection(bob);
    const rows = await asRole('authenticated', alice, (tx) => tx.query('select id, user_id from public.provider_connections order by id'));
    assert.deepEqual(rows.rows, [{ id: a.connection.id, user_id: alice }]);
    const anonymous = await asRole('authenticated', null, (tx) => tx.query('select id from public.provider_connections'));
    assert.equal(anonymous.rows.length, 0);
    await denied(asRole('anon', null, (tx) => tx.query('select * from public.provider_connections')));
    await denied(asRole('authenticated', alice, (tx) => tx.query(
      "insert into public.provider_connections(id, user_id, provider, label, status) values ($1, $2, 'anthropic', 'Forged account', 'connected')",
      [randomUUID(), alice],
    )));
    await denied(asRole('authenticated', alice, (tx) => tx.query('update public.provider_connections set label = $1 where id = $2', ['changed', a.connection.id])));
    await denied(asRole('authenticated', alice, (tx) => tx.query('delete from public.provider_connections where id = $1', [a.connection.id])));
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['provider_credentials', 'provider_oauth_transactions', 'provider_turns']) {
        await denied(asRole(role, alice, (tx) => tx.query(`select * from private.${table}`)));
      }
      await denied(asRole(role, alice, (tx) => secret(tx, 'get', { id: a.connection.id })));
      await denied(asRole(role, alice, (tx) => oauth(tx, 'consume')));
      await denied(asRole(role, alice, (tx) => turn(tx, 'claim', {
        userMessage: randomUUID(), threadId: randomUUID(), connectionId: a.connection.id,
      })));
    }
    assert.equal((await service((tx) => secret(tx, 'get', { user: bob, id: b.connection.id }))).encrypted_secret, 'fixture-encrypted-credential');
  });

  await t.test('broker authorization fails closed for missing or non-service JWT roles', async () => {
    const row = await connection();
    for (const claimRole of [null, 'anon', 'authenticated']) {
      await denied(asRole('service_role', alice, (tx) => secret(tx, 'get', { id: row.connection.id }), claimRole));
      await denied(asRole('service_role', alice, (tx) => oauth(tx, 'consume'), claimRole));
      await denied(asRole('service_role', alice, (tx) => turn(tx, 'claim', {
        userMessage: randomUUID(), threadId: randomUUID(), connectionId: row.connection.id,
      }), claimRole));
    }
  });

  await t.test('trusted broker calls still enforce connection ownership and non-null identities', async () => {
    const row = await connection();
    for (const action of ['get', 'save', 'lease', 'disconnect', 'invalidate']) {
      await denied(service((tx) => secret(tx, action, {
        user: bob, id: row.connection.id, version: row.version, metadata: metadata(),
        ciphertext: 'other-user-secret', lease: randomUUID(),
      })));
    }
    await denied(service((tx) => secret(tx, 'get', { user: null, id: row.connection.id })));
    await denied(service((tx) => secret(tx, 'get', { id: null })));
    const unchanged = await service((tx) => secret(tx, 'get', { id: row.connection.id }));
    assert.equal(unchanged.version, row.version);
    assert.equal(unchanged.encrypted_secret, row.encrypted_secret);
  });

  await t.test('queued first-create contenders yield one CAS winner and preserve serialization guards', async () => {
    const id = randomUUID();
    const contenders = await Promise.allSettled(['first', 'second'].map((label) => service((tx) => secret(tx, 'save', {
      id, version: 0, metadata: metadata({ label }), ciphertext: `encrypted-${label}`,
    }))));
    assert.equal(contenders.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(contenders.filter((result) => result.status === 'rejected').length, 1);
    const winner = contenders.find((result) => result.status === 'fulfilled').value;
    const stored = await service((tx) => secret(tx, 'get', { id }));
    assert.equal(stored.version, 1);
    assert.equal(stored.encrypted_secret, winner.encrypted_secret);
    await denied(service((tx) => secret(tx, 'save', {
      user: bob, id, version: 0, metadata: metadata(), ciphertext: 'losing-owner',
    })));
    // PGlite's single-user backend does not expose held advisory locks in pg_locks. Check
    // the installed function's guard here; this is explicitly not a multi-session race proof.
    const definition = await value(db, "select pg_get_functiondef('public.provider_secret(text,uuid,uuid,jsonb,text,bigint,uuid)'::regprocedure) as value");
    const lock = definition.indexOf('pg_advisory_xact_lock');
    const lookup = definition.search(/\bfrom\s+public\.provider_connections\s+where\s+id\s*=\s*p_id\s+for\s+update\b/i);
    assert.ok(lock >= 0 && lookup > lock, 'creation must serialize before its ownership/version lookup');
    const claimDefinition = await value(db, "select pg_get_functiondef('public.provider_turn(text,uuid,uuid,uuid,uuid,uuid)'::regprocedure) as value");
    assert.match(claimDefinition, /from public\.provider_connections[\s\S]*?for update/i,
      'claim must serialize against disconnect before recording paid dispatch');
  });

  await t.test('refresh/reconnect CAS rejects stale callbacks and stale invalidation', async () => {
    const original = await connection();
    const id = original.connection.id;
    const updated = await service((tx) => secret(tx, 'save', {
      id, version: original.version, metadata: metadata({ label: 'Reconnected' }), ciphertext: 'newer-encrypted-secret',
    }));
    assert.equal(updated.version, original.version + 1);
    await assert.rejects(service((tx) => secret(tx, 'save', {
      id, version: original.version, metadata: metadata(), ciphertext: 'late-callback',
    })), /Connection changed/);
    assert.equal(await service((tx) => secret(tx, 'invalidate', { id, version: original.version })), null);
    const stored = await service((tx) => secret(tx, 'get', { id }));
    assert.equal(stored.connection.status, 'connected');
    assert.equal(stored.encrypted_secret, 'newer-encrypted-secret');
    await assert.rejects(service((tx) => secret(tx, 'save', {
      id, version: updated.version, metadata: metadata({ provider: 'chatgpt' }), ciphertext: 'wrong-provider',
    })), /Provider changed/);
    await assert.rejects(service((tx) => secret(tx, 'save', {
      id, version: updated.version, metadata: metadata(), ciphertext: null,
    })), /Missing credential/);
  });

  await t.test('refresh leases are exclusive and fail closed for wrong, missing, or expired leases', async () => {
    const original = await connection();
    const id = original.connection.id;
    const lease = randomUUID();
    assert.equal(await service((tx) => secret(tx, 'lease', { id, version: original.version, lease: null })), null);
    const held = await service((tx) => secret(tx, 'lease', { id, version: original.version, lease }));
    assert.equal(held.lease_id, lease);
    assert.equal(await service((tx) => secret(tx, 'lease', { id, version: original.version, lease: randomUUID() })), null);
    await assert.rejects(service((tx) => secret(tx, 'save', {
      id, version: original.version, lease: randomUUID(), metadata: metadata(), ciphertext: 'wrong-lease',
    })), /Refresh lease expired/);
    await db.query('update private.provider_credentials set lease_until = null where connection_id = $1', [id]);
    await assert.rejects(service((tx) => secret(tx, 'save', {
      id, version: original.version, lease, metadata: metadata(), ciphertext: 'null-expiry',
    })), /Refresh lease expired/);
    await db.query("update private.provider_credentials set lease_until = now() - interval '1 second' where connection_id = $1", [id]);
    await assert.rejects(service((tx) => secret(tx, 'save', {
      id, version: original.version, lease, metadata: metadata(), ciphertext: 'expired-lease',
    })), /Refresh lease expired/);
    const nextLease = randomUUID();
    assert.equal((await service((tx) => secret(tx, 'lease', { id, version: original.version, lease: nextLease }))).lease_id, nextLease);
    const refreshed = await service((tx) => secret(tx, 'save', {
      id, version: original.version, lease: nextLease, metadata: metadata(), ciphertext: 'refreshed-secret',
    }));
    assert.equal(refreshed.version, original.version + 1);
    assert.equal(refreshed.lease_id, null);
    assert.equal(refreshed.lease_until, null);
  });

  await t.test('disconnect prevents pending refresh or reconnect from resurrecting a credential', async () => {
    const original = await connection();
    const id = original.connection.id;
    const lease = randomUUID();
    await service((tx) => secret(tx, 'lease', { id, version: original.version, lease }));
    const disconnected = await service((tx) => secret(tx, 'disconnect', { id }));
    assert.equal(disconnected.connection.status, 'disabled');
    assert.deepEqual(disconnected.connection.granted_scopes, []);
    assert.equal(disconnected.encrypted_secret, null);
    assert.equal(disconnected.lease_id, null);
    assert.equal(disconnected.version, original.version + 1);
    for (const oldLease of [null, lease]) {
      await assert.rejects(service((tx) => secret(tx, 'save', {
        id, version: original.version, lease: oldLease, metadata: metadata(), ciphertext: 'late-secret',
      })), /Connection changed/);
    }
    assert.equal(await service((tx) => secret(tx, 'lease', { id, version: disconnected.version, lease: randomUUID() })), null);
  });

  await t.test('provider selection is immutable at thread creation and composite ownership is enforced', async () => {
    const a = await connection(alice);
    const b = await connection(bob);
    const bound = await thread(alice, a.connection.id);
    const legacy = await thread(alice);
    await assert.rejects(db.query(
      'insert into public.threads(id, user_id, provider_connection_id) values ($1, $2, $3)',
      [randomUUID(), alice, a.connection.id],
    ), /thread_provider_requires_model/);
    await assert.rejects(asRole('authenticated', alice, (tx) => tx.query(
      "insert into public.threads(id, user_id, provider_connection_id, selected_model) values ($1, $2, $3, 'claude-fixture')",
      [randomUUID(), alice, b.connection.id],
    )), /foreign key|thread_provider_same_owner/i);
    for (const [threadId, connectionId] of [[bound, null], [bound, b.connection.id], [legacy, a.connection.id]]) {
      await assert.rejects(asRole('authenticated', alice, (tx) => tx.query(
        'update public.threads set provider_connection_id = $1 where id = $2', [connectionId, threadId],
      )), /creating a new conversation/);
    }
    await asRole('authenticated', alice, (tx) => tx.query(
      'update public.threads set provider_connection_id = $1 where id = $2', [a.connection.id, bound],
    ));
  });

  await t.test('OAuth browser binding is atomic and state consumption is one-use', async () => {
    const pending = await oauthFixture();
    const binding = `binding-${randomUUID()}`;
    assert.equal(await service((tx) => oauth(tx, 'bind', { ticket: 'wrong-ticket', binding })), null);
    const bound = await service((tx) => oauth(tx, 'bind', { ticket: pending.ticket, binding }));
    assert.equal(bound.state_hash, pending.state);
    assert.equal(bound.user_id, alice);
    assert.ok(!Object.hasOwn(bound, 'ticket_hash'));
    assert.ok(!Object.hasOwn(bound, 'binding_hash'));
    assert.equal(await service((tx) => oauth(tx, 'bind', { ticket: pending.ticket, binding: 'other-binding' })), null);
    assert.equal(await service((tx) => oauth(tx, 'consume', { state: pending.state, binding: 'other-binding' })), null);
    const consumed = await service((tx) => oauth(tx, 'consume', { state: pending.state, binding }));
    assert.equal(consumed.encrypted_payload, pending.payload);
    assert.equal(await service((tx) => oauth(tx, 'consume', { state: pending.state, binding })), null);
  });

  await t.test('OAuth expiry and authenticated completion reject replay or the wrong Polyphonic user', async () => {
    for (const expires of [null, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 720_000).toISOString()]) {
      await assert.rejects(oauthFixture(alice, { expires }), /Invalid expiry/);
    }
    const expired = await oauthFixture();
    await db.query("update private.provider_oauth_transactions set expires_at = now() - interval '1 second' where state_hash = $1", [expired.state]);
    assert.equal(await service((tx) => oauth(tx, 'finish', { ticket: expired.ticket, user: alice })), null);
    const completion = await oauthFixture();
    assert.equal(await service((tx) => oauth(tx, 'finish', { ticket: completion.ticket, user: bob })), null);
    assert.equal(await service((tx) => oauth(tx, 'finish', { ticket: completion.ticket, user: null })), null);
    assert.equal(await service((tx) => oauth(tx, 'finish', { ticket: 'wrong-ticket', user: alice })), null);
    const finished = await service((tx) => oauth(tx, 'finish', { ticket: completion.ticket, user: alice }));
    assert.equal(finished.user_id, alice);
    assert.equal(finished.encrypted_payload, completion.payload);
    assert.equal(await service((tx) => oauth(tx, 'finish', { ticket: completion.ticket, user: alice })), null);
    const browserState = await oauthFixture();
    await service((tx) => oauth(tx, 'bind', { ticket: browserState.ticket, binding: 'browser-cookie-binding' }));
    assert.equal(await service((tx) => oauth(tx, 'finish', { ticket: browserState.ticket, user: alice })), null);
  });

  await t.test('paid dispatch claims are one-per-user-message and enforce canonical ownership/runtime/status', async () => {
    const account = await connection();
    const threadId = await thread(alice, account.connection.id);
    const userMessage = await message(alice, threadId);
    const options = { userMessage, threadId, connectionId: account.connection.id, assistant: randomUUID() };
    assert.deepEqual(await service((tx) => turn(tx, 'status', options)), { claimed: false, state: null, assistant_id: null });
    await assert.rejects(service((tx) => turn(tx, 'claim', { ...options, assistant: null })), /Missing assistant reservation/);
    const reservations = [options.assistant, randomUUID()];
    const attempts = await Promise.all(reservations.map((assistant) => service((tx) => turn(tx, 'claim', { ...options, assistant }))));
    assert.equal(attempts.filter((attempt) => attempt.claimed).length, 1);
    const winningReservation = reservations[attempts.findIndex((attempt) => attempt.claimed)];
    assert.deepEqual(attempts.find((attempt) => !attempt.claimed), { claimed: false, state: 'dispatched', assistant_id: winningReservation });
    const otherAccount = await connection();
    const otherThread = await thread(alice, otherAccount.connection.id);
    for (const changed of [
      { user: bob }, { threadId: otherThread }, { connectionId: otherAccount.connection.id },
      { userMessage: await message(alice, threadId, 'assistant') },
    ]) {
      await denied(service((tx) => turn(tx, 'claim', { ...options, ...changed })));
    }
    const undispatched = await message(alice, threadId);
    await service((tx) => secret(tx, 'disconnect', { id: account.connection.id }));
    await denied(service((tx) => turn(tx, 'claim', { ...options, userMessage: undispatched })));
    assert.deepEqual(await service((tx) => turn(tx, 'status', options)), { claimed: false, state: 'dispatched', assistant_id: winningReservation });
    await denied(service((tx) => turn(tx, 'status', { ...options, user: bob })));
    assert.equal((await db.query('select count(*)::int as total from private.provider_turns where user_message_id = $1', [undispatched])).rows[0].total, 0);
  });

  await t.test('finished and unknown turns cannot be dispatched again or acquire an unrelated assistant', async () => {
    const account = await connection();
    const threadId = await thread(alice, account.connection.id);
    const userMessage = await message(alice, threadId);
    const options = { userMessage, threadId, connectionId: account.connection.id, assistant: randomUUID() };
    await service((tx) => turn(tx, 'claim', options));
    for (const assistant of [null, userMessage, await message(bob, await thread(bob), 'assistant')]) {
      await denied(service((tx) => turn(tx, 'finish', { ...options, assistant })));
    }
    const unrelatedAssistant = await message(alice, threadId, 'assistant');
    await assert.rejects(service((tx) => turn(tx, 'finish', {
      ...options, assistant: unrelatedAssistant,
    })), /Assistant reservation changed/);
    const assistant = await message(alice, threadId, 'assistant', options.assistant);
    await service((tx) => turn(tx, 'finish', { ...options, assistant }));
    assert.deepEqual(await service((tx) => turn(tx, 'claim', options)), { claimed: false, state: 'finished', assistant_id: assistant });
    await service((tx) => turn(tx, 'unknown', options));
    assert.equal((await service((tx) => turn(tx, 'claim', options))).state, 'finished');
    const unknown = { ...options, userMessage: await message(alice, threadId), assistant: randomUUID() };
    await service((tx) => turn(tx, 'claim', unknown));
    await service((tx) => turn(tx, 'unknown', unknown));
    assert.deepEqual(await service((tx) => turn(tx, 'claim', unknown)), { claimed: false, state: 'unknown', assistant_id: unknown.assistant });
    await message(alice, threadId, 'assistant', unknown.assistant);
    await service((tx) => turn(tx, 'finish', unknown));
    assert.equal((await service((tx) => turn(tx, 'claim', unknown))).state, 'finished');
  });

  await t.test('one conversation cannot dispatch overlapping turns and stale reservations become unknown', async () => {
    const account = await connection();
    const threadId = await thread(alice, account.connection.id);
    const first = { userMessage: await message(alice, threadId), threadId, connectionId: account.connection.id, assistant: randomUUID() };
    const next = { ...first, userMessage: await message(alice, threadId), assistant: randomUUID() };
    await service((tx) => turn(tx, 'claim', first));
    await assert.rejects(service((tx) => turn(tx, 'claim', next)), /already in flight/);
    await db.query("update private.provider_turns set created_at = now() - interval '11 minutes' where user_message_id = $1", [first.userMessage]);
    assert.deepEqual(await service((tx) => turn(tx, 'claim', next)), { claimed: true });
    assert.equal((await service((tx) => turn(tx, 'status', first))).state, 'unknown');
    await assert.rejects(service((tx) => turn(tx, 'claim', first)), /already in flight/);
  });

  await t.test('a persisted reserved reply remains recoverable and can finish after disconnect', async () => {
    const account = await connection();
    const threadId = await thread(alice, account.connection.id);
    const options = {
      userMessage: await message(alice, threadId), threadId,
      connectionId: account.connection.id, assistant: randomUUID(),
    };
    await service((tx) => turn(tx, 'claim', options));
    await message(alice, threadId, 'assistant', options.assistant);
    // Model and DB work completed, but the response/finish acknowledgement was interrupted.
    await service((tx) => secret(tx, 'disconnect', { id: account.connection.id }));
    assert.deepEqual(await service((tx) => turn(tx, 'status', options)), {
      claimed: false, state: 'dispatched', assistant_id: options.assistant,
    });
    await service((tx) => turn(tx, 'finish', options));
    assert.deepEqual(await service((tx) => turn(tx, 'status', options)), {
      claimed: false, state: 'finished', assistant_id: options.assistant,
    });
    await denied(service((tx) => turn(tx, 'claim', options)));
    assert.equal((await db.query('select count(*)::int as total from private.provider_turns where user_message_id = $1', [options.userMessage])).rows[0].total, 1);
  });

  await t.test('account deletion removes connected conversations, secrets, OAuth state, and turn claims', async () => {
    const account = await connection(deleting);
    const threadId = await thread(deleting, account.connection.id);
    const userMessage = await message(deleting, threadId);
    const assistant = randomUUID();
    const legacy = await thread(deleting);
    const pending = await oauthFixture(deleting);
    await service((tx) => turn(tx, 'claim', { user: deleting, userMessage, threadId, connectionId: account.connection.id, assistant }));
    await message(deleting, threadId, 'assistant', assistant);
    await service((tx) => turn(tx, 'finish', { user: deleting, userMessage, threadId, connectionId: account.connection.id, assistant }));
    const other = await connection(bob);
    await db.query('delete from auth.users where id = $1', [deleting]);
    for (const [sql, params] of [
      ['select count(*)::int as total from public.provider_connections where user_id = $1', [deleting]],
      ['select count(*)::int as total from private.provider_credentials where connection_id = $1', [account.connection.id]],
      ['select count(*)::int as total from private.provider_oauth_transactions where state_hash = $1', [pending.state]],
      ['select count(*)::int as total from private.provider_turns where user_id = $1', [deleting]],
      ['select count(*)::int as total from public.threads where id = $1', [threadId]],
      ['select count(*)::int as total from public.messages where thread_id = $1', [threadId]],
    ]) {
      assert.equal((await db.query(sql, params)).rows[0].total, 0, sql);
    }
    assert.equal((await db.query('select count(*)::int as total from public.threads where id = $1', [legacy])).rows[0].total, 1, 'additive cleanup leaves legacy unconnected conversations alone');
    assert.equal((await service((tx) => secret(tx, 'get', { user: bob, id: other.connection.id }))).encrypted_secret, 'fixture-encrypted-credential');
  });
});
