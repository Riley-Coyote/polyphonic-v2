import { type ConnectedProvider, ProviderError } from "./types.ts";

export type ProviderConnection = {
  id: string;
  user_id: string;
  provider: ConnectedProvider;
  label: string;
  subject: string | null;
  workspace_id: string | null;
  status: "connected" | "identity_only" | "needs_reconnect" | "disabled";
  granted_scopes: string[];
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ConnectionMetadata = Pick<
  ProviderConnection,
  | "provider"
  | "label"
  | "subject"
  | "workspace_id"
  | "status"
  | "granted_scopes"
  | "expires_at"
>;
export type StoredConnection = {
  connection: ProviderConnection;
  encrypted_secret: string | null;
  version: number;
  lease_id: string | null;
  lease_until: string | null;
};
export type ProviderDatabase = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) throw new ProviderError("provider_invalid_request", 400);
  return value.toLowerCase();
}
export function safeLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() && value.length <= 120
    ? value.trim()
    : fallback;
}
function base64(data: Uint8Array): string {
  let out = "";
  for (const byte of data) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_+/=-]+$/.test(value) || value.length > 131072) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  const text = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(text), (x) => x.charCodeAt(0));
  } catch {
    throw new ProviderError("provider_configuration_required", 503);
  }
}
export const randomOpaque = () =>
  base64(crypto.getRandomValues(new Uint8Array(32)));
export async function hashOpaque(value: string): Promise<string> {
  return base64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

/** Only ciphertext crosses the private credential RPC; AAD binds it to its owner, record and purpose. */
export class ProviderCipher {
  private constructor(private readonly key: CryptoKey) {}
  static async create(encoded: string): Promise<ProviderCipher> {
    const bytes = unbase64(encoded);
    if (bytes.length !== 32) {
      throw new ProviderError("provider_configuration_required", 503);
    }
    return new ProviderCipher(
      await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]),
    );
  }
  async seal(
    value: unknown,
    user: string,
    id: string,
    purpose = "credential",
  ): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > 60000) {
      throw new ProviderError("provider_too_large", 413);
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(
      `polyphonic-provider:v1:${purpose}:${user}:${id}`,
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      this.key,
      bytes,
    );
    return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
  }
  async open(
    value: string,
    user: string,
    id: string,
    purpose = "credential",
  ): Promise<unknown> {
    try {
      const parts = value.split(".");
      if (parts.length !== 3 || parts[0] !== "v1") throw new Error();
      const iv = unbase64(parts[1]);
      if (iv.length !== 12) throw new Error();
      const additionalData = new TextEncoder().encode(
        `polyphonic-provider:v1:${purpose}:${user}:${id}`,
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData },
        this.key,
        unbase64(parts[2]),
      );
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(decrypted),
      );
    } catch {
      throw new ProviderError("provider_configuration_required", 503);
    }
  }
}

export class ProviderStore {
  constructor(readonly db: ProviderDatabase, readonly cipher: ProviderCipher) {}
  async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.db.rpc(name, args);
    if (result.error) throw new ProviderError("provider_unavailable", 503);
    return result.data;
  }
  private record(
    value: unknown,
    user: string,
    id: string,
  ): StoredConnection | null {
    if (value === null) return null;
    if (!isObject(value) || !isObject(value.connection)) {
      throw new ProviderError("provider_malformed");
    }
    const c = value.connection;
    if (
      c.id !== id || c.user_id !== user ||
      !["anthropic", "chatgpt"].includes(String(c.provider)) ||
      !["connected", "identity_only", "needs_reconnect", "disabled"].includes(
        String(c.status),
      ) ||
      !Number.isSafeInteger(value.version) || Number(value.version) < 1 ||
      !(value.encrypted_secret === null ||
        typeof value.encrypted_secret === "string") ||
      !Array.isArray(c.granted_scopes) ||
      !c.granted_scopes.every((x) => typeof x === "string")
    ) throw new ProviderError("provider_permission_required", 403);
    return value as unknown as StoredConnection;
  }
  async read(user: string, id: string): Promise<StoredConnection | null> {
    user = uuid(user);
    id = uuid(id);
    return this.record(
      await this.rpc("provider_secret", {
        p_action: "get",
        p_user: user,
        p_id: id,
      }),
      user,
      id,
    );
  }
  async credential(record: StoredConnection): Promise<unknown> {
    if (!record.encrypted_secret || record.connection.status === "disabled") {
      throw new ProviderError("provider_auth_required", 401);
    }
    return await this.cipher.open(
      record.encrypted_secret,
      record.connection.user_id,
      record.connection.id,
    );
  }
  async save(
    user: string,
    id: string,
    metadata: ConnectionMetadata,
    secret: unknown,
    version = 0,
    lease?: string,
  ): Promise<StoredConnection> {
    user = uuid(user);
    id = uuid(id);
    const encrypted = await this.cipher.seal(secret, user, id);
    const row = await this.rpc("provider_secret", {
      p_action: "save",
      p_user: uuid(user),
      p_id: uuid(id),
      p_metadata: metadata,
      p_secret: encrypted,
      p_version: version,
      p_lease: lease ?? null,
    });
    const saved = this.record(row, user, id);
    if (!saved) throw new ProviderError("provider_unavailable", 503);
    return saved;
  }
  async lease(
    user: string,
    id: string,
    version: number,
    lease: string,
  ): Promise<StoredConnection | null> {
    user = uuid(user);
    id = uuid(id);
    return this.record(
      await this.rpc("provider_secret", {
        p_action: "lease",
        p_user: uuid(user),
        p_id: uuid(id),
        p_version: version,
        p_lease: uuid(lease),
      }),
      user,
      id,
    );
  }
  async disconnect(user: string, id: string): Promise<void> {
    await this.rpc("provider_secret", {
      p_action: "disconnect",
      p_user: uuid(user),
      p_id: uuid(id),
    });
  }
  async invalidate(record: StoredConnection): Promise<void> {
    await this.rpc("provider_secret", {
      p_action: "invalidate",
      p_user: record.connection.user_id,
      p_id: record.connection.id,
      p_version: record.version,
    });
  }
  async createOAuth(
    user: string,
    state: string,
    ticket: string,
    payload: unknown,
    expires: number,
  ): Promise<void> {
    user = uuid(user);
    const stateHash = await hashOpaque(state);
    const encrypted = await this.cipher.seal(payload, user, stateHash, "oauth");
    await this.rpc("provider_oauth_state", {
      p_action: "create",
      p_user: uuid(user),
      p_state_hash: stateHash,
      p_ticket_hash: await hashOpaque(ticket),
      p_payload: encrypted,
      p_expires: new Date(expires * 1000).toISOString(),
    });
  }
  async oauth(
    action: "bind" | "consume",
    value: string,
    binding: string,
  ): Promise<{ user: string; payload: unknown } | null> {
    const row = await this.rpc("provider_oauth_state", {
      p_action: action,
      ...(action === "bind"
        ? { p_ticket_hash: await hashOpaque(value) }
        : { p_state_hash: await hashOpaque(value) }),
      p_binding_hash: await hashOpaque(binding),
    });
    if (row === null) return null;
    if (
      !isObject(row) || typeof row.state_hash !== "string" ||
      typeof row.encrypted_payload !== "string"
    ) throw new ProviderError("provider_malformed");
    const user = uuid(row.user_id);
    return {
      user,
      payload: await this.cipher.open(
        row.encrypted_payload,
        user,
        row.state_hash,
        "oauth",
      ),
    };
  }
  async completeOAuth(user: string, ticket: string): Promise<unknown | null> {
    user = uuid(user);
    const row = await this.rpc("provider_oauth_state", {
      p_action: "finish",
      p_user: user,
      p_ticket_hash: await hashOpaque(ticket),
    });
    if (row === null) return null;
    if (
      !isObject(row) || row.user_id !== user ||
      typeof row.state_hash !== "string" ||
      typeof row.encrypted_payload !== "string"
    ) throw new ProviderError("provider_permission_required", 403);
    return await this.cipher.open(
      row.encrypted_payload,
      user,
      row.state_hash,
      "oauth",
    );
  }
}
