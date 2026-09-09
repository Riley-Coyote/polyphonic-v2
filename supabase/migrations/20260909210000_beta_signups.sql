-- Beta signup list for the Polyphonic desktop app (polyphonic.chat/beta).
-- Written by the public `beta-signup` edge function; read and updated by the
-- service-role-only `beta-invite` edge function, which sends the download email.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.beta_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  source TEXT NOT NULL DEFAULT 'polyphonic-beta',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'invited', 'unsubscribed', 'bounced')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_at TIMESTAMPTZ,
  invite_count INT NOT NULL DEFAULT 0,
  last_download_url TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS beta_signups_email_normalized_key
  ON public.beta_signups (email_normalized);
CREATE INDEX IF NOT EXISTS beta_signups_status_created_idx
  ON public.beta_signups (status, created_at);

GRANT ALL ON public.beta_signups TO service_role;
ALTER TABLE public.beta_signups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages beta signups" ON public.beta_signups;
CREATE POLICY "Service role manages beta signups"
  ON public.beta_signups FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.beta_signups_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS beta_signups_set_updated_at ON public.beta_signups;
CREATE TRIGGER beta_signups_set_updated_at
  BEFORE UPDATE ON public.beta_signups
  FOR EACH ROW EXECUTE FUNCTION public.beta_signups_set_updated_at();

-- Abuse protection for the public endpoint: one row per attempt, keyed by a
-- salted hash of the caller's IP. Rows older than two days are pruned by the
-- function itself on each call, so no cron job is needed.
CREATE TABLE IF NOT EXISTS public.beta_signup_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beta_signup_attempts_ip_time_idx
  ON public.beta_signup_attempts (ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS beta_signup_attempts_time_idx
  ON public.beta_signup_attempts (attempted_at);

GRANT ALL ON public.beta_signup_attempts TO service_role;
ALTER TABLE public.beta_signup_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages beta signup attempts" ON public.beta_signup_attempts;
CREATE POLICY "Service role manages beta signup attempts"
  ON public.beta_signup_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
