import { cors, providerServices } from "../_shared/provider-runtime/edge.ts";
import { failure } from "../_shared/provider-runtime/http.ts";
import { oauthHandler } from "../_shared/provider-runtime/oauth-handler.ts";

Deno.serve(async (request) => {
  const headers = {
    ...cors(request),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers });
  try {
    const response = await oauthHandler(request, await providerServices());
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  } catch (error) {
    return failure(error, headers);
  }
});
