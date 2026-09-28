import type { CSSProperties, ReactNode } from 'react';
import PolyphonicMark from '@/components/PolyphonicMark';

/* ======================================================================
   AuthCard — the glass-tray card the auth flow uses (LandingPage's
   AuthShell, ResetPasswordPage). Pulled out here for /oauth/consent, the
   third surface that needs it; the first two still carry inline copies.
   ====================================================================== */

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        padding: 6,
        borderRadius: 22,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.012) 18%, rgba(255,255,255,0.006) 60%, rgba(255,255,255,0.022) 100%)',
        border: '1px solid rgba(255,255,255,0.045)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.05), 0 28px 72px -16px rgba(0,0,0,0.6), 0 8px 24px -6px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
      }}
    >
      <div
        style={{
          background:
            'linear-gradient(180deg, rgba(22,22,26,0.92) 0%, rgba(18,18,22,0.96) 50%, rgba(16,16,20,0.96) 100%)',
          border: '1px solid rgba(255,255,255,0.055)',
          borderRadius: 17,
          padding: '0 0 30px',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.032), inset 0 -1px 0 rgba(255,255,255,0.012)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 0 17px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            position: 'relative',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: -1,
              height: 1,
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 25%, rgba(255,255,255,0.07) 75%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />
          <PolyphonicMark size={14} strokeWidth={6} style={{ color: 'var(--text-soft)', marginRight: 9, flexShrink: 0 }} />
          <span
            style={{
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
              fontSize: 11.5,
              fontWeight: 200,
              letterSpacing: '0.22em',
              color: 'var(--text-body)',
            }}
          >
            POLYPHONIC
          </span>
        </div>
        <div className="auth-card-body">{children}</div>
      </div>
    </div>
  );
}

export function AuthCardEyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: 'var(--track-meta)',
        textTransform: 'uppercase',
        color: 'var(--text-whisper)',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export function AuthCardTitle({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 24,
        fontWeight: 450,
        letterSpacing: '-0.018em',
        lineHeight: 1.2,
        color: 'var(--ink)',
        margin: 0,
      }}
    >
      {children}
    </h1>
  );
}

export function AuthCardSubtitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 13.5,
        lineHeight: 1.55,
        color: 'var(--text-body)',
        marginTop: 9,
        marginBottom: 0,
        maxWidth: 360,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
