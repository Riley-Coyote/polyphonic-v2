-- ============================================================================
-- Owner-rights function exposure audit
--
-- Read-only. Lists SECURITY DEFINER functions in `public` that signed-out
-- (anon) or signed-in (authenticated) users can call through the API. They skip
-- row-level security, so each one must check the caller itself or only answer
-- yes/no for RLS policies.
--
-- Paste into the Supabase SQL editor, or:
--   psql "$DATABASE_URL" -f supabase/audits/definer-function-exposure.sql
--
-- Pass criterion: every row has reviewed = true. Before
-- 20260926170000_lock_definer_functions_to_caller.sql is applied, the memory
-- search functions (match_*), the Mnemos maintenance functions,
-- anonymize_group_room_user and append_continuity_trace_write appear with
-- reviewed = false. The reviewed list matches
-- supabase/tests/definer_functions_caller_scope.test.sql.
-- ============================================================================

SELECT
  p.oid::regprocedure AS function,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS signed_out_can_call,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS signed_in_can_call,
  p.proname IN (
    'cognitive_memory_stats',
    'decrypt_user_api_key',
    'save_user_api_key',
    'delete_user_api_key',
    'mark_activity_seen',
    'is_handle_owner',
    'current_user_token_gate_email_bypass',
    'has_role',
    'is_group_room_member',
    'can_manage_group_room',
    'can_read_group_message'
  ) AS reviewed
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
ORDER BY reviewed, signed_out_can_call DESC, p.proname;
