// beta-signup — public endpoint behind the form on polyphonic.chat/beta.
//
// Contract (see polyphonic-landing/current-site/LOVABLE-HANDOFF.md):
//   POST {"email": "...", "source": "polyphonic-beta", "website": ""}
//   200 {"status": "subscribed"} | {"status": "already_subscribed"}
//   400 {"error": "invalid_email"} · 429 {"error": "rate_limited"} · 405 · 500
//
// `website` is a honeypot: the visible form keeps it empty; bots fill it. Filled
// honeypots get a friendly 200 and nothing is stored. Raw IPs are never stored;
// a salted SHA-256 hash is used for rate limiting only.
//
// Deployed with verify_jwt = false (see supabase/config.toml): the landing page
// sends no Supabase key. Abuse protection therefore lives here.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightIfNeeded } from '../_shared/cors.ts'

const HOURLY_LIMIT = 8
const DAILY_LIMIT = 20
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function json(body: Record<string, unknown>, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function hashIp(req: Request): Promise<string> {
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  const salt = Deno.env.get('BETA_IP_SALT') || Deno.env.get('SUPABASE_URL') || 'polyphonic'
  const bytes = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req)
  if (preflight) return preflight
  const cors = getCorsHeaders(req)

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('beta-signup: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'server_configuration' }, 500, cors)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400, cors)
  }

  const ipHash = await hashIp(req)
  const record = async (outcome: string) => {
    await supabase.from('beta_signup_attempts').insert({ ip_hash: ipHash, outcome })
  }

  // Opportunistic pruning keeps the attempts table small without a cron job.
  await supabase
    .from('beta_signup_attempts')
    .delete()
    .lt('attempted_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())

  const since = (ms: number) => new Date(Date.now() - ms).toISOString()
  const [{ count: hourly }, { count: daily }] = await Promise.all([
    supabase
      .from('beta_signup_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('attempted_at', since(60 * 60 * 1000)),
    supabase
      .from('beta_signup_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('attempted_at', since(24 * 60 * 60 * 1000)),
  ])
  if ((hourly ?? 0) >= HOURLY_LIMIT || (daily ?? 0) >= DAILY_LIMIT) {
    await record('rate_limited')
    return json({ error: 'rate_limited' }, 429, cors)
  }

  // Honeypot: pretend success, store nothing.
  const honeypot = typeof body.website === 'string' ? body.website.trim() : ''
  if (honeypot) {
    await record('honeypot')
    return json({ status: 'subscribed' }, 200, cors)
  }

  const emailRaw = typeof body.email === 'string' ? body.email.trim() : ''
  if (!emailRaw || emailRaw.length > 254 || !EMAIL_RE.test(emailRaw)) {
    await record('invalid')
    return json({ error: 'invalid_email' }, 400, cors)
  }

  const source = typeof body.source === 'string' && body.source.length <= 64 ? body.source : 'polyphonic-beta'
  const userAgent = (req.headers.get('user-agent') || '').slice(0, 512) || null
  const referrer = (req.headers.get('referer') || req.headers.get('origin') || '').slice(0, 512) || null

  const { error } = await supabase.from('beta_signups').insert({
    email: emailRaw,
    source,
    ip_hash: ipHash,
    user_agent: userAgent,
    referrer,
  })

  if (error) {
    // 23505 = unique_violation on email_normalized: they are already on the list.
    if (error.code === '23505') {
      await record('duplicate')
      return json({ status: 'already_subscribed' }, 200, cors)
    }
    console.error('beta-signup: insert failed', { code: error.code, message: error.message })
    await record('error')
    return json({ error: 'storage_failed' }, 500, cors)
  }

  await record('subscribed')
  return json({ status: 'subscribed' }, 200, cors)
})
