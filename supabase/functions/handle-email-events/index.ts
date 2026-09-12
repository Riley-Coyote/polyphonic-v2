import { createEmailWebhookHandler } from 'npm:@lovable.dev/email-js@0.1.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Records the terminal outcome in the project's own email history tables.
// Notification-only: suppression itself is enforced by Lovable at send time.
async function record(
  eventId: string,
  recipient: string,
  logStatus: 'bounced' | 'complained' | 'suppressed',
  reason: 'bounce' | 'complaint' | 'unsubscribe',
  message: string,
): Promise<void> {
  const { error: logError } = await supabase.from('email_send_log').insert({
    template_name: 'system',
    recipient_email: recipient,
    status: logStatus,
    error_message: message,
  })
  if (logError) {
    console.error('Failed to log email event', {
      event_id: eventId,
      code: logError.code,
      message: logError.message,
    })
    throw new Error('Failed to log email event')
  }

  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert({ email: recipient.toLowerCase(), reason, metadata: null }, { onConflict: 'email' })
  if (suppressError) {
    console.error('Failed to record suppression', {
      event_id: eventId,
      code: suppressError.code,
      message: suppressError.message,
    })
    throw new Error('Failed to record suppression')
  }
}

const handler = createEmailWebhookHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY')!,
  on: {
    'email.bounced': async (event) => {
      await record(event.event_id, event.data.recipient, 'bounced', 'bounce', 'Email bounced')
    },
    'email.complaint': async (event) => {
      await record(event.event_id, event.data.recipient, 'complained', 'complaint', 'Spam complaint received')
    },
    'email.unsubscribed': async (event) => {
      await record(event.event_id, event.data.recipient, 'suppressed', 'unsubscribe', 'Recipient unsubscribed')
    },
  },
})

Deno.serve((req) => handler(req))
