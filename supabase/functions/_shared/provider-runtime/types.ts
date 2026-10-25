/** Provider-neutral text chat. Upstream IDs are not canonical database message IDs. No credential enters a wire event. */
export type ConnectedProvider = "anthropic" | "chatgpt";
export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type ProviderChatInput = {
  model: string;
  messages: readonly ProviderMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
};
export type ProviderStopReason =
  | "complete"
  | "max_tokens"
  | "tool_use"
  | "refusal";
export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | {
    type: "completed";
    id: string;
    model: string;
    stopReason: ProviderStopReason;
  };
export type ProviderModel = { id: string; name: string };
export type AnthropicCredential = {
  provider: "anthropic";
  apiKey: string;
  workspaceId?: string;
};
export type ChatGPTCredential = {
  provider: "chatgpt";
  accessToken: string;
  grantedScopes: readonly string[];
  expiresAt: number;
  subject: string;
  clientId: string;
};
export type ProviderCredential = AnthropicCredential | ChatGPTCredential;
export type ProviderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderErrorCode =
  | "provider_configuration_required"
  | "provider_api_key_invalid"
  | "provider_workspace_invalid"
  | "provider_workspace_required"
  | "provider_access_pending"
  | "provider_auth_required"
  | "provider_permission_required"
  | "provider_credits_required"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_invalid_request"
  | "provider_malformed"
  | "provider_interrupted"
  | "provider_unsupported"
  | "provider_too_large";
const sentences: Record<ProviderErrorCode, string> = {
  provider_configuration_required:
    "This provider connection needs configuration.",
  provider_api_key_invalid:
    "Enter the full Anthropic Console secret key (sk-ant-api… or sk-ant-usr…), not its name or ID.",
  provider_workspace_invalid:
    "Enter the workspace ID beginning wrkspc_, not another API key.",
  provider_workspace_required:
    "This Claude key needs a workspace ID. Find it in Claude Console Settings → Workspaces.",
  provider_access_pending:
    "ChatGPT plan access is awaiting provider approval for this hosted app.",
  provider_auth_required: "Reconnect this provider account to continue.",
  provider_permission_required:
    "This connection has not authorized the requested model usage.",
  provider_credits_required:
    "This provider account needs available API credits.",
  provider_rate_limited: "This provider's usage limit has been reached.",
  provider_unavailable: "The provider is temporarily unavailable.",
  provider_invalid_request: "The provider could not accept this request.",
  provider_malformed:
    "The provider returned a response this app could not read.",
  provider_interrupted:
    "The answer was interrupted. Refresh history before retrying.",
  provider_unsupported:
    "This provider response requires a capability that is not available here yet.",
  provider_too_large: "This provider request or response is too large.",
};
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly status = 502,
  ) {
    super(sentences[code]);
    this.name = "ProviderError";
  }
}
