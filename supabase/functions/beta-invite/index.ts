// beta-invite — service-role-only. Sends the beta download email to people on
// the beta_signups list through Lovable's managed email delivery, so
// suppression, retries, and the send log all apply.
//
//   POST (Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>)
//   {
//     "download_url": "https://…/Polyphonic.dmg",   optional: defaults to the latest
//                                                   GitHub release (BETA_DOWNLOAD_URL)
//     "email": "one@person.com",                    send to one address, or
//     "all_pending": true, "limit": 50,             send to everyone still pending
//     "resend": false,                              also re-send to already-invited
//     "note": "optional extra paragraph",
//     "dry_run": true                               list targets + return rendered HTML, send nothing
//   }
//
// Env (optional): BETA_REPLY_TO, BETA_SITE_URL, BETA_ASSET_BASE, BETA_DOWNLOAD_URL.

import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightIfNeeded } from '../_shared/cors.ts'
import { requireServiceRole } from '../_shared/serviceRoleGuard.ts'
import { BetaInviteEmail } from '../_shared/email-templates/beta-invite.tsx'
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts'

type SignupRow = {
  id: string
  email: string
  email_normalized: string
  status: string
  invite_count: number
  metadata: Record<string, unknown> | null
}

/** Failed deliveries a pending row may accumulate before it is parked as bounced. */
const MAX_INVITE_FAILURES = 3

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
  // The stable link: the app's latest GitHub release always serves the current
  // beta under this name, and the installed app updates itself from the same
  // release. A send may still override it per call.
  const defaultDownloadUrl =
    Deno.env.get('BETA_DOWNLOAD_URL') ||
    'https://github.com/Riley-Coyote/luca-agent-network-v1/releases/latest/download/Polyphonic.dmg'
  const requestedDownloadUrl = typeof body.download_url === 'string' ? body.download_url.trim() : ''
  const downloadUrl = requestedDownloadUrl || defaultDownloadUrl
  if (!dryRun && !/^https:\/\/\S+$/.test(downloadUrl)) {
    return json({ error: 'download_url must be an https URL' }, 400, cors)
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined
  const resend = body.resend === true
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200)

  // Select targets.
  let query = supabase
    .from('beta_signups')
    .select('id,email,email_normalized,status,invite_count,metadata')
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
  const targets = candidates.filter((r) =>
    r.status === 'pending' || (resend && r.status === 'invited') || (typeof body.email === 'string' && r.status !== 'unsubscribed' && r.status !== 'bounced')
  )

  const siteUrl = Deno.env.get('BETA_SITE_URL') || 'https://polyphonic.chat/beta/'
  const assetBase = Deno.env.get('BETA_ASSET_BASE') || 'https://polyphonic.chat/beta/assets/email'
  const replyTo = Deno.env.get('BETA_REPLY_TO') || undefined

  const templateData = {
    downloadUrl,
    siteUrl,
    assetBase,
    note,
  }

  if (dryRun) {
    const element = React.createElement(BetaInviteEmail, templateData)
    return json(
      {
        dry_run: true,
        targets: targets.map((t) => ({ email: t.email, status: t.status, invite_count: t.invite_count })),
        preview_html: await renderAsync(element),
        preview_text: await renderAsync(element, { plainText: true }),
      },
      200,
      cors,
    )
  }

  const sent: string[] = []
  const failed: { email: string; error: string }[] = []
  let skippedSuppressed = 0

  for (const row of targets) {
    let result: { sent: boolean; reason?: string }
    try {
      result = await sendTemplateEmail('beta-invite', row.email, {
        templateData,
        idempotencyKey: `beta-invite-${row.id}-${row.invite_count + 1}`,
        replyTo,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const { error: logError } = await supabase.from('email_send_log').insert({
        template_name: 'beta-invite',
        recipient_email: row.email,
        status: 'failed',
        error_message: message.slice(0, 1000),
      })
      if (logError) console.error('Failed to log beta invite failure', logError)
      failed.push({ email: row.email, error: message })
      // The scheduled run retries pending rows every minute; count the failures
      // and park the row as bounced after three so one bad address cannot fill
      // the send log. A person can set it back to pending by hand.
      const failures = (Number(row.metadata?.invite_failures) || 0) + 1
      await supabase
        .from('beta_signups')
        .update({
          metadata: { ...(row.metadata ?? {}), invite_failures: failures, last_invite_error: message.slice(0, 300) },
          ...(failures >= MAX_INVITE_FAILURES ? { status: 'bounced', notes: `invite failed ${failures}×: ${message.slice(0, 200)}` } : {}),
        })
        .eq('id', row.id)
      continue
    }

    if (!result.sent) {
      const { error: logError } = await supabase.from('email_send_log').insert({
        template_name: 'beta-invite',
        recipient_email: row.email,
        status: 'suppressed',
      })
      if (logError) console.error('Failed to log suppressed beta invite', logError)
      skippedSuppressed++
      // Suppressed by the email provider (bounced or complained before): mark the
      // row so the scheduled run stops retrying it.
      await supabase
        .from('beta_signups')
        .update({ status: 'bounced', notes: `suppressed by email delivery${result.reason ? `: ${result.reason}` : ''}` })
        .eq('id', row.id)
      continue
    }

    const { error: logError } = await supabase.from('email_send_log').insert({
      template_name: 'beta-invite',
      recipient_email: row.email,
      status: 'sent',
    })
    if (logError) console.error('Failed to log sent beta invite', logError)

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

  return json({ sent: sent.length, failed, skipped_suppressed: skippedSuppressed }, 200, cors)
})
