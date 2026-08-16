UPDATE public.account_portability_jobs
SET status = 'failed',
    errors = '["Export stopped responding and was marked failed. Please try again."]'::jsonb,
    updated_at = now()
WHERE status = 'processing'
  AND updated_at < now() - interval '10 minutes';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'account-portability-reap') THEN
    PERFORM cron.schedule(
      'account-portability-reap',
      '*/15 * * * *',
      $cron$SELECT public.invoke_edge_function('account-portability-reap', '{}'::jsonb)$cron$
    );
  END IF;
END $$;