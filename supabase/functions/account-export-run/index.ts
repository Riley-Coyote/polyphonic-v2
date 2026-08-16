import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeaders } from "../_shared/cors.ts";
import { runExportSlice, type ExportRunPayload } from "../_shared/account-portability/server.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRoleKey || !supabaseUrl) {
    return new Response(JSON.stringify({ error: "not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Internal-only: the chain is driven with the service role key.
  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: (ExportRunPayload & { expires_at?: string }) | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body?.job_id || !body?.user_id || !body?.passphrase) {
    return new Response(JSON.stringify({ error: "job_id, user_id and passphrase required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const expiresAt = body.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await runExportSlice(admin, body, expiresAt);

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
