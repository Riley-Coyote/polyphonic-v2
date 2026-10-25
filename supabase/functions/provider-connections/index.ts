import { connectionAction } from "../_shared/provider-runtime/connections.ts";
import {
  createConnectedThread,
  listConnections,
  threadBindings,
} from "../_shared/provider-runtime/database.ts";
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
    const services = await providerServices();
    const result = await connectionAction(await requestJSON(request), user, {
      ...services,
      list: (user) => listConnections(services.db, user),
      createThread: (user, connection, model, agent, thread) =>
        createConnectedThread(
          services.db,
          user,
          connection,
          model,
          agent,
          thread,
        ),
      threadBindings: (user) => threadBindings(services.db, user),
    });
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error, headers);
  }
});
