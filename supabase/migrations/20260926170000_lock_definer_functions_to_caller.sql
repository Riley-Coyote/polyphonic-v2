-- Stop one account from reading or changing another account's memory through
-- SECURITY DEFINER functions.
--
-- These functions run with their owner's rights, so row-level security does not
-- apply inside them, and each acts on whatever account (or row) the caller names.
-- On Supabase a new function in `public` is executable by PUBLIC, anon and
-- authenticated until revoked: `GRANT ... TO service_role` alone restricts
-- nothing, and neither does `REVOKE ... FROM PUBLIC` alone.
--
-- Callers, checked 2026-09-26 against main:
--   * Every edge-function call to these functions uses the service-role client.
--   * The browser calls only cognitive_memory_stats (src/stores/cognitiveStore.ts),
--     always with the signed-in user's own id.
--   * pg_cron runs the maintenance functions as their owner, which keeps EXECUTE.
--
-- Test: supabase/tests/definer_functions_caller_scope.test.sql

-- 1. Retrieval. Returns memory content for the user id the caller passes.
--    match_hypomnema_vector has no callers, and with p_user_id NULL it returns
--    every account's entries.
REVOKE EXECUTE ON FUNCTION public.match_memories(text, integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_engrams(text, integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_engrams_vector(vector, integer, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_hypomnema_vector(vector, integer, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_memories(text, integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_engrams(text, integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_engrams_vector(vector, integer, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_hypomnema_vector(vector, integer, uuid, text) TO service_role;

-- 2. Writers that act on the account or row the caller names.
REVOKE EXECUTE ON FUNCTION public.anonymize_group_room_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_reconsolidate(uuid[], uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_rehearse_scope(uuid, text, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.append_continuity_trace_write(uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.anonymize_group_room_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_reconsolidate(uuid[], uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_rehearse_scope(uuid, text, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_continuity_trace_write(uuid, jsonb) TO service_role;

-- 3. Cross-account maintenance run by pg_cron. Some of these call edge functions
--    (model spend) or rewrite memory for every account in the cohort.
REVOKE EXECUTE ON FUNCTION public.mnemos_cleanup_legacy_beliefs(boolean, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_digest_backlog_drain(boolean, boolean, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_run_belief_challenge_cohort() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_run_digest_autoreview_cohort(numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_run_digest_build_cohort() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_run_health_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_run_identity_derivation_cohort() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mnemos_run_rehearsal_cohort() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_cron_job_run_details() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_imports() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mnemos_cleanup_legacy_beliefs(boolean, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_digest_backlog_drain(boolean, boolean, integer, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_run_belief_challenge_cohort() TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_run_digest_autoreview_cohort(numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_run_digest_build_cohort() TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_run_health_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_run_identity_derivation_cohort() TO service_role;
GRANT EXECUTE ON FUNCTION public.mnemos_run_rehearsal_cohort() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_cron_job_run_details() TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stuck_imports() TO service_role;

-- 4. Called from the browser, so signed-in users keep it, but only for their own
--    account. Same caller check as decrypt_user_api_key.
CREATE OR REPLACE FUNCTION public.cognitive_memory_stats(p_user_id uuid, p_agent_id text)
RETURNS TABLE(
  total_engrams bigint,
  active bigint,
  dormant bigint,
  archived bigint,
  connections bigint,
  beliefs_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_caller uuid;
  v_claims jsonb;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_role = '' THEN
    BEGIN
      v_claims := current_setting('request.jwt.claims', true)::jsonb;
      v_role := COALESCE(v_claims->>'role', '');
    EXCEPTION WHEN others THEN
      v_role := '';
    END;
  END IF;
  v_caller := auth.uid();

  IF v_role <> 'service_role' THEN
    IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Not authorized to read these memory stats' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM engrams WHERE user_id = p_user_id AND agent_id = p_agent_id),
    (SELECT count(*) FROM engrams WHERE user_id = p_user_id AND agent_id = p_agent_id AND state = 'active'),
    (SELECT count(*) FROM engrams WHERE user_id = p_user_id AND agent_id = p_agent_id AND state = 'dormant'),
    (SELECT count(*) FROM engram_archive WHERE user_id = p_user_id AND agent_id = p_agent_id),
    (SELECT count(*) FROM connections WHERE user_id = p_user_id AND agent_id = p_agent_id),
    (SELECT count(*) FROM beliefs WHERE user_id = p_user_id AND agent_id = p_agent_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cognitive_memory_stats(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cognitive_memory_stats(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
