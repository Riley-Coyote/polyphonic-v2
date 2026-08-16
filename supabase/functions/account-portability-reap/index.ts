import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightIfNeeded, getCorsHeaders } from "../_shared/cors.ts";

// Cron-only maintenance: fails stalled export/import jobs, removes the
// per-chunk scratch objects they leave behind, and clears expired archives.
const STALE_JOB_MS = 10 * 60 * 1000;
const BUCKET = "account-portability";

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!serviceRoleKey || !supabaseUrl) return json(req, { error: "Not configured" }, 500);
  if (token !== serviceRoleKey) return json(req, { error: "Forbidden" }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const staleCutoff = new Date(Date.now() - STALE_JOB_MS).toISOString();
  const nowIso = new Date().toISOString();
  const result = { stalled: 0, chunk_folders_cleared: 0, chunks_deleted: 0, archives_expired: 0 };

  try {
    const { data: stalled } = await admin
      .from("account_portability_jobs")
      .select("id,user_id")
      .eq("status", "processing")
      .lt("updated_at", staleCutoff)
      .limit(200);

    for (const job of stalled || []) {
      await admin
        .from("account_portability_jobs")
        .update({
          status: "failed",
          errors: ["Export stopped responding and was marked failed. Please try again."],
          updated_at: nowIso,
        })
        .eq("id", job.id as string);
      result.stalled += 1;
    }

    // Any job that is no longer processing should not keep chunk scratch files.
    const { data: finished } = await admin
      .from("account_portability_jobs")
      .select("id,user_id")
      .neq("status", "processing")
      .order("updated_at", { ascending: false })
      .limit(500);

    for (const job of finished || []) {
      const prefix = `${job.user_id}/${job.id}/chunks`;
      const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (!objects?.length) continue;
      const paths = objects.map((item: { name: string }) => `${prefix}/${item.name}`);
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      if (error) continue;
      result.chunk_folders_cleared += 1;
      result.chunks_deleted += paths.length;
    }

    // Expired archives: drop the file and clear the pointer.
    const { data: expired } = await admin
      .from("account_portability_jobs")
      .select("id,user_id,storage_path,storage_bucket")
      .eq("direction", "export")
      .not("storage_path", "is", null)
      .lt("expires_at", nowIso)
      .limit(200);

    for (const job of expired || []) {
      const path = job.storage_path as string;
      await admin.storage.from((job.storage_bucket as string) || BUCKET).remove([path]);
      await admin
        .from("account_portability_jobs")
        .update({ storage_path: null, updated_at: nowIso })
        .eq("id", job.id as string);
      result.archives_expired += 1;
    }

    return json(req, { ok: true, ...result });
  } catch (error) {
    console.error("account-portability-reap failed", error);
    return json(req, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
