-- Provider API keys open only inside trusted server functions, as the Trust page
-- says ("decrypted only inside trusted server functions").
--
-- decrypt_user_api_key returns a person's saved provider key in plain text. Since
-- 20260502215917 signed-in callers could run it for their own account. The app never
-- used that, but an app a person connects through the Polyphonic connector holds a
-- signed-in token for them, so it could have read the key.
--
-- Callers, checked 2026-09-29 against main (cb79bd8):
--   * Every edge-function call uses a service-role client, directly or through
--     _shared/model-backend.ts, _shared/imageModel.ts, _shared/perplexity.ts and
--     _shared/hypomnema/*.
--   * The browser never calls it: src/ names it only in the generated types.
--
-- Test: supabase/tests/definer_functions_caller_scope.test.sql
REVOKE EXECUTE ON FUNCTION public.decrypt_user_api_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrypt_user_api_key(uuid) TO service_role;
