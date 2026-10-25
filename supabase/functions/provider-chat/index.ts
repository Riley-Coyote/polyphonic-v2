import { listAnthropicModels } from "../_shared/provider-runtime/anthropic.ts";
import {
  streamWithCredential,
  type UsableProviderCredential,
} from "../_shared/provider-runtime/broker.ts";
import { listChatGPTModels } from "../_shared/provider-runtime/chatgpt.ts";
import { providerChat } from "../_shared/provider-runtime/chat-handler.ts";
import { SupabaseProviderChatRepository } from "../_shared/provider-runtime/chat-repository.ts";
import {
  authenticate,
  cors,
  providerServices,
} from "../_shared/provider-runtime/edge.ts";
import { failure, requestJSON } from "../_shared/provider-runtime/http.ts";
import { ProviderError } from "../_shared/provider-runtime/types.ts";

Deno.serve(async (request) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response(null, { headers });
  try {
    if (request.method !== "POST") {
      throw new ProviderError("provider_invalid_request", 405);
    }
    const user = await authenticate(request);
    const { db, broker, store } = await providerServices();
    const invalidate = async (
      error: unknown,
      usable: UsableProviderCredential,
    ) => {
      if (
        error instanceof ProviderError &&
        error.code === "provider_auth_required"
      ) await store.invalidate(usable.record).catch(() => undefined);
    };
    return await providerChat(request, await requestJSON(request), user, {
      repository: new SupabaseProviderChatRepository(db),
      credential: (user, connection) =>
        broker.usableCredential(user, connection),
      async models(usable) {
        try {
          return await (usable.credential.provider === "anthropic"
            ? listAnthropicModels(usable.credential)
            : listChatGPTModels(usable.credential));
        } catch (error) {
          await invalidate(error, usable);
          throw error;
        }
      },
      async *stream(input, usable) {
        try {
          yield* streamWithCredential(input, usable.credential);
        } catch (error) {
          await invalidate(error, usable);
          throw error;
        }
      },
    }, headers);
  } catch (error) {
    return failure(error, headers);
  }
});
