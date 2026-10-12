-- New beta signups remain pending on the waitlist. Existing invite history and
-- installed-app updates are unchanged. Reopening requires an explicit decision:
-- review the pending cohort before re-enabling beta-invite-auto.
DO $$
DECLARE invite_job bigint;
BEGIN
  SELECT jobid INTO invite_job FROM cron.job WHERE jobname = 'beta-invite-auto';
  IF invite_job IS NOT NULL THEN
    PERFORM cron.alter_job(invite_job, active := false);
  END IF;
END;
$$;
