import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SECURITY DEFINER functions skip row-level security. On Supabase a new function
// in `public` is callable by anon and authenticated until revoked, so a GRANT to
// service_role alone leaves it open. The database-level test is
// supabase/tests/definer_functions_caller_scope.test.sql.

const FIX = '20260926170000_lock_definer_functions_to_caller.sql';

const SERVICE_ONLY = [
  'match_memories(text, integer, uuid, text)',
  'match_engrams(text, integer, uuid, text)',
  'match_engrams_vector(vector, integer, uuid, numeric, text)',
  'match_hypomnema_vector(vector, integer, uuid, text)',
  'anonymize_group_room_user(uuid)',
  'mnemos_reconsolidate(uuid[], uuid, text)',
  'mnemos_rehearse_scope(uuid, text, integer, numeric)',
  'append_continuity_trace_write(uuid, jsonb)',
  'mnemos_cleanup_legacy_beliefs(boolean, boolean, integer)',
  'mnemos_digest_backlog_drain(boolean, boolean, integer, numeric, numeric)',
  'mnemos_run_belief_challenge_cohort()',
  'mnemos_run_digest_autoreview_cohort(numeric, numeric)',
  'mnemos_run_digest_build_cohort()',
  'mnemos_run_health_snapshot()',
  'mnemos_run_identity_derivation_cohort()',
  'mnemos_run_rehearsal_cohort()',
  'prune_cron_job_run_details()',
  'reap_stuck_imports()',
];

// Callable by users on purpose: each checks the caller or only answers yes/no for RLS.
const REVIEWED_USER_CALLABLE = new Set([
  'cognitive_memory_stats',
  'decrypt_user_api_key',
  'save_user_api_key',
  'delete_user_api_key',
  'mark_activity_seen',
  'is_handle_owner',
  'current_user_token_gate_email_bypass',
  'has_role',
  'is_group_room_member',
  'can_manage_group_room',
  'can_read_group_message',
]);

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function migrationsAfterFix(): string[] {
  return readdirSync(join(process.cwd(), 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql') && f > FIX)
    .sort();
}

// Names of SECURITY DEFINER functions a migration creates. The attribute may sit
// before or after the dollar-quoted body.
function definerFunctions(sql: string): string[] {
  const names: string[] = [];
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi)) {
    const start = m.index ?? 0;
    const open = sql.slice(start).match(/\$\w*\$/);
    if (!open || open.index === undefined) continue;
    const bodyStart = start + open.index + open[0].length;
    const bodyEnd = sql.indexOf(open[0], bodyStart);
    const end = sql.indexOf(';', bodyEnd + open[0].length);
    const attributes = sql.slice(start, start + open.index) + sql.slice(bodyEnd, end === -1 ? undefined : end);
    if (/security\s+definer/i.test(attributes)) names.push(m[1]);
  }
  return names;
}

describe('owner-rights database functions stay scoped to the caller', () => {
  const fix = readRepoFile(`supabase/migrations/${FIX}`);

  it('closes the cross-account functions to signed-out and signed-in users', () => {
    for (const signature of SERVICE_ONLY) {
      expect(fix).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(fix).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
  });

  it('lets signed-in users read only their own memory stats', () => {
    expect(fix).toContain('CREATE OR REPLACE FUNCTION public.cognitive_memory_stats(p_user_id uuid, p_agent_id text)');
    expect(fix).toContain('IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_user_id THEN');
    expect(fix).toContain('REVOKE EXECUTE ON FUNCTION public.cognitive_memory_stats(uuid, text) FROM PUBLIC, anon;');
    expect(readRepoFile('src/stores/cognitiveStore.ts')).toContain("rpc('cognitive_memory_stats'");
  });

  it('does not reopen them in a later migration', () => {
    const names = SERVICE_ONLY.map((s) => s.slice(0, s.indexOf('(')));
    for (const file of migrationsAfterFix()) {
      const sql = readRepoFile(`supabase/migrations/${file}`);
      for (const name of names) {
        const grant = new RegExp(`grant\\s+(?:execute|all)[^;]*function\\s+(?:public\\.)?${name}\\b[^;]*\\bto\\b[^;]*\\b(?:public|anon|authenticated)\\b`, 'i');
        expect(sql, `${file} re-grants ${name}`).not.toMatch(grant);
      }
    }
  });

  it('revokes every new SECURITY DEFINER function from anon and authenticated', () => {
    for (const file of migrationsAfterFix()) {
      const sql = readRepoFile(`supabase/migrations/${file}`);
      for (const name of definerFunctions(sql)) {
        if (REVIEWED_USER_CALLABLE.has(name)) continue;
        const revoke = new RegExp(`revoke\\s+(?:execute|all)[^;]*function\\s+(?:public\\.)?${name}\\b[^;]*\\bfrom\\b[^;]*`, 'i');
        const statement = sql.match(revoke)?.[0] ?? '';
        expect(statement, `${file} leaves ${name} callable by users`).toMatch(/\banon\b/i);
        expect(statement, `${file} leaves ${name} callable by users`).toMatch(/\bauthenticated\b/i);
      }
    }
  });
});
