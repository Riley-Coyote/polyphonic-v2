import { handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import {
  deleteExportJobChunks,
  handleError,
  jsonResponse,
  readJsonBody,
  requireAuth,
  requiredString,
} from "../_shared/account-portability/server.ts";

// A running export heartbeats at least once per table; if nothing has been
// written for this long the worker died (usually OOM) and the job is stale.
const STALE_JOB_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed" }, 405);

  try {
    const { admin, user } = await requireAuth(req);
    const body = await readJsonBody(req);
    const jobId = requiredString(body, "job_id");
    const { data: job, error } = await admin
      .from("account_portability_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return jsonResponse(req, { error: "Job not found" }, 404);

    const { count } = await admin
      .from("account_portability_row_map")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("user_id", user.id);

    const jobRow = job as {
      direction?: unknown;
      status?: unknown;
      storage_bucket?: unknown;
      storage_path?: unknown;
    };
    let signed_url: string | null = null;
    if (
      jobRow.direction === "export"
      && jobRow.status === "completed"
      && typeof jobRow.storage_bucket === "string"
      && typeof jobRow.storage_path === "string"
    ) {
      const { data } = await admin.storage
        .from(jobRow.storage_bucket)
        .createSignedUrl(jobRow.storage_path, 60 * 60 * 24 * 7);
      signed_url = data?.signedUrl ?? null;
    }

    return jsonResponse(req, { ok: true, job, row_maps: count || 0, signed_url });
  } catch (error) {
    return handleError(req, error);
  }
});
