import type { TemplateEntry } from './registry.ts'
import { BetaInviteEmail } from '../email-templates/beta-invite.tsx'

// The Polyphonic macOS beta download email. Copy and visual language live in
// ../email-templates/beta-invite.tsx; this file registers it for sending.
export const template = {
  component: BetaInviteEmail,
  subject: 'Your Polyphonic beta build is ready',
  displayName: 'Beta invite',
  previewData: {
    downloadUrl: 'https://polyphonic.chat/beta/',
    siteUrl: 'https://polyphonic.chat/beta/',
    assetBase: 'https://polyphonic.chat/beta/assets/email',
  },
} satisfies TemplateEntry
