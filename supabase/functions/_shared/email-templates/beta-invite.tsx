/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

// The download email for the Polyphonic macOS beta. Same visual language as
// polyphonic.chat/beta: black ground, one white pill button, quiet meta line.
// Images are hosted under polyphonic.chat/beta/assets/email/ so the message
// still reads correctly when a client blocks images.

export interface BetaInviteEmailProps {
  downloadUrl: string
  siteUrl: string
  assetBase: string
  note?: string
}

export const BetaInviteEmail = ({ downloadUrl, siteUrl, assetBase, note }: BetaInviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Polyphonic beta build for macOS is ready to download.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandRow}>
          <Img src={`${assetBase}/mark.png`} width="22" height="22" alt="" style={mark} />
          <Text style={brand}>Polyphonic</Text>
        </Section>

        <Img src={`${assetBase}/together.png`} width="520" height="150" alt="Your agents, together." style={hero} />

        <Heading style={h1}>Your build is ready.</Heading>
        <Text style={lead}>
          Thanks for asking for the Polyphonic beta. One home on your Mac for agents, memory, and
          projects. Download it, open it, and meet Luca.
        </Text>

        <Button style={button} href={downloadUrl}>
          Download Polyphonic for macOS
        </Button>

        <Text style={meta}>
          For the best experience, have Claude Code or Codex installed with an active account.
        </Text>

        {note ? <Text style={text}>{note}</Text> : null}

        <Text style={text}>
          It is a beta. Anything that feels off, slow, or confusing is worth telling us about;
          that is what this round is for.
        </Text>

        <Hr style={rule} />
        <Text style={footer}>
          You are receiving this because you joined the beta list at{' '}
          <Link href={siteUrl} style={footerLink}>polyphonic.chat/beta</Link>. If the button does
          not work, copy this link: <Link href={downloadUrl} style={footerLink}>{downloadUrl}</Link>
        </Text>
        <Text style={footer}>Riley Coyote · Mnemos Research</Text>
      </Container>
    </Body>
  </Html>
)

export default BetaInviteEmail

const font = '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
const mono = '"Fragment Mono", "SF Mono", Menlo, Consolas, monospace'

const main: React.CSSProperties = { backgroundColor: '#000000', margin: 0, padding: '32px 0' }
const container: React.CSSProperties = {
  backgroundColor: '#000000',
  maxWidth: '560px',
  margin: '0 auto',
  padding: '24px 28px 32px',
  fontFamily: font,
  color: '#f2f2ee',
}
const brandRow: React.CSSProperties = { marginBottom: '28px' }
const mark: React.CSSProperties = { display: 'inline-block', verticalAlign: 'middle', marginRight: '10px' }
const brand: React.CSSProperties = {
  display: 'inline-block',
  verticalAlign: 'middle',
  margin: 0,
  fontSize: '15px',
  fontWeight: 500,
  letterSpacing: '-0.01em',
  color: '#f2f2ee',
}
const hero: React.CSSProperties = { display: 'block', width: '100%', maxWidth: '520px', height: 'auto', margin: '0 0 28px' }
const h1: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: '30px',
  lineHeight: '1.15',
  fontWeight: 500,
  letterSpacing: '-0.03em',
  color: '#ffffff',
}
const lead: React.CSSProperties = { margin: '0 0 24px', fontSize: '16px', lineHeight: '1.6', color: '#c9c9c2' }
const text: React.CSSProperties = { margin: '18px 0 0', fontSize: '15px', lineHeight: '1.6', color: '#b5b5ae' }
const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#f5f5f5',
  color: '#101010',
  fontFamily: font,
  fontSize: '15px',
  fontWeight: 500,
  lineHeight: '20px',
  padding: '14px 22px',
  borderRadius: '8px',
  textDecoration: 'none',
}
const meta: React.CSSProperties = { margin: '18px 0 0', fontSize: '13px', lineHeight: '1.6', color: '#8f8f88' }
const rule: React.CSSProperties = { borderColor: '#262626', margin: '32px 0 16px' }
const footer: React.CSSProperties = { margin: '0 0 8px', fontFamily: mono, fontSize: '11px', lineHeight: '1.7', color: '#77776f' }
const footerLink: React.CSSProperties = { color: '#a9a9a2', textDecoration: 'underline' }
