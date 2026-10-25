import { listAnthropicModels } from "./anthropic.ts";
import {
  beginChatGPTOAuth,
  type ChatGPTOAuthTransaction,
  type ChatGPTSession,
  validateChatGPTHostedConfig,
} from "./chatgpt-oauth.ts";
import type { ProviderConfiguration } from "./config.ts";
import type { ProviderBroker } from "./broker.ts";
import { opaque } from "./http.ts";
import {
  type AnthropicCredential,
  ProviderError,
  type ProviderFetch,
} from "./types.ts";
import {
  type ConnectionMetadata,
  isObject,
  type ProviderConnection,
  ProviderStore,
  randomOpaque,
  safeLabel,
  uuid,
} from "./vault.ts";

export type OAuthPayload = {
  kind: "authorize";
  transaction: ChatGPTOAuthTransaction;
  authorizationUrl: string;
  connectionId: string;
  version: number;
  subject: string | null;
  label: string;
};
export type OAuthCompletion =
  & Omit<OAuthPayload, "kind" | "transaction" | "authorizationUrl">
  & { kind: "complete"; session: ChatGPTSession };
export const publicConnection = (c: ProviderConnection) => ({
  id: c.id,
  provider: c.provider,
  label: c.label,
  status: c.status,
  expires_at: c.expires_at,
  created_at: c.created_at,
});
export function chatGPTMetadata(
  session: ChatGPTSession,
  label: string,
): ConnectionMetadata {
  return {
    provider: "chatgpt",
    label,
    subject: session.subject,
    workspace_id: null,
    status: session.grantedScopes.includes("resource.invoke") &&
        session.grantedScopes.includes("chatgpt.tokens.use.direct")
      ? "connected"
      : "identity_only",
    granted_scopes: [...session.grantedScopes],
    expires_at: new Date(session.expiresAt * 1000).toISOString(),
  };
}
export type ConnectionActions = {
  store: Pick<ProviderStore, "read" | "save" | "createOAuth" | "completeOAuth">;
  broker: Pick<ProviderBroker, "listModels" | "disconnect">;
  config: ProviderConfiguration;
  list: (user: string) => Promise<ProviderConnection[]>;
  fetcher?: ProviderFetch;
  createThread?: (
    user: string,
    connection: string,
    model: string,
    agent: string,
    thread?: string,
  ) => Promise<string>;
  threadBindings?: (
    user: string,
  ) => Promise<Record<string, { connection_id: string; model: string }>>;
};
/** All actions run only after a fresh Supabase getUser verification by the Edge entry point. */
export async function connectionAction(
  body: Record<string, unknown>,
  user: string,
  deps: ConnectionActions,
): Promise<unknown> {
  user = uuid(user);
  const { store, config } = deps;
  if (body.action === "list") {
    return {
      connections: (await deps.list(user)).map(publicConnection),
      thread_bindings: await deps.threadBindings?.(user) ?? {},
      capabilities: {
        anthropic: { available: true },
        chatgpt: {
          available: config.chatgptAvailable,
          reason: config.chatgptAvailable
            ? null
            : !config.chatgpt.approved || !config.chatgpt.planUsageApproved
            ? "approval_required"
            : "configuration_required",
        },
      },
    };
  }
  if (body.action === "chatgpt_finish") {
    validateChatGPTHostedConfig(config.chatgpt);
    const payload = await store.completeOAuth(user, opaque(body.ticket));
    if (
      !isObject(payload) || payload.kind !== "complete" ||
      !isObject(payload.session)
    ) throw new ProviderError("provider_auth_required", 401);
    const completion = payload as unknown as OAuthCompletion;
    // Only an authenticated login for the original Polyphonic user can reach this encrypted verified session.
    const session = completion.session;
    if (
      session.provider !== "chatgpt" ||
      session.clientId !== config.chatgpt.clientId ||
      (completion.subject && completion.subject !== session.subject)
    ) throw new ProviderError("provider_auth_required", 401);
    const saved = await store.save(
      user,
      uuid(completion.connectionId),
      chatGPTMetadata(session, safeLabel(completion.label, "ChatGPT")),
      session,
      completion.version,
    );
    return { connection: publicConnection(saved.connection) };
  }
  const id = uuid(body.connection_id);
  if (body.action === "models") {
    return { models: await deps.broker.listModels(user, id) };
  }
  if (body.action === "create_thread") {
    if (
      !deps.createThread || typeof body.model !== "string" || !body.model ||
      body.model.length > 512 ||
      typeof body.agent_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(body.agent_id)
    ) throw new ProviderError("provider_invalid_request", 400);
    if (
      !(await deps.broker.listModels(user, id)).some((model) =>
        model.id === body.model
      )
    ) throw new ProviderError("provider_permission_required", 403);
    return {
      thread_id: await deps.createThread(
        user,
        id,
        body.model,
        body.agent_id,
        body.thread_id === undefined ? undefined : uuid(body.thread_id),
      ),
    };
  }
  if (body.action === "disconnect") {
    return await deps.broker.disconnect(user, id);
  }
  let previous = await store.read(user, id);
  if (body.action === "save_anthropic") {
    if (previous && previous.connection.provider !== "anthropic") {
      throw new ProviderError("provider_invalid_request", 400);
    }
    if (
      typeof body.api_key !== "string" ||
      !/^sk-ant-api[\x21-\x7e]+$/.test(body.api_key) ||
      body.api_key.length > 4096
    ) throw new ProviderError("provider_configuration_required", 400);
    if (
      body.workspace_id !== undefined && body.workspace_id !== "" &&
      (typeof body.workspace_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(body.workspace_id))
    ) throw new ProviderError("provider_invalid_request", 400);
    const credential: AnthropicCredential = {
      provider: "anthropic",
      apiKey: body.api_key,
      ...(body.workspace_id ? { workspaceId: String(body.workspace_id) } : {}),
    };
    if (!previous) {
      previous = await store.save(
        user,
        id,
        {
          provider: "anthropic",
          label: safeLabel(body.label, "Claude API"),
          subject: null,
          workspace_id: credential.workspaceId ?? null,
          status: "needs_reconnect",
          granted_scopes: [],
          expires_at: null,
        },
        { pending: true },
        0,
      );
    }
    // Model discovery validates the key/workspace without spending inference credits.
    const models = await listAnthropicModels(credential, deps.fetcher);
    const saved = await store.save(
      user,
      id,
      {
        provider: "anthropic",
        label: safeLabel(body.label, "Claude API"),
        subject: null,
        workspace_id: credential.workspaceId ?? null,
        status: "connected",
        granted_scopes: [],
        expires_at: null,
      },
      credential,
      previous?.version ?? 0,
    );
    return { connection: publicConnection(saved.connection), models };
  }
  if (body.action === "chatgpt_start") {
    if (previous && previous.connection.provider !== "chatgpt") {
      throw new ProviderError("provider_invalid_request", 400);
    }
    const start = await beginChatGPTOAuth(config.chatgpt);
    // A pending record makes disconnect effective even before the first OAuth callback arrives.
    if (!previous) {
      previous = await store.save(
        user,
        id,
        {
          provider: "chatgpt",
          label: safeLabel(body.label, "ChatGPT"),
          subject: null,
          workspace_id: null,
          status: "needs_reconnect",
          granted_scopes: [],
          expires_at: null,
        },
        { pending: true },
        0,
      );
    }
    const ticket = randomOpaque();
    const payload: OAuthPayload = {
      kind: "authorize",
      ...start,
      connectionId: id,
      version: previous?.version ?? 0,
      subject: previous?.connection.subject ?? null,
      label: safeLabel(body.label, previous?.connection.label ?? "ChatGPT"),
    };
    await store.createOAuth(
      user,
      start.transaction.state,
      ticket,
      payload,
      start.transaction.expiresAt,
    );
    const url = new URL(config.oauthStart);
    url.searchParams.set("ticket", ticket);
    return { authorization_url: url.href };
  }
  throw new ProviderError("provider_invalid_request", 400);
}
