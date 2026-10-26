import { useEffect, useRef, useState } from "react";
import { handleOpenRouterCallbackInPopup } from "@/lib/openrouterAuth";

/**
 * /auth/openrouter/callback — runs inside the popup that OpenRouter
 * redirects back to after the user finishes their PKCE flow there.
 *
 * Posts the `code` back to its opener (the Polyphonic app) and closes
 * itself. The user sees this page for ~80–120ms in the success path;
 * if something went wrong (no opener, expired code, popup deep-linked
 * directly), we surface a clear status with a return link instead.
 */
export default function OpenRouterCallback() {
  const [status, setStatus] = useState<{ ok: boolean | null; message: string }>({ ok: null, message: 'Finishing sign-in…' });
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    setStatus(handleOpenRouterCallbackInPopup());
  }, []);

  const accent = status.ok
    ? { dot: "var(--luca-full, #60a5fa)", ring: "rgba(96, 165, 250, 0.32)", glow: "rgba(96, 165, 250, 0.55)" }
    : { dot: "#c97c7c", ring: "rgba(201, 124, 124, 0.32)", glow: "rgba(201, 124, 124, 0.55)" };

  return (
    <div className="orcb-shell">
      <style>{`
        .orcb-shell {
          position: fixed;
          inset: 0;
          background: var(--floor, #0a0a0c);
          color: var(--text-body, rgba(210, 208, 204, 0.72));
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;
          overflow: hidden;
          animation: orcbFade 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .orcb-shell::before {
          content: '';
          position: absolute;
          inset: -10%;
          background:
            radial-gradient(circle at 50% 35%, ${accent.glow.replace("0.55", "0.10")} 0%, transparent 55%),
            radial-gradient(circle at 30% 80%, rgba(255,255,255,0.018) 0%, transparent 60%);
          pointer-events: none;
        }
        .orcb-content {
          position: relative;
          max-width: 380px;
          width: 100%;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
        }
        .orcb-mark {
          position: relative;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .orcb-mark::before,
        .orcb-mark::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid ${accent.ring};
        }
        .orcb-mark::before {
          animation: orcbHalo 2.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
        }
        .orcb-mark::after {
          animation: orcbHalo 2.6s cubic-bezier(0.22, 1, 0.36, 1) infinite 1.3s;
        }
        .orcb-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${accent.dot};
          box-shadow: 0 0 0 1px ${accent.ring}, 0 0 14px ${accent.glow};
          animation: orcbBreathe 2.6s ease-in-out infinite;
        }
        .orcb-eyebrow {
          font-size: 11px;
          font-weight: 200;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-tertiary, rgba(178, 176, 172, 0.56));
          margin: 0;
        }
        .orcb-title {
          font-size: 24px;
          font-weight: 450;
          letter-spacing: -0.018em;
          line-height: 1.25;
          color: var(--ink, rgba(244, 243, 240, 0.93));
          margin: 0;
        }
        .orcb-subtitle {
          font-size: 13.5px;
          font-weight: 400;
          line-height: 1.55;
          color: var(--text-body, rgba(210, 208, 204, 0.72));
          margin: 0;
          max-width: 320px;
        }
        .orcb-link {
          font-size: 12.5px;
          color: var(--text-primary, rgba(244, 243, 240, 0.9));
          text-decoration: underline;
          text-underline-offset: 2px;
          margin-top: 6px;
        }
        @keyframes orcbFade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes orcbBreathe {
          0%, 100% { opacity: 0.55; transform: scale(0.95); }
          50%      { opacity: 1;    transform: scale(1.05); }
        }
        @keyframes orcbHalo {
          0%   { opacity: 0.55; transform: scale(0.7); }
          70%  { opacity: 0;    transform: scale(2.4); }
          100% { opacity: 0;    transform: scale(2.4); }
        }
        @media (prefers-reduced-motion: reduce) { .orcb-shell,.orcb-mark::before,.orcb-mark::after,.orcb-dot { animation: none; } }
      `}</style>

      <div className="orcb-content">
        <div className="orcb-mark" aria-hidden="true">
          <span className="orcb-dot" />
        </div>
        <p className="orcb-eyebrow">Polyphonic · OpenRouter</p>
        <h1 className="orcb-title">
          {status.ok === null ? "Finishing sign-in…" : status.ok ? "Returning to Polyphonic." : "Couldn't connect."}
        </h1>
        <p className="orcb-subtitle">
          {status.message}
        </p>
        {!window.opener && (
          <a className="orcb-link" href="/settings/models">
            Return to Polyphonic
          </a>
        )}
      </div>
    </div>
  );
}
