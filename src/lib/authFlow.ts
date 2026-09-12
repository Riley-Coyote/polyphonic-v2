import { lovable } from '@/integrations/lovable';
import { supabase } from '@/integrations/supabase/client';
import { isAnonymousUser } from '@/lib/accessTier';

export function authRedirectTo(path = '/chat'): string {
  const origin = window.location.origin;
  const candidate = path.startsWith('/') ? path : `/${path}`;
  const safePath = safeAuthNextPath(candidate);
  return `${origin}${safePath}`;
}

type OAuthResult = { error?: string; redirected: boolean };

export function safeAuthNextPath(value: string | null | undefined, fallback = '/chat'): string {
  const raw = (value || '').trim();
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    if (url.pathname.startsWith('/auth/')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

async function linkAnonymousIdentity(
  provider: 'google' | 'apple' | 'github' | 'azure',
  nextPath = '/chat',
  options: Record<string, unknown> = {},
): Promise<OAuthResult | null> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!isAnonymousUser(session?.user)) return null;

  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: {
      redirectTo: authRedirectTo(nextPath),
      ...options,
    },
  } as any);

  // Manual identity linking can be unavailable (disabled project-side, provider not
  // configured on the auth server, etc). In that case fall through to the normal
  // sign-in flow instead of dead-ending the guest on an error message.
  if (error || !data?.url) return null;
  return { redirected: true };
}

export async function signInWithGoogle(nextPath = '/chat'): Promise<{ error?: string; redirected: boolean }> {
  const linked = await linkAnonymousIdentity('google', nextPath, {
    queryParams: {
      prompt: 'select_account',
    },
  });
  if (linked) return linked;

  const result = await lovable.auth.signInWithOAuth('google', {
    redirect_uri: authRedirectTo(nextPath),
    extraParams: {
      prompt: 'select_account',
    },
  });

  if (result.error) {
    return {
      error: result.error.message ?? 'Google sign-in failed',
      redirected: false,
    };
  }

  return { redirected: Boolean(result.redirected) };
}

export async function signInWithApple(nextPath = '/chat'): Promise<{ error?: string; redirected: boolean }> {
  const linked = await linkAnonymousIdentity('apple', nextPath);
  if (linked) return linked;

  const result = await lovable.auth.signInWithOAuth('apple', {
    redirect_uri: authRedirectTo(nextPath),
  });

  if (result.error) {
    return {
      error: result.error.message ?? 'Apple sign-in failed',
      redirected: false,
    };
  }

  return { redirected: Boolean(result.redirected) };
}

export async function signInWithMicrosoft(nextPath = '/chat'): Promise<{ error?: string; redirected: boolean }> {
  const linked = await linkAnonymousIdentity('azure', nextPath);
  if (linked) return linked;

  const result = await lovable.auth.signInWithOAuth('microsoft', {
    redirect_uri: authRedirectTo(nextPath),
  });

  if (result.error) {
    return {
      error: result.error.message ?? 'Microsoft sign-in failed',
      redirected: false,
    };
  }

  return { redirected: Boolean(result.redirected) };
}

/**
 * GitHub OAuth — Lovable's wrapper doesn't expose GitHub yet, so we
 * route through Supabase directly. The redirect target matches the
 * other providers so the session lands the same way.
 */
export async function signInWithGitHub(nextPath = '/chat'): Promise<{ error?: string; redirected: boolean }> {
  const linked = await linkAnonymousIdentity('github', nextPath);
  if (linked) return linked;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: authRedirectTo(nextPath),
    },
  });

  if (error) {
    return { error: error.message ?? 'GitHub sign-in failed', redirected: false };
  }

  return { redirected: Boolean(data?.url) };
}
