-- SECURITY DEFINER functions skip row-level security, so any of them that takes
-- an account id must be closed to users, or must check the caller itself.
-- Covers supabase/migrations/20260926170000_lock_definer_functions_to_caller.sql.
-- Run: supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(22);

-- Every owner-rights function that signed-out or signed-in users can call must be
-- on this reviewed list. A new one fails here until it is revoked or reviewed.
SELECT is_empty(
  $$
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      AND p.proname NOT IN (
        'cognitive_memory_stats',               -- checks auth.uid()
        'decrypt_user_api_key',                 -- checks auth.uid()
        'save_user_api_key',                    -- acts on auth.uid()
        'delete_user_api_key',                  -- acts on auth.uid()
        'mark_activity_seen',                   -- acts on auth.uid()
        'is_handle_owner',                      -- compares with auth.uid()
        'current_user_token_gate_email_bypass', -- reads the caller's own JWT
        'has_role',                             -- yes/no for RLS policies
        'is_group_room_member',                 -- yes/no for RLS policies
        'can_manage_group_room',                -- yes/no for RLS policies
        'can_read_group_message'                -- yes/no for RLS policies
      )
  $$,
  'every owner-rights function open to users is on the reviewed list'
);

-- Two accounts. Alice must not reach Bob's rows.
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'alice@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'bob@example.test');
INSERT INTO public.engrams (id, user_id, agent_id, content, engram_type, embedding) VALUES
  ('a1000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'luca',
   'alice remembers the harbor at dawn', 'episodic', array_fill(0.01::real, ARRAY[1536])::vector),
  ('b1000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'luca',
   'bob private: the diagnosis nobody knows about', 'episodic', array_fill(0.01::real, ARRAY[1536])::vector);
INSERT INTO public.memories (user_id, agent_id, content) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'luca', 'bob private: the diagnosis nobody knows about');
INSERT INTO public.hypomnema_entry (user_id, agent_id, content, embedding) VALUES
  ('b0000000-0000-4000-8000-00000000000b', 'luca', 'bob private: afraid of losing the job',
   array_fill(0.01::real, ARRAY[1536])::vector);

-- Signed in as Alice, the way PostgREST runs an RPC.
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.match_engrams('diagnosis', 10, 'b0000000-0000-4000-8000-00000000000b', 'luca') $$,
  '42501', NULL, 'Alice cannot search Bob''s engrams by text');
SELECT throws_ok(
  $$ SELECT * FROM public.match_engrams_vector(array_fill(0.01::real, ARRAY[1536])::vector, 10,
       'b0000000-0000-4000-8000-00000000000b', -1, 'luca') $$,
  '42501', NULL, 'Alice cannot search Bob''s engrams by vector');
SELECT throws_ok(
  $$ SELECT * FROM public.match_memories('diagnosis', 10, 'b0000000-0000-4000-8000-00000000000b', 'luca') $$,
  '42501', NULL, 'Alice cannot search Bob''s memories');
SELECT throws_ok(
  $$ SELECT * FROM public.match_hypomnema_vector(array_fill(0.01::real, ARRAY[1536])::vector, 10, NULL, NULL) $$,
  '42501', NULL, 'Alice cannot list every account''s hypomnema');
SELECT throws_ok(
  $$ SELECT * FROM public.cognitive_memory_stats('b0000000-0000-4000-8000-00000000000b', 'luca') $$,
  '42501', NULL, 'Alice cannot read Bob''s memory stats');
SELECT is(
  (SELECT total_engrams FROM public.cognitive_memory_stats('a0000000-0000-4000-8000-00000000000a', 'luca')),
  1::bigint, 'Alice still reads her own memory stats');
SELECT throws_ok(
  $$ SELECT public.mnemos_rehearse_scope('b0000000-0000-4000-8000-00000000000b', 'luca', 150, 0.25) $$,
  '42501', NULL, 'Alice cannot rehearse Bob''s memory');
SELECT throws_ok(
  $$ SELECT public.mnemos_reconsolidate(ARRAY['b1000000-0000-4000-8000-00000000000b']::uuid[],
       'b0000000-0000-4000-8000-00000000000b', 'luca') $$,
  '42501', NULL, 'Alice cannot strengthen Bob''s engrams');
SELECT throws_ok(
  $$ SELECT public.anonymize_group_room_user('b0000000-0000-4000-8000-00000000000b') $$,
  '42501', NULL, 'Alice cannot remove Bob from his group rooms');
SELECT throws_ok(
  $$ SELECT public.append_continuity_trace_write(gen_random_uuid(), '{}'::jsonb) $$,
  '42501', NULL, 'Alice cannot write continuity traces');
SELECT throws_ok(
  $$ SELECT public.mnemos_run_rehearsal_cohort() $$,
  '42501', NULL, 'Alice cannot run cross-account maintenance');
RESET ROLE;

-- Signed out: the public anon key only.
SELECT set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', 'anon', true),
       set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT * FROM public.match_engrams('diagnosis', 10, 'b0000000-0000-4000-8000-00000000000b', 'luca') $$,
  '42501', NULL, 'A signed-out caller cannot search Bob''s engrams');
SELECT throws_ok(
  $$ SELECT * FROM public.match_hypomnema_vector(array_fill(0.01::real, ARRAY[1536])::vector, 10, NULL, NULL) $$,
  '42501', NULL, 'A signed-out caller cannot list every account''s hypomnema');
SELECT throws_ok(
  $$ SELECT * FROM public.cognitive_memory_stats('b0000000-0000-4000-8000-00000000000b', 'luca') $$,
  '42501', NULL, 'A signed-out caller cannot read memory stats');
SELECT throws_ok(
  $$ SELECT public.mnemos_run_digest_build_cohort() $$,
  '42501', NULL, 'A signed-out caller cannot start maintenance that spends on models');
RESET ROLE;

-- Edge functions use the service-role key and keep working.
SELECT set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

SELECT is(
  (SELECT count(*) FROM public.match_engrams('diagnosis nobody knows', 10, 'b0000000-0000-4000-8000-00000000000b', 'luca')),
  1::bigint, 'service role still searches a named account''s engrams by text');
SELECT is(
  (SELECT content FROM public.match_engrams_vector(array_fill(0.01::real, ARRAY[1536])::vector, 10,
     'b0000000-0000-4000-8000-00000000000b', 0.05, 'luca')),
  'bob private: the diagnosis nobody knows about', 'service role still searches engrams by vector');
SELECT is(
  (SELECT count(*) FROM public.match_memories('diagnosis nobody knows', 10, 'b0000000-0000-4000-8000-00000000000b', 'luca')),
  1::bigint, 'service role still searches memories');
SELECT is(
  (SELECT total_engrams FROM public.cognitive_memory_stats('b0000000-0000-4000-8000-00000000000b', 'luca')),
  1::bigint, 'service role reads any account''s memory stats');
SELECT is(
  public.mnemos_reconsolidate(ARRAY['b1000000-0000-4000-8000-00000000000b']::uuid[],
    'b0000000-0000-4000-8000-00000000000b', 'luca'),
  1, 'service role still reconsolidates');
RESET ROLE;

-- pg_cron runs maintenance as the functions' owner.
SELECT ok(
  has_function_privilege('postgres', 'public.mnemos_run_rehearsal_cohort()', 'EXECUTE'),
  'the owner (pg_cron) can still run maintenance');

SELECT * FROM finish();
ROLLBACK;
