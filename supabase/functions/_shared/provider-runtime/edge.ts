// deno-lint-ignore-file no-import-prefix
// Standalone Edge functions use the repository's existing ESM distribution.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../cors.ts";
import { ProviderBroker } from "./broker.ts";
import { providerConfiguration } from "./config.ts";
import type { ProviderDataClient } from "./database.ts";
import { ProviderError } from "./types.ts";
import { ProviderCipher, ProviderStore, uuid } from "./vault.ts";

const env = (name: string) => Deno.env.get(name);
function required(name: string): string {
  const value = env(name);
  if (!value) throw new ProviderError("provider_configuration_required", 503);
  return value;
}
export function cors(request: Request) {
  return {
    ...getCorsHeaders(request),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
export async function authenticate(request: Request): Promise<string> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.match(/^Bearer [^\s]+$/i)) {
    throw new ProviderError("provider_auth_required", 401);
  }
  const client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new ProviderError("provider_auth_required", 401);
  }
  return uuid(data.user.id);
}
export async function providerServices() {
  const config = providerConfiguration(env);
  const client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const db = client as unknown as ProviderDataClient;
  const store = new ProviderStore(
    db,
    await ProviderCipher.create(required("PROVIDER_CREDENTIAL_ENCRYPTION_KEY")),
  );
  const broker = new ProviderBroker(store, { chatgptConfig: config.chatgpt });
  return { config, db, store, broker, client };
}
