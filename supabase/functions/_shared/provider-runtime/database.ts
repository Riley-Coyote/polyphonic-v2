import { ProviderError } from "./types.ts";
import {
  isObject,
  type ProviderConnection,
  type ProviderDatabase,
  uuid,
} from "./vault.ts";

type Result = { data: unknown; error: unknown };
/** Structural PostgREST interface keeps this standalone Edge module independent of frontend-generated database types. */
export type Query = PromiseLike<Result> & {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  neq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): Query;
  single(): Query;
  insert(value: Record<string, unknown>): Query;
  update(value: Record<string, unknown>): Query;
  not(column: string, operator: string, value: unknown): Query;
  range(from: number, to: number): Query;
};
export type ProviderDataClient = ProviderDatabase & {
  from(table: string): Query;
};
export async function data(query: PromiseLike<Result>): Promise<unknown> {
  const result = await query;
  if (result.error) throw new ProviderError("provider_unavailable", 503);
  return result.data;
}
export async function listConnections(
  db: ProviderDataClient,
  user: string,
): Promise<ProviderConnection[]> {
  const rows = await data(
    db.from("provider_connections").select(
      "id,user_id,provider,label,subject,workspace_id,status,granted_scopes,expires_at,created_at,updated_at",
    ).eq("user_id", uuid(user)).neq("status", "disabled").order("created_at"),
  );
  if (
    !Array.isArray(rows) ||
    rows.some((row) =>
      !isObject(row) || row.user_id !== user ||
      !["anthropic", "chatgpt"].includes(String(row.provider))
    )
  ) throw new ProviderError("provider_malformed");
  return rows as ProviderConnection[];
}
export async function createConnectedThread(
  db: ProviderDataClient,
  user: string,
  connection: string,
  model: string,
  agent: string,
  thread: string = crypto.randomUUID(),
): Promise<string> {
  const existing = await data(
    db.from("threads").select(
      "id,user_id,provider_connection_id,selected_model,agent_id",
    ).eq("user_id", user).eq("id", thread).maybeSingle(),
  );
  if (existing !== null) {
    if (
      !isObject(existing) || existing.user_id !== user ||
      existing.provider_connection_id !== connection ||
      existing.selected_model !== model || existing.agent_id !== agent
    ) throw new ProviderError("provider_invalid_request", 409);
    return uuid(existing.id);
  }
  if (agent !== "luca") {
    const resident = await data(
      db.from("agent_configs").select("id,user_id").eq("user_id", user).eq(
        "id",
        agent,
      ).maybeSingle(),
    );
    if (
      !isObject(resident) || resident.user_id !== user || resident.id !== agent
    ) throw new ProviderError("provider_permission_required", 403);
  }
  const row = await data(
    db.from("threads").insert({
      id: thread,
      user_id: user,
      provider_connection_id: connection,
      selected_model: model,
      runtime_mode: "agent",
      agent_id: agent,
      primary_agent_id: agent,
      participating_agent_ids: [agent],
      memory_enabled: true,
    }).select("id").single(),
  );
  if (!isObject(row)) throw new ProviderError("provider_malformed");
  return uuid(row.id);
}
export async function threadBindings(
  db: ProviderDataClient,
  user: string,
): Promise<Record<string, { connection_id: string; model: string }>> {
  const bindings: Record<string, { connection_id: string; model: string }> = {};
  for (let offset = 0; offset < 10000; offset += 500) {
    const rows = await data(
      db.from("threads").select(
        "id,user_id,provider_connection_id,selected_model",
      ).eq("user_id", user).not("provider_connection_id", "is", null).order(
        "id",
      ).range(offset, offset + 499),
    );
    if (!Array.isArray(rows)) throw new ProviderError("provider_malformed");
    for (const value of rows) {
      if (
        !isObject(value) || value.user_id !== user ||
        typeof value.selected_model !== "string"
      ) throw new ProviderError("provider_malformed");
      bindings[uuid(value.id)] = {
        connection_id: uuid(value.provider_connection_id),
        model: value.selected_model,
      };
    }
    if (rows.length < 500) return bindings;
  }
  throw new ProviderError("provider_too_large", 413);
}
