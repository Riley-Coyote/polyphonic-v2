import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// On this project a new table gets no default grants, so the connector's tables need
// explicit ones. Row-level security (20260928180000) decides which rows; the grants
// (20260930020000) decide whether a role may touch the table at all.

const GRANTS = '20260930020000_connector_table_grants.sql';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('connector tables are reachable by exactly the roles that use them', () => {
  const sql = readRepoFile(`supabase/migrations/${GRANTS}`);

  it('lets a signed-in person read and write their own grants, and read their own call log', () => {
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connector_grants TO authenticated;');
    expect(sql).toContain('GRANT SELECT ON TABLE public.connector_calls TO authenticated;');
  });

  it('gives the service role full access, including the call log id sequence', () => {
    expect(sql).toContain('GRANT ALL ON TABLE public.connector_grants TO service_role;');
    expect(sql).toContain('GRANT ALL ON TABLE public.connector_calls TO service_role;');
    expect(sql).toContain("pg_get_serial_sequence('public.connector_calls', 'id')");
  });

  it('keeps signed-out visitors out of both tables', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.connector_grants FROM PUBLIC, anon;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.connector_calls FROM PUBLIC, anon;');
    const later = readdirSync(join(process.cwd(), 'supabase/migrations')).filter((f) => f.endsWith('.sql') && f > GRANTS);
    const reopen = /grant\s+[^;]*on\s+(?:table\s+)?public\.connector_(?:grants|calls)\b[^;]*\bto\b[^;]*\b(?:public|anon)\b/i;
    for (const file of later) {
      expect(readRepoFile(`supabase/migrations/${file}`), `${file} opens a connector table to anon`).not.toMatch(reopen);
    }
  });

  it('matches what the browser does: it never writes the call log', () => {
    const client = readRepoFile('src/lib/connector.ts');
    expect(client).not.toMatch(/from\(['"]connector_calls['"]\)\s*\.(?:insert|upsert|update|delete)\(/);
  });
});
