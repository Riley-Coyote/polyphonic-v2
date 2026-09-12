import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import PolyphonicMark from '@/components/PolyphonicMark';
import { supabase } from '@/integrations/supabase/client';
import {
  authRedirectTo,
  safeAuthNextPath,
  signInWithGoogle,
  signInWithApple,
  signInWithMicrosoft,
  signInWithGitHub,
} from '@/lib/authFlow';
import { ensureGuideSession } from '@/lib/guestChat';
import { useLucaGuideStore } from '@/stores/lucaGuideStore';
import { isAnonymousUser } from '@/lib/accessTier';
import { useSidebarStore } from '@/stores/sidebarStore';
import LandingParticleField, {
  type LandingFieldHandle,
  type LandingFieldState,
} from '@/components/LandingParticleField';
import { ArrowDownToLine, Plus } from 'lucide-react';

/**
 * LandingPage — public, unauthenticated entry surface.
 *
 * State machine:
 *
 *   idle      — page just loaded. Particles drift chaotically across
 *               the whole viewport. The composer card sits in the
 *               center but the field is unanchored.
 *
 *   composer  — user has focused the composer. The field organizes
 *               into a soft halo around the card geometry. Same card
 *               UI as in the chat app — same classes, same shimmer,
 *               same pills, same send button.
 *
 *   signin /  — user submitted the composer (→ signup with their
 *   signup /    prompt preserved) or asked to sign in (→ signin) or
 *   forgot /    forgot their password. The field redistributes around
 *   sent        the new card geometry without snapping.
 *
 * The same component renders /, /auth/login, and /auth/signup —
 * differing only in the initial mode.
 */

type Mode = 'idle' | 'composer' | 'signin' | 'signup' | 'forgot' | 'sent';

const PROMPT_HANDOFF_KEY = 'polyphonic_landing_prompt';
const FADE_MS = 280;
const CHAT_HANDOFF_MIN_MS = 1250;

interface LandingPageProps {
  initialMode?: Mode;
}

export default function LandingPage({ initialMode = 'idle' }: LandingPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authNextPath = safeAuthNextPath(searchParams.get('next'));
  const setSidebarVisible = useSidebarStore((s) => s.setVisible);
  const setGuideOpen = useLucaGuideStore((s) => s.setOpen);
  const sendGuideMessage = useLucaGuideStore((s) => s.send);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [transitioning, setTransitioning] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [composerLaunching, setComposerLaunching] = useState(false);

  const fieldRef = useRef<LandingFieldHandle>(null);
  /** The actual card element on screen — composer or auth card. The
   *  particle field reads its bounding box every frame so the
   *  exclusion rectangle conforms to the card's exact size. */
  const cardElRef = useRef<HTMLDivElement>(null);

  // Field state mapping: idle = chaotic drift, composer = soft halo
  // around composer card, all auth states = halo around auth card.
  const fieldState: LandingFieldState =
    composerLaunching
      ? 'handoff'
      : mode === 'idle'
      ? 'idle'
      : mode === 'composer'
      ? 'composer'
      : 'auth';

  // ?mode= URL param — used by /auth/login (signin) and /auth/signup
  // (signup) routes that render this same component.
  useEffect(() => {
    const m = searchParams.get('mode') as Mode | null;
    if (m && (m === 'idle' || m === 'composer' || m === 'signin' || m === 'signup' || m === 'forgot')) {
      setMode(m);
    }
  }, [searchParams]);

  // Card content swap — the composer card visually never disappears;
  // only auth states (signin/signup/forgot/sent) trigger a cross-fade
  // because the card content is changing entirely. idle ↔ composer is
  // the same card, just with a different field around it.
  const goTo = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      const isCardSwap =
        (mode !== 'idle' && mode !== 'composer') ||
        (next !== 'idle' && next !== 'composer');
      if (isCardSwap) {
        setTransitioning(true);
        window.setTimeout(() => {
          setMode(next);
          requestAnimationFrame(() => setTransitioning(false));
        }, FADE_MS);
      } else {
        setMode(next);
      }
    },
    [mode]
  );

  const handleComposerSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || composerLaunching) return;
      setComposerError('');
      setComposerLaunching(true);
      const startedAt = performance.now();
      fieldRef.current?.beginHandoff();
      try {
        await ensureGuideSession();
        const elapsed = performance.now() - startedAt;
        const remaining = CHAT_HANDOFF_MIN_MS - elapsed;
        if (remaining > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
        setSidebarVisible(false);
        setGuideOpen(true);
        void sendGuideMessage(trimmed, { path: '/chat', search: '?guide=1' });
        navigate('/chat?guide=1');
      } catch (err) {
        setComposerError(err instanceof Error ? err.message : 'Could not open the Polyphonic Guide right now.');
        setComposerLaunching(false);
      }
    },
    [composerLaunching, navigate, sendGuideMessage, setGuideOpen, setSidebarVisible]
  );

  // Trigger composer state on first focus. Stays in composer state once
  // engaged (no point reverting to idle).
  const handleComposerFocus = useCallback(() => {
    if (mode === 'idle') {
      setMode('composer');
    }
  }, [mode]);

  const isComposerMode = mode === 'idle' || mode === 'composer';
  // The card always renders; only its CONTENT swaps for auth states.
  // For idle/composer, the card holds the composer. For auth states,
  // the card holds the auth surfaces.
  const cardKey = isComposerMode ? 'composer-card' : `auth-${mode}`;

  return (
    <div
      className={`landing-shell relative h-screen w-screen overflow-hidden${composerLaunching ? ' landing-shell--handoff' : ''}`}
      style={{ background: 'var(--floor)' }}
      data-landing-mode={mode}
      data-field-state={fieldState}
    >
      <LandingParticleField ref={fieldRef} state={fieldState} cardRef={cardElRef} />

      <Chrome mode={mode} goTo={goTo} />

      <main
        className="relative h-full w-full flex flex-col items-center justify-center px-6"
        style={{ zIndex: 1 }}
      >
        {/* Above-composer brand mark — only visible in composer/idle modes,
            establishes "where you are" at first glance. Auth cards have
            their own internal brand mark instead. */}
        {isComposerMode && (
          <ComposerHeading
            transitioning={transitioning}
            faded={mode === 'idle'}
          />
        )}

        <div
          key={cardKey}
          ref={cardElRef}
          className="relative w-full"
          style={{
            maxWidth: isComposerMode ? 600 : mode === 'sent' ? 440 : 420,
            opacity: transitioning ? 0 : 1,
            transform: transitioning ? 'translateY(6px)' : 'translateY(0)',
            transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
          }}
        >
          {isComposerMode && (
            <LandingComposer
              onFocus={handleComposerFocus}
              onSubmit={handleComposerSubmit}
              submitting={composerLaunching}
              error={composerError}
            />
          )}
          {mode === 'signin' && <SignInCard goTo={goTo} navigate={navigate} authNextPath={authNextPath} />}
          {mode === 'signup' && <SignUpCard goTo={goTo} authNextPath={authNextPath} />}
          {mode === 'forgot' && <ForgotCard goTo={goTo} />}
          {mode === 'sent' && <SignupSentCard goTo={goTo} />}
        </div>
      </main>

      <FootnoteLinks />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Chrome — top-left brand mark, top-right contextual action.
 * ────────────────────────────────────────────────────────────────────── */

function Chrome({ mode, goTo }: { mode: Mode; goTo: (m: Mode) => void }) {
  const rightActionLabel =
    mode === 'idle' || mode === 'composer'
      ? 'Sign in'
      : mode === 'signup'
      ? 'Already have an account'
      : mode === 'signin' || mode === 'forgot'
      ? 'New here'
      : null;

  const onRight = () => {
    if (mode === 'idle' || mode === 'composer') goTo('signin');
    else if (mode === 'signup') goTo('signin');
    else goTo('signup');
  };

  return (
    <header
      className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 md:px-10 py-5"
      style={{ zIndex: 3 }}
    >
      <button
        type="button"
        onClick={() => goTo('idle')}
        aria-label="Polyphonic"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
          fontSize: 12,
          fontWeight: 200,
          letterSpacing: '0.22em',
          color: 'var(--text-body)',
          transition: 'color 220ms cubic-bezier(0.22,1,0.36,1)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color =
            'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color =
            'var(--text-body)';
        }}
      >
        POLYPHONIC
      </button>

      <div className="landing-chrome-actions">
        {/* Beta button temporarily hidden until the /beta page is ready to ship.
            Restore:
            <a className="luca-download-trigger" href="/beta/" aria-label="Get the Polyphonic beta for Mac">
              <ArrowDownToLine size={14} strokeWidth={1.65} aria-hidden="true" />
              <span>Get the Mac beta</span>
            </a>
        */}
        <span className="landing-chrome-mark" aria-hidden="true">
          <PolyphonicMark size={17} strokeWidth={6} />
        </span>
        {rightActionLabel && (
          <button
            type="button"
            onClick={onRight}
            className="transition-all landing-auth-action"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              fontWeight: 400,
              letterSpacing: 'var(--track-body)',
              color: 'var(--text-body)',
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-pill)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.color =
                'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'var(--border-subtle)';
              (e.currentTarget as HTMLButtonElement).style.color =
                'var(--text-body)';
            }}
          >
            {rightActionLabel}
          </button>
        )}
      </div>
    </header>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * ComposerHeading — Polyphonic wordmark + tagline above the composer.
 * Establishes brand presence so a first-time visitor knows where they
 * are. Subtly fades when the composer is focused so attention shifts
 * to the input.
 * ────────────────────────────────────────────────────────────────────── */

function ComposerHeading({
  transitioning,
  faded,
}: {
  transitioning: boolean;
  faded: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center"
      style={{
        marginBottom: 56,
        opacity: transitioning ? 0 : faded ? 1 : 0.62,
        transform: transitioning ? 'translateY(-6px)' : 'translateY(0)',
        transition:
          'opacity 540ms cubic-bezier(0.22, 1, 0.36, 1), transform 540ms cubic-bezier(0.22, 1, 0.36, 1)',
        userSelect: 'none',
      }}
    >
      <h1
        style={{
          // System SF Pro Display chain at hairline weight — matches
          // Riley's master spec: thin strokes, very wide tracking.
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
          fontSize: 48,
          fontWeight: 100,
          letterSpacing: '0.2em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 18,
          lineHeight: 1,
          // Compensate for letter-spacing pushing the right edge: shifts
          // the visual center back to true center.
          textIndent: '0.2em',
        }}
      >
        POLYPHONIC
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          fontWeight: 420,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          margin: 0,
          textAlign: 'center',
        }}
      >
        where many minds meet
      </p>
    </div>
  );
}

function FootnoteLinks() {
  return (
    <footer
      className="absolute bottom-0 left-0 right-0 flex items-center justify-center pb-6"
      style={{ zIndex: 3 }}
    >
      <div
        className="flex items-center gap-3"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: 'var(--track-meta)',
          textTransform: 'uppercase',
          color: 'var(--text-whisper)',
        }}
      >
        <Link to="/privacy" className="hover:underline">
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms" className="hover:underline">
          Terms
        </Link>
      </div>
    </footer>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * LandingComposer — visually identical to the in-app composer (same
 * classes, same shimmer, same pill arrangement). Pills are static
 * (visitor isn't authenticated, so no agent picker store etc.); the
 * send button stashes the prompt and triggers the auth transition.
 * ────────────────────────────────────────────────────────────────────── */

function LandingComposer({
  onSubmit,
  onFocus,
  submitting = false,
  error = '',
}: {
  onSubmit: (text: string) => void | Promise<void>;
  onFocus?: () => void;
  submitting?: boolean;
  error?: string;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 280) + 'px';
  }, [text]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(text);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(text);
    }
  };

  const sendDisabled = text.trim().length === 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="chat-empty-composer landing-composer"
      style={{
        animation: 'viewFadeIn 0.6s var(--ease-out) 0.05s both',
        margin: '0 auto',
      }}
    >
      <div className={`input-shell landing-input-shell${focused ? ' focused expanded' : ''}${text.trim() ? ' expanded has-text' : ''}`}>
        {error && (
          <div
            className="composer-key-warning"
            role="alert"
            style={{
              marginBottom: 8,
              color: '#c97c7c',
            }}
          >
            {error}
          </div>
        )}
        <div className="input-row">
          <textarea
            ref={taRef}
            className="input-textarea"
            aria-label="Ask the Polyphonic Guide"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              setFocused(true);
              onFocus?.();
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKey}
            rows={1}
            placeholder={submitting ? 'Opening the Guide…' : 'Ask about Polyphonic…'}
            spellCheck={false}
            disabled={submitting}
          />
        </div>
        <div className="input-footer">
          <div className="agent-pills">
            <button
              type="button"
              className="attach-btn"
              onClick={(e) => {
                // Non-functional on landing (no auth, no upload target).
                // Just keep focus on the textarea.
                e.preventDefault();
                taRef.current?.focus();
              }}
              aria-label="Attach files"
              title="Sign in to attach files"
            >
              <Plus size={15} strokeWidth={1.55} aria-hidden="true" />
            </button>

            {/* Static guide pill — visually matches AgentPicker's
                resting state. Click is a no-op (focuses textarea). */}
            <button
              type="button"
              className="agent-pill targeted luca-only-pill"
              onClick={() => taRef.current?.focus()}
              title="Talking to the Polyphonic Guide"
            >
              guide
            </button>
          </div>

          <div className="composer-actions">
            <button
              type="submit"
              aria-label={submitting ? 'Opening the Polyphonic Guide' : 'Send message'}
              className={`send-btn${!sendDisabled ? ' armed' : ''}`}
              disabled={sendDisabled || submitting}
            >
              <span className="send-icon">
                <svg
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.5 1.5 L1.5 6.3 L5.6 8 L7.4 12.3 Z" />
                  <path d="M12.5 1.5 L5.6 8" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * AuthCard — shared shell for sign in / sign up / forgot / sent.
 * ────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────
 * AuthShell — premium glass-tray card.
 *
 * Two layers:
 *   1. Outer "tray" — a glass-like frame (4px breathing inset, soft
 *      hairline border with a top-edge highlight, gentle backdrop blur).
 *      Reads as a beveled mount holding the inner card.
 *   2. Inner card — the actual surface the form sits on. Subtle top-down
 *      gradient, hairline border, depth shadow.
 *
 * Header strip: small Polyphonic mark with breathing sage-tan dot,
 * separated from the card body by a fading hairline. This is what
 * tells the user "you're in the same place" across modes.
 * ────────────────────────────────────────────────────────────────────── */

function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.032), inset 0 -1px 0 rgba(255,255,255,0.012)',
        }}
      >
        {/* Card header — Polyphonic wordmark, separated from body by a
            fading hairline ribbon. */}
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
          {/* Hairline gradient accent: the bottom border softens to
              transparent at both ends, like a ribbon under the header. */}
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
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
              fontSize: 11.5,
              fontWeight: 200,
              letterSpacing: '0.22em',
              color: 'var(--text-body)',
            }}
          >
            POLYPHONIC
          </span>
        </div>

        {/* Card body */}
        <div style={{ padding: '26px 32px 0' }}>
          {eyebrow && (
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
              {eyebrow}
            </div>
          )}
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
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13.5,
                lineHeight: 1.55,
                color: 'var(--text-body)',
                marginTop: 9,
                marginBottom: 0,
                maxWidth: 360,
              }}
            >
              {subtitle}
            </p>
          )}
          <div style={{ marginTop: 24 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function FieldInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string }
) {
  const { hint, style, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        width: '100%',
        height: 44,
        padding: '0 15px',
        background: 'rgba(10, 10, 13, 0.55)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: 10,
        outline: 'none',
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: 400,
        letterSpacing: 'var(--track-body)',
        color: 'var(--text-primary)',
        transition:
          'border-color 220ms cubic-bezier(0.22,1,0.36,1), background 220ms cubic-bezier(0.22,1,0.36,1), box-shadow 220ms cubic-bezier(0.22,1,0.36,1)',
        ...style,
      }}
      onFocus={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        el.style.borderColor = 'rgba(96, 165, 250, 0.32)';
        el.style.background = 'rgba(20, 20, 24, 0.7)';
        el.style.boxShadow =
          '0 0 0 3px rgba(96, 165, 250, 0.06), inset 0 1px 0 rgba(255,255,255,0.025)';
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        el.style.borderColor = 'rgba(255, 255, 255, 0.07)';
        el.style.background = 'rgba(10, 10, 13, 0.55)';
        el.style.boxShadow = 'none';
        rest.onBlur?.(e);
      }}
    />
  );
}

function PrimaryButton({
  children,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={loading || rest.disabled}
      style={{
        width: '100%',
        height: 44,
        // Soft cream gradient — matches the warm-cream particle palette
        // rather than a flat ink slab.
        background:
          'linear-gradient(180deg, #f4f3f0 0%, #e8e6e1 100%)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: 10,
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: '-0.005em',
        color: '#1a1a1f',
        cursor: loading || rest.disabled ? 'default' : 'pointer',
        opacity: loading || rest.disabled ? 0.5 : 1,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(0,0,0,0.4), 0 8px 20px -8px rgba(0,0,0,0.6)',
        transition:
          'transform 220ms cubic-bezier(0.22,1,0.36,1), box-shadow 220ms cubic-bezier(0.22,1,0.36,1), background 220ms cubic-bezier(0.22,1,0.36,1)',
        ...rest.style,
      }}
      onMouseEnter={(e) => {
        if (loading || rest.disabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.transform = 'translateY(-0.5px)';
        el.style.background =
          'linear-gradient(180deg, #faf9f6 0%, #f0eee9 100%)';
        el.style.boxShadow =
          'inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 0 rgba(0,0,0,0.4), 0 12px 28px -10px rgba(0,0,0,0.65)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.transform = 'translateY(0)';
        el.style.background =
          'linear-gradient(180deg, #f4f3f0 0%, #e8e6e1 100%)';
        el.style.boxShadow =
          'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(0,0,0,0.4), 0 8px 20px -8px rgba(0,0,0,0.6)';
      }}
    >
      {children}
    </button>
  );
}

function OAuthButton({
  glyph,
  glyphColor,
  label,
  onClick,
  disabled,
}: {
  glyph: React.ReactNode;
  glyphColor?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        height: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 11,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)',
        border: '1px solid rgba(255,255,255,0.075)',
        borderRadius: 10,
        fontFamily: 'var(--font-sans)',
        fontSize: 13.5,
        fontWeight: 450,
        letterSpacing: '-0.003em',
        color: 'var(--text-body)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.025), 0 1px 0 rgba(0,0,0,0.25)',
        transition:
          'border-color 220ms cubic-bezier(0.22,1,0.36,1), color 220ms cubic-bezier(0.22,1,0.36,1), background 220ms cubic-bezier(0.22,1,0.36,1), box-shadow 220ms cubic-bezier(0.22,1,0.36,1)',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'rgba(255,255,255,0.13)';
        el.style.color = 'var(--text-primary)';
        el.style.background =
          'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 100%)';
        el.style.boxShadow =
          'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 0 rgba(0,0,0,0.25), 0 6px 14px -6px rgba(0,0,0,0.45)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'rgba(255,255,255,0.075)';
        el.style.color = 'var(--text-body)';
        el.style.background =
          'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)';
        el.style.boxShadow =
          'inset 0 1px 0 rgba(255,255,255,0.025), 0 1px 0 rgba(0,0,0,0.25)';
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: glyphColor || 'currentColor',
        }}
      >
        {glyph}
      </span>
      {label}
    </button>
  );
}

function Divider({ label = 'or' }: { label?: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center"
      style={{
        gap: 14,
        color: 'var(--text-whisper)',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        letterSpacing: 'var(--track-meta)',
        textTransform: 'uppercase',
        margin: '6px 0',
      }}
    >
      <span
        className="flex-1"
        style={{
          height: 1,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 100%)',
        }}
      />
      <span>{label}</span>
      <span
        className="flex-1"
        style={{
          height: 1,
          background:
            'linear-gradient(90deg, rgba(255,255,255,0.07) 0%, transparent 100%)',
        }}
      />
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#c97c7c',
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

function InfoLine({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--text-tertiary)',
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

const GoogleGlyph = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M14.7 8.16c0-.5-.04-.97-.13-1.43H8v2.7h3.78a3.23 3.23 0 0 1-1.4 2.12v1.76h2.27c1.32-1.22 2.08-3.02 2.08-5.15z"
      fill="#4285F4"
    />
    <path
      d="M8 15c1.89 0 3.48-.63 4.64-1.69l-2.26-1.76c-.63.42-1.43.67-2.38.67-1.83 0-3.38-1.24-3.94-2.9H1.72v1.82A7 7 0 0 0 8 15z"
      fill="#34A853"
    />
    <path
      d="M4.06 9.32a4.2 4.2 0 0 1 0-2.65V4.85H1.72a7 7 0 0 0 0 6.3l2.34-1.83z"
      fill="#FBBC05"
    />
    <path
      d="M8 4.07c1.04 0 1.96.36 2.69 1.06l2.01-2A7 7 0 0 0 8 1a7 7 0 0 0-6.28 3.85l2.34 1.83C4.62 5.31 6.18 4.07 8 4.07z"
      fill="#EA4335"
    />
  </svg>
);

const AppleGlyph = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M11.95 8.42c-.02-1.85 1.51-2.74 1.58-2.78a3.4 3.4 0 0 0-2.66-1.44c-1.13-.12-2.21.66-2.78.66s-1.46-.65-2.4-.63a3.55 3.55 0 0 0-3 1.83c-1.29 2.23-.33 5.5.92 7.3.62.88 1.34 1.86 2.29 1.83.92-.04 1.27-.59 2.38-.59s1.43.59 2.4.57c.99-.02 1.62-.9 2.22-1.78a7.83 7.83 0 0 0 1-2.07 3.4 3.4 0 0 1-2.05-3.1zM10.13 3.13a3.27 3.27 0 0 0 .77-2.4 3.32 3.32 0 0 0-2.16 1.12 3.13 3.13 0 0 0-.79 2.31 2.74 2.74 0 0 0 2.18-1.03z" />
  </svg>
);

const MicrosoftGlyph = (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1" y="1" width="6.5" height="6.5" fill="#F25022" />
    <rect x="8.5" y="1" width="6.5" height="6.5" fill="#7FBA00" />
    <rect x="1" y="8.5" width="6.5" height="6.5" fill="#00A4EF" />
    <rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#FFB900" />
  </svg>
);

const GitHubGlyph = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2 .37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.41 7.41 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/* ──────────────────────────────────────────────────────────────────────
 * Sign In
 * ────────────────────────────────────────────────────────────────────── */

function SignInCard({
  goTo,
  navigate,
  authNextPath,
}: {
  goTo: (m: Mode) => void;
  navigate: (path: string) => void;
  authNextPath: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else navigate(authNextPath);
  };

  const oauth = useOAuthHandlers({ setError, setLoading, navigate, authNextPath });

  return (
    <AuthShell title="Welcome back." subtitle="Sign in to continue.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FieldInput
          aria-label="Email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <FieldInput
          aria-label="Password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <ErrorLine>{error}</ErrorLine>
        <PrimaryButton type="submit" loading={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </PrimaryButton>

        <div className="flex justify-end" style={{ marginTop: -2 }}>
          <button
            type="button"
            onClick={() => goTo('forgot')}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              letterSpacing: 'var(--track-body)',
              color: 'var(--text-tertiary)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            Forgot password?
          </button>
        </div>

        <Divider />

        <OAuthButton glyph={GoogleGlyph} label="Continue with Google" onClick={oauth.google} disabled={loading} />
        <OAuthButton glyph={AppleGlyph} label="Continue with Apple" onClick={oauth.apple} disabled={loading} />
      </form>

      <p
        style={{
          marginTop: 22,
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          color: 'var(--text-tertiary)',
        }}
      >
        New here?{' '}
        <button
          type="button"
          onClick={() => goTo('signup')}
          style={{
            color: 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Create an account
        </button>
      </p>
    </AuthShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Sign Up
 * ────────────────────────────────────────────────────────────────────── */

function SignUpCard({ goTo, authNextPath }: { goTo: (m: Mode) => void; authNextPath: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const stashedPrompt = useMemo(() => {
    try {
      return sessionStorage.getItem(PROMPT_HANDOFF_KEY) || '';
    } catch {
      return '';
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!acceptedTerms) {
      setError('Please accept the terms to continue.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const currentSession = (await supabase.auth.getSession()).data.session;
    const currentUser = currentSession?.user;
    const { error } = currentUser && isAnonymousUser(currentUser)
      ? await supabase.auth.updateUser(
          { email, password },
          { emailRedirectTo: authRedirectTo(authNextPath) },
        )
      : await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectTo(authNextPath) },
        });
    setLoading(false);
    if (error) setError(error.message);
    else goTo('sent');
  };

  const oauth = useOAuthHandlers({ setError, setLoading, authNextPath });

  const subtitle = stashedPrompt
    ? `We saved your message — finish setup to continue with Luca.`
    : 'A mind that lives on your machine, learns who you are, and tells you the truth about it.';

  return (
    <AuthShell
      eyebrow={stashedPrompt ? 'Picking up where you left off' : undefined}
      title="Begin the conversation."
      subtitle={subtitle}
    >
      {stashedPrompt && (
        <div
          aria-label="Your saved message"
          style={{
            background: 'var(--canvas)',
            border: '1px solid var(--border-faint)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            marginBottom: 18,
            fontFamily: 'var(--font-sans)',
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--text-body)',
            fontStyle: 'italic',
            maxHeight: 84,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical' as const,
            WebkitLineClamp: 3,
          }}
        >
          “{stashedPrompt}”
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FieldInput
          aria-label="Email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <FieldInput
          aria-label="Password"
          type="password"
          placeholder="Password (min 8 characters)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        <label
          className="flex items-start gap-2.5"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12.5,
            color: 'var(--text-body)',
            lineHeight: 1.5,
            marginTop: 2,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            style={{
              marginTop: 2,
              width: 14,
              height: 14,
              accentColor: 'var(--ink)',
              cursor: 'pointer',
            }}
          />
          <span>
            I agree to the{' '}
            <Link
              to="/terms"
              style={{
                color: 'var(--text-primary)',
                textDecoration: 'underline',
              }}
            >
              Terms
            </Link>{' '}
            and{' '}
            <Link
              to="/privacy"
              style={{
                color: 'var(--text-primary)',
                textDecoration: 'underline',
              }}
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <ErrorLine>{error}</ErrorLine>
        <PrimaryButton type="submit" loading={loading} disabled={!acceptedTerms}>
          {loading ? 'Creating account…' : 'Create account'}
        </PrimaryButton>

        <Divider />

        <OAuthButton glyph={GoogleGlyph} label="Continue with Google" onClick={oauth.google} disabled={loading} />
        <OAuthButton glyph={AppleGlyph} label="Continue with Apple" onClick={oauth.apple} disabled={loading} />
      </form>

      <p
        style={{
          marginTop: 22,
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          color: 'var(--text-tertiary)',
        }}
      >
        Already have an account?{' '}
        <button
          type="button"
          onClick={() => goTo('signin')}
          style={{
            color: 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Sign in
        </button>
      </p>
    </AuthShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Forgot password
 * ────────────────────────────────────────────────────────────────────── */

function ForgotCard({ goTo }: { goTo: (m: Mode) => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!email) {
      setError('Enter your email above first.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectTo('/reset-password'),
    });
    setLoading(false);
    if (error) console.warn('[reset]', error.message);
    setInfo('If that email exists, a reset link is on its way.');
  };

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to set a new one."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FieldInput
          aria-label="Email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <ErrorLine>{error}</ErrorLine>
        <InfoLine>{info}</InfoLine>
        <PrimaryButton type="submit" loading={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </PrimaryButton>
      </form>

      <p
        style={{
          marginTop: 18,
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          color: 'var(--text-tertiary)',
        }}
      >
        <button
          type="button"
          onClick={() => goTo('signin')}
          style={{
            color: 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Back to sign in
        </button>
      </p>
    </AuthShell>
  );
}

function SignupSentCard({ goTo }: { goTo: (m: Mode) => void }) {
  return (
    <AuthShell
      eyebrow="Check your email"
      title="One more step."
      subtitle="We sent you a verification link. Click it to finish setting up your account."
    >
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          lineHeight: 1.55,
          color: 'var(--text-tertiary)',
          marginBottom: 18,
        }}
      >
        Didn't get it? Check your spam folder, or{' '}
        <button
          type="button"
          onClick={() => goTo('signup')}
          style={{
            color: 'var(--text-primary)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          try a different email
        </button>
        .
      </p>
      <PrimaryButton type="button" onClick={() => goTo('signin')}>
        Already verified — sign in
      </PrimaryButton>
    </AuthShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared OAuth click handlers
 * ────────────────────────────────────────────────────────────────────── */

function useOAuthHandlers({
  setError,
  setLoading,
  navigate,
  authNextPath = '/chat',
}: {
  setError: (s: string) => void;
  setLoading: (b: boolean) => void;
  navigate?: (path: string) => void;
  authNextPath?: string;
}) {
  const run = useCallback(
    async (
      fn: () => Promise<{ error?: string; redirected: boolean }>
    ) => {
      setError('');
      setLoading(true);
      const { error, redirected } = await fn();
      if (error) {
        setError(error);
        setLoading(false);
        return;
      }
      if (!redirected && navigate) navigate(authNextPath);
    },
    [setError, setLoading, navigate, authNextPath]
  );

  return useMemo(
    () => ({
      google: () => run(() => signInWithGoogle(authNextPath)),
      apple: () => run(() => signInWithApple(authNextPath)),
      microsoft: () => run(() => signInWithMicrosoft(authNextPath)),
      github: () => run(() => signInWithGitHub(authNextPath)),
    }),
    [run]
  );
}
