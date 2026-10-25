import { listAnthropicModels, streamAnthropic } from "./anthropic.ts";
import { listChatGPTModels, streamChatGPT } from "./chatgpt.ts";
import {
  CHATGPT_ISSUER,
  type ChatGPTHostedConfig,
  type ChatGPTSession,
  refreshChatGPTSession,
  revokeChatGPTSession,
  validateChatGPTHostedConfig,
} from "./chatgpt-oauth.ts";
import {
  type AnthropicCredential,
  type ProviderChatInput,
  type ProviderCredential,
  ProviderError,
  type ProviderEvent,
  type ProviderFetch,
  type ProviderModel,
} from "./types.ts";
import {
  type ConnectionMetadata,
  isObject,
  type ProviderStore,
  safeLabel,
  type StoredConnection,
  uuid,
} from "./vault.ts";

const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const REFRESH_MARGIN = 60;
const POLL_LIMIT = 16;
const POLL_MILLISECONDS = 500;

/** Deliberately structural so fixtures can exercise the broker without a live database. */
export type ProviderCredentialStore = Pick<
  ProviderStore,
  "read" | "credential" | "lease" | "save" | "invalidate" | "disconnect"
>;
export type ProviderBrokerOptions = {
  chatgptConfig?: ChatGPTHostedConfig;
  fetcher?: ProviderFetch;
  nowSeconds?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  leaseId?: () => string;
  revokeTimeoutMs?: number;
};
export type UsableProviderCredential = {
  record: StoredConnection;
  credential: AnthropicCredential | ChatGPTSession;
};
export type ProviderDisconnectResult = {
  revocation: "confirmed" | "unconfirmed" | "not_applicable";
};

function text(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return typeof value === "string" && value.length >= minimum &&
    value.length <= maximum && /^[\x21-\x7e]+$/.test(value);
}
function scopeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 &&
    value.every((scope) => text(scope, 1, 256)) &&
    new Set(value).size === value.length;
}
function sameScopes(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((scope) => right.includes(scope));
}
function hasPlan(session: ChatGPTSession): boolean {
  return session.grantedScopes.includes(PLAN_SCOPE) &&
    session.grantedScopes.includes("resource.invoke") && !!session.accessToken;
}
function asChatGPT(value: unknown): ChatGPTSession {
  if (
    !isObject(value) || value.provider !== "chatgpt" ||
    value.issuer !== CHATGPT_ISSUER || !text(value.clientId, 1, 256) ||
    value.clientId === "dynamic_agent_client" || !text(value.subject, 1, 512) ||
    !scopeList(value.grantedScopes) || !Number.isSafeInteger(value.expiresAt) ||
    Number(value.expiresAt) <= 0 ||
    Number(value.expiresAt) > 8_640_000_000_000 ||
    !(value.accessToken === "" || text(value.accessToken, 1, 32_768)) ||
    (value.refreshToken !== undefined &&
      !text(value.refreshToken, 1, 32_768)) ||
    (value.idToken !== undefined && !text(value.idToken, 1, 32_768)) ||
    (value.email !== undefined &&
      (typeof value.email !== "string" || value.email.length > 320)) ||
    (value.name !== undefined &&
      (typeof value.name !== "string" || value.name.length > 512))
  ) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  return {
    provider: "chatgpt",
    issuer: CHATGPT_ISSUER,
    clientId: value.clientId,
    subject: value.subject,
    accessToken: value.accessToken,
    grantedScopes: [...value.grantedScopes],
    expiresAt: value.expiresAt as number,
    ...(value.refreshToken === undefined
      ? {}
      : { refreshToken: value.refreshToken as string }),
    ...(value.idToken === undefined
      ? {}
      : { idToken: value.idToken as string }),
    ...(value.email === undefined ? {} : { email: value.email as string }),
    ...(value.name === undefined ? {} : { name: value.name as string }),
  };
}
function asAnthropic(value: unknown): AnthropicCredential {
  if (
    !isObject(value) || value.provider !== "anthropic" ||
    !text(value.apiKey, 8, 4096) || value.apiKey.startsWith("sk-ant-oat") ||
    (value.workspaceId !== undefined &&
      (typeof value.workspaceId !== "string" ||
        value.workspaceId.length > 200 ||
        !/^[A-Za-z0-9_-]+$/.test(value.workspaceId)))
  ) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  return {
    provider: "anthropic",
    apiKey: value.apiKey,
    ...(value.workspaceId === undefined
      ? {}
      : { workspaceId: value.workspaceId as string }),
  };
}

/** Safe display metadata is separate from the encrypted, verified session. */
export function metadataForChatGPTSession(
  session: ChatGPTSession,
  label: string,
): ConnectionMetadata {
  const checked = asChatGPT(session);
  return {
    provider: "chatgpt",
    label: safeLabel(label, "ChatGPT"),
    subject: checked.subject,
    workspace_id: null,
    status: hasPlan(checked) ? "connected" : "identity_only",
    granted_scopes: [...checked.grantedScopes],
    expires_at: new Date(checked.expiresAt * 1000).toISOString(),
  };
}

/** Pure dispatch for a credential already resolved and authorized by ProviderBroker. Never retries or changes billing. */
export async function* streamWithCredential(
  input: ProviderChatInput,
  credential: ProviderCredential,
  fetcher: ProviderFetch = fetch,
): AsyncGenerator<ProviderEvent> {
  if (credential.provider === "anthropic") {
    yield* streamAnthropic(input, credential, fetcher);
  } else if (credential.provider === "chatgpt") {
    yield* streamChatGPT(input, credential, fetcher);
  } else throw new ProviderError("provider_unsupported", 400);
}

export class ProviderBroker {
  private readonly fetcher: ProviderFetch;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly leaseId: () => string;
  constructor(
    readonly store: ProviderCredentialStore,
    readonly options: ProviderBrokerOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.wait = options.wait ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.leaseId = options.leaseId ?? (() => crypto.randomUUID());
  }
  private now(): number {
    const now = this.options.nowSeconds?.() ?? Date.now() / 1000;
    if (!Number.isFinite(now) || now < 0) {
      throw new ProviderError("provider_configuration_required", 503);
    }
    return Math.floor(now);
  }
  private config(): ChatGPTHostedConfig {
    const config = this.options.chatgptConfig;
    if (!config) {
      throw new ProviderError("provider_configuration_required", 503);
    }
    validateChatGPTHostedConfig(config);
    return config;
  }
  private checkRecord(
    record: StoredConnection | null,
    user: string,
    id: string,
  ): StoredConnection {
    if (!record) throw new ProviderError("provider_auth_required", 401);
    if (
      record.connection.user_id !== user || record.connection.id !== id ||
      !["chatgpt", "anthropic"].includes(record.connection.provider) ||
      !Number.isSafeInteger(record.version) || record.version < 1 ||
      !scopeList(record.connection.granted_scopes)
    ) throw new ProviderError("provider_permission_required", 403);
    if (record.connection.status === "identity_only") {
      throw new ProviderError("provider_permission_required", 403);
    }
    if (record.connection.status !== "connected" || !record.encrypted_secret) {
      throw new ProviderError("provider_auth_required", 401);
    }
    return record;
  }
  private async resolved(
    record: StoredConnection,
  ): Promise<AnthropicCredential | ChatGPTSession> {
    const raw = await this.store.credential(record),
      connection = record.connection;
    if (connection.provider === "anthropic") {
      const key = asAnthropic(raw);
      if (
        connection.subject !== null || connection.expires_at !== null ||
        connection.granted_scopes.length ||
        connection.workspace_id !== (key.workspaceId ?? null)
      ) throw new ProviderError("provider_permission_required", 403);
      return key;
    }
    const config = this.config(), session = asChatGPT(raw);
    if (
      connection.subject !== session.subject ||
      session.clientId !== config.clientId ||
      connection.workspace_id !== null ||
      !sameScopes(connection.granted_scopes, session.grantedScopes) ||
      typeof connection.expires_at !== "string" ||
      Date.parse(connection.expires_at) / 1000 !== session.expiresAt
    ) {
      throw new ProviderError("provider_permission_required", 403);
    }
    if (!hasPlan(session)) {
      throw new ProviderError("provider_permission_required", 403);
    }
    return session;
  }
  private async definitiveFailure(
    record: StoredConnection,
    error: unknown,
  ): Promise<void> {
    if (
      error instanceof ProviderError && error.code === "provider_auth_required"
    ) {
      // A versioned invalidation must not mark a replacement connection as stale.
      await this.store.invalidate(record);
    }
  }
  async usableCredential(
    user: string,
    id: string,
  ): Promise<UsableProviderCredential> {
    user = uuid(user);
    id = uuid(id);
    for (let attempt = 0; attempt <= POLL_LIMIT; attempt++) {
      const record = this.checkRecord(
        await this.store.read(user, id),
        user,
        id,
      );
      const credential = await this.resolved(record);
      if (
        credential.provider === "anthropic" ||
        credential.expiresAt > this.now() + REFRESH_MARGIN
      ) {
        return { record, credential };
      }
      if (!credential.refreshToken) {
        await this.store.invalidate(record);
        throw new ProviderError("provider_auth_required", 401);
      }
      const leaseId = uuid(this.leaseId());
      const leased = await this.store.lease(user, id, record.version, leaseId);
      if (!leased) {
        if (attempt === POLL_LIMIT) {
          throw new ProviderError("provider_unavailable", 503);
        }
        await this.wait(POLL_MILLISECONDS);
        continue;
      }
      this.checkRecord(leased, user, id);
      if (
        leased.version !== record.version || leased.lease_id !== leaseId ||
        leased.encrypted_secret !== record.encrypted_secret ||
        typeof leased.lease_until !== "string" ||
        !Number.isFinite(Date.parse(leased.lease_until)) ||
        Date.parse(leased.lease_until) / 1000 <= this.now()
      ) {
        throw new ProviderError("provider_unavailable", 503);
      }
      // Recheck the row returned by the atomic lease; it must still bind the same account and grant.
      const leasedCredential = await this.resolved(leased);
      if (leasedCredential.provider !== "chatgpt") {
        throw new ProviderError("provider_permission_required", 403);
      }
      let refreshed: ChatGPTSession;
      try {
        refreshed = await refreshChatGPTSession(
          this.config(),
          leasedCredential,
          this.fetcher,
          { nowSeconds: this.now() },
        );
      } catch (error) {
        await this.definitiveFailure(leased, error);
        throw error;
      }
      const metadata = metadataForChatGPTSession(
        refreshed,
        leased.connection.label,
      );
      let saved: StoredConnection;
      try {
        saved = await this.store.save(
          user,
          id,
          metadata,
          refreshed,
          leased.version,
          leaseId,
        );
      } catch (error) {
        // A timeout may hide a committed CAS save. Reload once; never replay a rotating refresh token.
        const current = await this.store.read(user, id);
        if (!current || current.version <= leased.version) throw error;
        const checked = this.checkRecord(current, user, id),
          currentCredential = await this.resolved(checked);
        if (
          currentCredential.provider === "chatgpt" &&
          currentCredential.expiresAt > this.now() + REFRESH_MARGIN
        ) {
          return { record: checked, credential: currentCredential };
        }
        throw error;
      }
      if (
        saved.version !== leased.version + 1 || saved.lease_id !== null ||
        saved.lease_until !== null
      ) {
        throw new ProviderError("provider_malformed");
      }
      const checked = this.checkRecord(saved, user, id),
        nextCredential = await this.resolved(checked);
      if (
        nextCredential.provider !== "chatgpt" ||
        nextCredential.expiresAt <= this.now()
      ) {
        throw new ProviderError("provider_auth_required", 401);
      }
      return { record: checked, credential: nextCredential };
    }
    throw new ProviderError("provider_unavailable", 503);
  }
  async listModels(user: string, id: string): Promise<ProviderModel[]> {
    const { record, credential } = await this.usableCredential(user, id);
    try {
      return credential.provider === "anthropic"
        ? await listAnthropicModels(credential, this.fetcher)
        : await listChatGPTModels(credential, this.fetcher);
    } catch (error) {
      await this.definitiveFailure(record, error);
      throw error;
    }
  }
  async *stream(
    user: string,
    id: string,
    input: ProviderChatInput,
  ): AsyncGenerator<ProviderEvent> {
    const { record, credential } = await this.usableCredential(user, id);
    try {
      yield* streamWithCredential(input, credential, this.fetcher);
    } catch (error) {
      await this.definitiveFailure(record, error);
      throw error;
    }
  }
  /** Capture credentials, purge locally first, then attempt bounded remote cleanup. A late refresh cannot resurrect it. */
  async disconnect(
    user: string,
    id: string,
  ): Promise<ProviderDisconnectResult> {
    user = uuid(user);
    id = uuid(id);
    let record: StoredConnection | null = null, readFailed = false;
    try {
      record = await this.store.read(user, id);
    } catch {
      readFailed =
        true; /* Deletion must still be attempted when capturing a remote token fails. */
    }
    let session: ChatGPTSession | undefined;
    if (record?.connection.provider === "chatgpt") {
      try {
        if (record.connection.user_id !== user || record.connection.id !== id) {
          throw new ProviderError("provider_permission_required", 403);
        }
        session = asChatGPT(await this.store.credential(record));
        if (session.subject !== record.connection.subject) session = undefined;
      } catch {
        /* Corrupt/unreadable remote credentials must not prevent local deletion. */
      }
    }
    await this.store.disconnect(user, id);
    if (readFailed) return { revocation: "unconfirmed" };
    if (record?.connection.provider !== "chatgpt") {
      return { revocation: "not_applicable" };
    }
    if (
      !session?.refreshToken || !this.options.chatgptConfig ||
      session.clientId !== this.options.chatgptConfig.clientId
    ) {
      return { revocation: "unconfirmed" };
    }
    const controller = new AbortController();
    const milliseconds = Math.max(
      1,
      Math.min(5000, this.options.revokeTimeoutMs ?? 5000),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetcher: ProviderFetch = (url, options) =>
      this.fetcher(url, {
        ...options,
        signal: options?.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal,
      });
    try {
      const result = await Promise.race([
        revokeChatGPTSession(this.options.chatgptConfig, session, fetcher).then(
          () => true,
          () => false,
        ),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(false);
          }, milliseconds);
        }),
      ]);
      return { revocation: result ? "confirmed" : "unconfirmed" };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
