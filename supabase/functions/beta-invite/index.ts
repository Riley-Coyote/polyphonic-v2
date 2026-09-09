// beta-invite — service-role-only. Sends the beta download email to people on
// the beta_signups list through the existing transactional email queue, so
// suppression, retries, and the send log all apply.
//
//   POST (Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>)
//   {
//     "download_url": "https://…/Polyphonic.dmg",   required unless dry_run
//     "email": "one@person.com",                    send to one address, or
//     "all_pending": true, "limit": 50,             send to everyone still pending
//     "resend": false,                              also re-send to already-invited
//     "note": "optional extra paragraph",
//     "dry_run": true                               list targets + return rendered HTML, send nothing
//   }
//
// Env (optional): BETA_FROM_NAME, BETA_FROM_EMAIL, BETA_REPLY_TO, BETA_SITE_URL, BETA_ASSET_BASE.

import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightIfNeeded } from '../_shared/cors.ts'
import { requireServiceRole } from '../_shared/serviceRoleGuard.ts'
import { BetaInviteEmail } from '../_shared/email-templates/beta-invite.tsx'

const SENDER_DOMAIN = 'notify.polyphonic.chat'
const SUBJECT = 'Your Polyphonic beta build is ready'

type SignupRow = {
  id: string
  email: string
  email_normalized: string
  status: string
  invite_count: number
}

function json(body: Record<string, unknown>, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req)
  if (preflight) return preflight
  const cors = getCorsHeaders(req)
  const denied = requireServiceRole(req, cors)
  if (denied) return denied
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400, cors)
  }

  const dryRun = body.dry_run === true
  const downloadUrl = typeof body.download_url === 'string' ? body.download_url.trim() : ''
  if (!dryRun && !/^https:\/\/\S+$/.test(downloadUrl)) {
    return json({ error: 'download_url must be an https URL' }, 400, cors)
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined
  const resend = body.resend === true
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200)

  // Select targets.
  let query = supabase
    .from('beta_signups')
    .select('id,email,email_normalized,status,invite_count')
    .order('created_at', { ascending: true })
  if (typeof body.email === 'string' && body.email.trim()) {
    query = query.eq('email_normalized', body.email.trim().toLowerCase())
  } else if (body.all_pending === true) {
    query = resend ? query.in('status', ['pending', 'invited']).limit(limit) : query.eq('status', 'pending').limit(limit)
  } else {
    return json({ error: 'Provide "email" or "all_pending": true' }, 400, cors)
  }
  const { data: rows, error: selectError } = await query
  if (selectError) return json({ error: selectError.message }, 500, cors)

  const candidates = (rows ?? []) as SignupRow[]
  const eligible = candidates.filter((r) =>
    r.status === 'pending' || (resend && r.status === 'invited') || (typeof body.email === 'string' && r.status !== 'unsubscribed' && r.status !== 'bounced')
  )

  // Never email a suppressed address.
  const { data: suppressed } = await supabase
    .from('suppressed_emails')
    .select('email')
    .in('email', eligible.map((r) => r.email_normalized))
  const suppressedSet = new Set((suppressed ?? []).map((s: { email: string }) => s.email.toLowerCase()))
  const targets = eligible.filter((r) => !suppressedSet.has(r.email_normalized))

  const siteUrl = Deno.env.get('BETA_SITE_URL') || 'https://polyphonic.chat/beta/'
  const assetBase = Deno.env.get('BETA_ASSET_BASE') || 'https://polyphonic.chat/beta/assets/email'
  const fromName = Deno.env.get('BETA_FROM_NAME') || 'Polyphonic'
  const fromEmail = Deno.env.get('BETA_FROM_EMAIL') || 'noreply@polyphonic.chat'
  const replyTo = Deno.env.get('BETA_REPLY_TO') || undefined

  const render = async (plain: boolean) =>
    await renderAsync(
      React.createElement(BetaInviteEmail, { downloadUrl: downloadUrl || 'https://polyphonic.chat/beta/', siteUrl, assetBase, note }),
      plain ? { plainText: true } : undefined,
    )

  if (dryRun) {
    return json(
      {
        dry_run: true,
        targets: targets.map((t) => ({ email: t.email, status: t.status, invite_count: t.invite_count })),
        skipped_suppressed: eligible.length - targets.length,
        preview_html: await render(false),
        preview_text: await render(true),
      },
      200,
      cors,
    )
  }

  const html = await render(false)
  const text = await render(true)
  const sent: string[] = []
  const failed: { email: string; error: string }[] = []

  for (const row of targets) {
    // One unsubscribe token per address, shared with the rest of the email system.
    let token: string | null = null
    const { data: existing } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', row.email_normalized)
      .maybeSingle()
    if (existing?.token) token = existing.token
    else {
      token = crypto.randomUUID()
      const { error: tokenError } = await supabase
        .from('email_unsubscribe_tokens')
        .insert({ token, email: row.email_normalized })
      if (tokenError) token = null
    }

    const messageId = crypto.randomUUID()
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: 'beta-invite',
      recipient_email: row.email,
      status: 'pending',
    })

    const payload: Record<string, unknown> = {
      message_id: messageId,
      to: row.email,
      from: `${fromName} <${fromEmail}>`,
      sender_domain: SENDER_DOMAIN,
      subject: SUBJECT,
      html,
      text,
      purpose: 'transactional',
      label: 'beta-invite',
      idempotency_key: `beta-invite-${row.id}-${row.invite_count + 1}`,
      queued_at: new Date().toISOString(),
    }
    if (replyTo) payload.reply_to = replyTo
    if (token) payload.unsubscribe_token = token

    const { error: enqueueError } = await supabase.rpc('enqueue_email', {
      queue_name: 'transactional_emails',
      payload,
    })
    if (enqueueError) {
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: 'beta-invite',
        recipient_email: row.email,
        status: 'failed',
        error_message: 'Failed to enqueue email',
      })
      failed.push({ email: row.email, error: enqueueError.message })
      continue
    }

    await supabase
      .from('beta_signups')
      .update({
        status: 'invited',
        invited_at: new Date().toISOString(),
        invite_count: row.invite_count + 1,
        last_download_url: downloadUrl,
      })
      .eq('id', row.id)
    sent.push(row.email)
  }

  return json({ queued: sent.length, failed, skipped_suppressed: eligible.length - targets.length }, 200, cors)
})
