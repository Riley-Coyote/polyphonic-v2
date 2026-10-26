# Cloud intelligence connections

Polyphonic account identity, agent identity, the model connection and platform billing are separate concerns.

## Shipping behavior

- A Polyphonic account owns its cloud agents, conversation history and saved settings. New accounts receive Luca and Observer automatically; no custom-agent setup is needed to begin.
- Settings → Models offers OpenRouter first: authorize an OpenRouter account, optionally paste an existing key, select a default cloud model, then open a Luca conversation. Existing agents remain available through the chat roster and Ghost's cloud resident selector.
- OpenRouter authorization uses PKCE S256 and a per-attempt state. The browser holds the verifier and resulting key only in memory. Origin/source/state checks protect callback messages; an isolated same-origin channel handles identity providers that sever the popup opener. Cancellation, unmount, account changes and timeouts end the flow.
- Both authorization and manual entry save through the existing `save_user_api_key` encrypted vault RPC. Every client operation captures the original Polyphonic user's bearer token; credentials cannot be saved into a newly selected account. Only the masked preview is readable by the client.
- `user_settings.default_model` is the default for new OpenRouter chats and Ghost's unbound account-default cloud route. A new web chat created here captures the selected model. Existing provider-bound threads retain their original connection.
- Ordinary cloud chat requires the user's OpenRouter key before attachment derivatives or model requests. Authentication, credit and rate failures stop subsequent dispatch/retry stages and return safe actionable errors. They never change model funding to a Polyphonic key. The separate, explicitly funded app-help Guide keeps its existing behavior.
- Anthropic Console API connections remain available alongside OpenRouter. Hosted ChatGPT plan usage remains gated on the required provider registration/access. A ChatGPT or Claude consumer subscription is not an interchangeable API credential.
- Disconnecting OpenRouter removes Polyphonic's stored key. To revoke an issued key at OpenRouter itself, use OpenRouter's account settings. Deleting the connection does not delete conversation history.

## Desktop independence

Cloud resident chat runs through Polyphonic's hosted runtime and the user's chosen connection. The desktop can be off, or on another network. Cloud resident continuity is not a promise that the cloud can run the desktop's private CLI agents, access its files or use its tools. Remote desktop capabilities need an authenticated outbound bridge/relay and a reachable desktop, with explicit tool permissions. Do not upload private local agents or transcripts as a side effect of connecting a model account.

## Subscription tiers later

Platform plans should govern storage, sync, retention, hosted features and service limits. Intelligence funding remains a separate choice: user-funded connection, a local model while reachable, or an explicitly offered Polyphonic-funded allowance in the future.

The existing `accessTier` / backend `BillingTier` mix BYOK presence with feature entitlement; they are legacy access helpers, not a completed subscription billing system. Daily message counters provide abuse limits, not dollar budgets. Before selling included inference, add an explicit funded allowance, usage ledger and reconciliation, budget reservation/enforcement, cancellation/refund policy and per-account spend limits. Never automatically fall back from an exhausted user account to a paid platform route.

No subscription checkout, plan price, platform OpenRouter funding account or new credential store is introduced by this change.

## Verification boundaries

Fixture tests cover account-scoped storage, OAuth state/PKCE/cancellation, missing keys, HTTP/SSE/SDK account failures and retry boundaries. The design lab uses injected clients and never connects real providers. A live end-to-end OpenRouter check still requires a user-authorized OpenRouter connection and an explicitly chosen model with available account credits/limits; fixture success does not claim that live check occurred.
