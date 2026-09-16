-- beta-invite-auto: every minute, invite everyone still pending on beta_signups
-- through the existing invoke_edge_function helper. Idempotent: cron.schedule
-- updates a job by name. Applied to the project database on 2026-09-16 (job 66).
select cron.schedule(
  'beta-invite-auto',
  '* * * * *',
  $$select public.invoke_edge_function('beta-invite', '{"all_pending": true, "limit": 50}'::jsonb)$$
);
