import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function walkFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relPath = `${dir}/${entry.name}`;
    const absPath = join(process.cwd(), relPath);
    if (entry.isDirectory()) {
      if (entry.name === 'test') return [];
      return walkFiles(relPath);
    }
    return statSync(absPath).isFile() ? [relPath] : [];
  });
}

function edgeFunctionNames(): string[] {
  return readdirSync(join(process.cwd(), 'supabase/functions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

function edgeFunctionSource(name: string): string {
  return readRepoFile(`supabase/functions/${name}/index.ts`);
}

describe('launch readiness static gates', () => {
  it('keeps client source free of service-role key references', () => {
    const scannedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
    const offenders = walkFiles('src')
      .filter((path) => scannedExtensions.has(extname(path)))
      .filter((path) => /SERVICE_ROLE|SUPABASE_SERVICE_ROLE|service_role/i.test(readRepoFile(path)));

    expect(offenders).toEqual([]);
  });

  it('keeps browser CORS explicit and production-scoped', () => {
    const cors = readRepoFile('supabase/functions/_shared/cors.ts');

    expect(cors).toContain('"https://polyphonic.chat"');
    expect(cors).toContain('"https://www.polyphonic.chat"');
    expect(cors).toContain('"https://polyphonic-v2.lovable.app"');
    expect(cors).toContain('LOVABLE_PREVIEW_ORIGIN');
    expect(cors).toContain('!IS_PROD && LOCAL_DEV_ORIGIN.test(origin)');
    expect(cors).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(cors).not.toContain("'Access-Control-Allow-Origin': '*'");
  });

  it('keeps edge functions wrapped with CORS, catches, and source auth markers', () => {
    const config = readRepoFile('supabase/config.toml');
    const configured = new Map(
      [...config.matchAll(/^\s*\[functions\.([^\]]+)\]\s*\n\s*verify_jwt\s*=\s*(\w+)/gm)].map((match) => [match[1], match[2]]),
    );

    const rows = edgeFunctionNames().map((name) => {
      const source = edgeFunctionSource(name);
      const hasAuthMarker =
        source.includes('authenticateUser(req)') ||
        source.includes('requireAuth(req)') ||
        source.includes('requireUser(req)') ||
        source.includes('requireAuthedContext(req)') ||
        source.includes('authorizeCronOrSelf(req') ||
        source.includes('auth.getUser') ||
        source.includes('auth.getClaims') ||
        source.includes('.getUser(') ||
        source.includes('requireServiceRole(req') ||
        source.includes('auth !== `Bearer ${serviceRole}`') ||
        source.includes('authHeader !== `Bearer ${serviceRoleKey}`') ||
        source.includes('authenticateDeviceToken(') ||
        source.includes('verifyWebhookRequest(') ||
        source.includes('passphraseMatches(') ||
        source.includes('.eq("state", state)') ||
        source.includes("claims?.role !== 'service_role'");

      return {
        name,
        verifyJwt: configured.get(name),
        hasPreflight: /handleCorsPreflightIfNeeded\(req\)|req\.method\s*={0,2}=\s*["']OPTIONS["']/.test(source),
        hasCorsResponse: /getCorsHeaders\(req\)|jsonResponse\(req|corsHeaders|corsHeaders\(/.test(source),
        hasCatch: /try\s*\{|wrapHandler\(/.test(source),
        hasAuthMarker,
      };
    });

    // Expected count grows as new edge functions land. Each new function must
    // satisfy the wrapper assertions below; bumping the count is intentional
    // and signals a deliberate review.
    expect(rows.map((row) => row.name)).toHaveLength(118);
    expect(rows.filter((row) => !row.hasPreflight).map((row) => row.name)).toEqual([]);
    expect(rows.filter((row) => !row.hasCorsResponse).map((row) => row.name)).toEqual([]);
    expect(rows.filter((row) => !row.hasCatch).map((row) => row.name)).toEqual([]);
    expect(rows.filter((row) => row.verifyJwt === 'false' && !row.hasAuthMarker).map((row) => row.name)).toEqual([]);
  });

  it('publishes release metadata, social tags, robots, and a web manifest', () => {
    const index = readRepoFile('index.html');
    const robots = readRepoFile('public/robots.txt');
    const manifest = JSON.parse(readRepoFile('public/site.webmanifest')) as {
      name?: string;
      start_url?: string;
      display?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string }>;
    };

    expect(index).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(index).toContain('<link rel="canonical" href="https://polyphonic.chat/" />');
    expect(index).toContain('<meta property="og:image" content="https://polyphonic.chat/favicon.png" />');
    expect(index).toContain('<meta name="twitter:image" content="https://polyphonic.chat/favicon.png" />');
    expect(index).toContain('<meta name="theme-color" content="#000000" />');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://polyphonic.chat/sitemap.xml');
    expect(existsSync(join(process.cwd(), 'public/sitemap.xml'))).toBe(true);
    expect(manifest.name).toBe('Polyphonic');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons?.some((icon) => icon.src === '/favicon.svg' && icon.sizes === 'any')).toBe(true);
  });
});
