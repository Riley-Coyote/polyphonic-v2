import {
  type ChatGPTHostedConfig,
  validateChatGPTHostedConfig,
} from "./chatgpt-oauth.ts";
import { ProviderError } from "./types.ts";

export type ProviderConfiguration = {
  chatgpt: ChatGPTHostedConfig;
  oauthStart: string;
  settingsURL: string;
  chatgptAvailable: boolean;
};
export function providerConfiguration(
  env: (name: string) => string | undefined,
): ProviderConfiguration {
  const base = new URL(env("SUPABASE_URL") || "https://unconfigured.invalid");
  const callback = new URL("/functions/v1/provider-oauth/callback", base).href;
  const configuredCallback = env("PROVIDER_OAUTH_REDIRECT_URI") || callback;
  // The callback handler and token exchange must use exactly the same deployment-owned URL.
  if (configuredCallback !== callback || base.protocol !== "https:") {
    throw new ProviderError("provider_configuration_required", 503);
  }
  const settings = new URL(
    env("PROVIDER_SETTINGS_URL") || "https://polyphonic.chat/settings/models",
  );
  if (
    settings.username || settings.password || settings.search ||
    settings.hash ||
    !(settings.origin === "https://polyphonic.chat" ||
      settings.origin === "https://www.polyphonic.chat" ||
      ((env("DENO_ENV") ?? env("ENVIRONMENT") ?? "").toLowerCase() !==
          "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(settings.origin)))
  ) {
    throw new ProviderError("provider_configuration_required", 503);
  }
  const chatgpt: ChatGPTHostedConfig = {
    approved: env("PROVIDER_CHATGPT_HOSTED_APPROVED") === "true",
    planUsageApproved: env("PROVIDER_CHATGPT_PLAN_USAGE_APPROVED") === "true",
    clientId: env("PROVIDER_CHATGPT_CLIENT_ID") || "",
    redirectUri: callback,
    tokenEndpointAuthMethod: env(
      "PROVIDER_CHATGPT_CLIENT_AUTH_METHOD",
    ) as ChatGPTHostedConfig["tokenEndpointAuthMethod"],
    ...(env("PROVIDER_CHATGPT_CLIENT_SECRET")
      ? { clientSecret: env("PROVIDER_CHATGPT_CLIENT_SECRET") }
      : {}),
  };
  let chatgptAvailable = false;
  try {
    validateChatGPTHostedConfig(chatgpt);
    chatgptAvailable = true;
  } catch {
    /* Availability remains closed until the entire registration is configured. */
  }
  return {
    chatgpt,
    oauthStart: new URL("/functions/v1/provider-oauth/start", base).href,
    settingsURL: settings.href,
    chatgptAvailable,
  };
}
