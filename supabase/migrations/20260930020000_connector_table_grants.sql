-- Table access for the connector's two tables.
--
-- 20260928180000 turned on row-level security and wrote the policies but granted
-- nothing, and on this project a new table gets no default grants: after it was
-- applied on 2026-09-30, no role could reach either table. Row-level security
-- decides which rows a role sees; these grants decide whether it may touch the
-- table at all.
--
-- What the code does, checked 2026-09-30:
--   * The browser, signed in (src/lib/connector.ts): connector_grants select,
--     upsert (insert + update) and delete, for /oauth/consent and Settings ->
--     Connected apps; connector_calls select, for "last used". The policies keep
--     every row to the person, and writes to their own polyphonic.chat session
--     (never a connected app's token).
--   * The connector function, as the service role (_shared/connector/tools.ts):
--     connector_grants select; connector_calls select and insert.
--
-- Test: src/test/connectorTableGrants.test.ts
REVOKE ALL ON TABLE public.connector_grants FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.connector_calls FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connector_grants TO authenticated;
GRANT SELECT ON TABLE public.connector_calls TO authenticated;

GRANT ALL ON TABLE public.connector_grants TO service_role;
GRANT ALL ON TABLE public.connector_calls TO service_role;

-- connector_calls.id comes from an identity sequence.
DO $$
DECLARE
  seq text := pg_get_serial_sequence('public.connector_calls', 'id');
BEGIN
  IF seq IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq);
  END IF;
END
$$;
