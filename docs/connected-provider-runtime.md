# Connected model providers

This change adds two desktop-independent cloud paths to Polyphonic web and Ghost mobile:

- **ChatGPT plan:** an approved hosted Sign in with ChatGPT registration, followed by the user's explicit plan-inference grants.
- **Claude:** a direct Anthropic Console API key, optional workspace ID, and available API credits. A Claude subscription login is not an API key.

Neither path requires a running desktop. They retain the selected Polyphonic resident and load its existing cloud identity, conversation, project and readable continuity context. This first version supports text chat. Desktop tools, attachments, council, Observer, autonomous writes and other background model calls are unavailable on these connections.

Launch direction, 2026-10-24: publish the direct Anthropic API path first so users with their own API credits can test cloud chat while the desktop is unavailable. Basic Polyphonic access is currently free; paid cloud services may follow. Free access does not change the documented remotely hosted ChatGPT integration requirement, so the hosted ChatGPT option remains unavailable until its registration and plan usage permissions are provisioned. Platform-funded usage and billing are outside this release.

## Implementation

`provider-connections` verifies the Supabase user before listing safe profile metadata, validating an Anthropic key with model discovery, starting/finalizing ChatGPT OAuth, discovering authorized models, creating a bound conversation, or disconnecting. Responses never include provider credentials, refresh tokens, private identity details or ciphertext. `list` includes an account-scoped `thread_bindings` map so mobile can probe the new service without changing its legacy thread SELECT.

Claude setup accepts both `sk-ant-api…` and personal `sk-ant-usr…` Console secrets; it rejects Claude subscription tokens. The earlier `sk-ant-api`-only check rejected a real Console key format before contacting Anthropic. Key input errors, invalid workspace IDs and missing workspace selection now have distinct safe messages instead of sharing the server-configuration error. A key that is not scoped to one workspace needs its `wrkspc_…` ID in the separate workspace field, as described in [Anthropic's workspace selection documentation](https://platform.claude.com/docs/en/manage-claude/authentication#select-a-workspace).

`provider-oauth` uses authorization code + PKCE, state, nonce, signed OIDC validation and a secure HttpOnly browser-binding cookie. A one-use top-level start ticket avoids relying on third-party cookies. The callback stores an encrypted five-minute completion transaction; it does **not** attach credentials. The original authenticated Polyphonic account must finalize the fragment-only completion ticket. Reconnect must retain the verified provider subject. New pending records and credential versions fence a disconnect that happens during authorization or key validation.

`provider-chat` uses the canonical saved user-message UUID as its dispatch identity. It validates the owned thread, immutable connection, selected model, current provider grant and text-only context before atomically claiming one upstream request. It emits `content`/`done`/`error` SSE compatible with Ghost. The assistant UUID is reserved before dispatch, persisted before `done`, and distinct from the opaque upstream response ID. Repeated requests recover that row; an interrupted or uncertain request never automatically starts another paid request. A new explicit user message can continue after an unknown turn. Usage never falls back to another provider.

The additive migration stores metadata in an owner-readable table and ciphertext in a private service-only table. AES-256-GCM authenticates each secret's owner, connection and purpose. A deployment secret supplies the encryption key. Durable 45-second refresh leases and version checks coordinate rotating OAuth refresh tokens across function instances. Disconnect purges locally before bounded remote revocation. Legacy chat routes reject bound conversations before making a model request.

Owner references use the existing `public.profiles(user_id)` unique key. Its existing managed-account cascade retains account deletion behavior without adding a trigger or foreign key directly against the managed authentication table. A `BEFORE DELETE` profile trigger removes bound conversations before credentials cascade, including on older installations without a thread-owner foreign key. The SQL harness keeps profile IDs distinct from account IDs and verifies both profile deletion and account deletion.

## Deployment configuration

Prepare and deploy the complete change together. Record the applied migration, deployed functions and published URL separately from local verification.

1. Deploy the updated legacy `chat` and `chat-multi` guards. Their `SELECT *` is compatible with the existing schema.
2. Apply `supabase/migrations/20261024200000_connected_model_providers.sql` to the project's cloud PostgreSQL database. Regenerate database types after applying if needed; application code uses an explicit provider DTO boundary.
3. Configure `PROVIDER_CREDENTIAL_ENCRYPTION_KEY` with a newly generated base64 32-byte random value in the cloud function secret manager. Keep a secure backup. Changing it without re-encryption makes existing credentials unreadable. Never put the value in git, a frontend environment variable, a URL or a chat.
4. Deploy `provider-connections`, `provider-oauth`, and `provider-chat`, with the shared modules and the checked-in gateway JWT settings. Protected routes perform fresh `auth.getUser()` verification themselves; the OAuth redirect is public and validates the one-use browser-bound transaction.
5. Publish the tested web commit and install the corresponding signed Ghost runtime build. Configure new accounts through Settings → Models on web or the mobile cloud connection form.

The standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are server-side deployment values. Only the usual publishable client key belongs in browser/native client configuration.

ChatGPT additionally requires values provisioned for an **approved hosted registration**:

| Secret or setting | Required value |
| --- | --- |
| `PROVIDER_CHATGPT_HOSTED_APPROVED` | `true` only after hosted registration approval |
| `PROVIDER_CHATGPT_PLAN_USAGE_APPROVED` | `true` only after hosted plan-inference approval |
| `PROVIDER_CHATGPT_CLIENT_ID` | The approved static client ID |
| `PROVIDER_CHATGPT_CLIENT_AUTH_METHOD` | Exactly `none` or `client_secret_basic`, as provisioned |
| `PROVIDER_CHATGPT_CLIENT_SECRET` | Only for a provisioned `client_secret_basic` client |
| `PROVIDER_OAUTH_REDIRECT_URI` | If set, must exactly match the deployment's callback below |
| `PROVIDER_SETTINGS_URL` | Defaults to `https://polyphonic.chat/settings/models`; fixed allowed origin, no caller-controlled return URL |

Registered callback for this Supabase project:

```text
https://kknchdnrujzheulqzowv.supabase.co/functions/v1/provider-oauth/callback
```

The granted token must include both `resource.invoke` and `chatgpt.tokens.use.direct`. Identity-only sign-in is stored as `identity_only` and cannot infer. Missing approval/configuration keeps the ChatGPT button unavailable. OSS dynamic registration, Codex credentials, browser cookies and copied subscription tokens are not hosted registration substitutes.

## Verification and live acceptance

Fixture checks use no real credentials or paid requests:

```sh
deno test --no-config --node-modules-dir=none --no-lock supabase/functions/_shared/provider-runtime/
deno check --no-config --node-modules-dir=none --no-lock supabase/functions/provider-connections/index.ts supabase/functions/provider-oauth/index.ts supabase/functions/provider-chat/index.ts
npm exec --yes --package=@electric-sql/pglite@0.3.14 -- node scripts/test-provider-schema.mjs
npm exec tsc -- --noEmit -p tsconfig.app.json
npm run build
```

The SQL harness checks owner boundaries, grants, credential CAS, one-use OAuth, disconnect fencing, reserved canonical replies and account deletion against the actual migration. PGlite has one backend; production PostgreSQL cross-session lock scheduling is still a deployment acceptance check.

The isolated UI lab is `lab/provider-connections/`, served by the local Vite preview at `/lab/provider-connections/`. It imports the production panel with a simulated client and never contacts a model provider. Its test key is `fixture-key`. Saved visual variations stay in the local browser; the lab is excluded from the production Vite entry.

After deployment, use the actual web/native settings to enter credentials. Test a new conversation for each provider, reload its history, interrupt a turn and recover it, disconnect and confirm that new requests stop, then use mobile with the desktop bridge unavailable. Record real replies separately from fixture success. ChatGPT live acceptance additionally waits for provider approval and user consent; Anthropic acceptance needs a valid API key/workspace and available credits.

### Recorded local verification, 2026-10-24

- Provider runtime: **96 Deno fixtures pass**, with no network permission. New Edge Function typechecks, Deno lint and formatting checks pass.
- Migration: **18 schema regression tests pass** in pinned PGlite, including distinct profile/account IDs, missing-profile rejection, profile and account deletion cascades, older ownerless-thread behavior, OAuth ownership, credential refresh/disconnect races and recovery of persisted replies. True cross-session PostgreSQL lock scheduling remains a deployment check.
- Web: TypeScript and production build pass. The full suite reports **728 passed / 4 failed**; the same four failures were reproduced on untouched main `39e36b5` (account portability source assertion, email-webhook CORS source gate, OpenRouter workspace-file source gate and implicit export-worker authentication markers). New provider tests pass.
- Production web components were exercised in an isolated, fully intercepted browser: account setup, model selection, new bound conversation, canonical response, interrupted reply recovery, key/model/list failures and disconnect. Three chat HTTP requests represented two unique claimed user messages, with zero legacy chat/Observer calls. Desktop width/scroll width were 1440/1440; mobile 388/388; provider controls measured 44px high. No page errors or warnings occurred. Deliberately rejected fixture requests produced expected resource errors.
- The isolated lab's actual preset sizing, key masking, simulated setup, save/restore after reload, copy/fallback and JSON export were exercised. Its fixtures are absent from the production web bundle.
- The Ghost runtime's 232 existing XCTest unit tests and 12 new provider fixtures pass on a signed isolated iPhone simulator. Native UI and release evidence are recorded with the separate Ghost runtime change.
- After preserving the newer upstream preview-auth storage and generated type changes in `ea8622e`, TypeScript, production build and 26 focused provider/chat/onboarding tests pass. The actual provider panel was inspected again with no console errors. The credential encryption secret was provisioned through the cloud secret manager using its native 43-character generator; the value was never returned to chat or source. The existing decoder accepts this unpadded base64 form as a 32-byte AES-GCM key.

These checks establish local implementation behavior; a successful real provider reply remains a separate acceptance step. The hosted ChatGPT access request has no confirmed submission or approval. The web branch is `codex/cloud-provider-connections`; the native runtime branch is `codex/ghost-mobile-completion` in `prompt-ghost`, separate from Claude's navigation branch.

### Production rollout — October 24, 2026

- Migration `20261024200000` is applied and registered as `connected_model_providers` in the existing cloud migration history, with the exact tested SQL retained in `statements`. Treat this deployed migration as immutable; future schema changes need a new migration. The public metadata table, three private tables and thread binding column are verified present.
- `chat` and `chat-multi` guards and all three new provider functions are deployed. Independent requests to both protected provider endpoints returned `401`; browser preflight returned `200` with the correct `https://polyphonic.chat` origin. Live metadata confirms owner RLS, read-only authenticated metadata access, no client access to the private schema, and server-only execution of all three credential/OAuth/turn RPCs.
- The web release was published through Lovable deployment `0b6a5ba0-2413-437f-9889-03d3655c6bbb` from source `be7af8d0d4a9452e13dd1493ca9060a340f75125`. The signed-in production page at `https://polyphonic.chat/settings/models` renders the enabled Anthropic key form and the unavailable hosted ChatGPT state. The final typecheck and production build pass. The npm lockfile matches the generated migration-tool dependencies; clean-install validation passes without replacing the running dependencies.
- The signed Ghost Release build compiled from native runtime commit `cb5fdc8f`, passed full signing verification, contains no provider fixture markers, and was installed and opened on the connected test iPhone. The signed-in iPhone simulator was updated as well. Neither install resets application data or Keychain storage.
- Real provider inference and desktop-disconnected response/history acceptance are pending the user's private API-key setup in the live app. No real key was collected in chat. The direct credential-get diagnostic was not performed; a credential-free lock probe was inconclusive through this connector, so full cross-session stress remains unverified.

### Live Claude acceptance — October 25, 2026

The user privately connected a personal Console API key after the `sk-ant-usr` validation correction in web source `6f308f1`. Live model discovery succeeded. A new Luca conversation bound to that account and `claude-haiku-4-5-20251001` returned the requested real response, `cloud test OK`.

The saved conversation is [Cloud connection check](https://polyphonic.chat/chat/f212c496-7a2e-4123-9cb3-21c116004b7f). Its reply survived a full page reload. Cloud metadata independently confirms two saved messages and one finished provider turn, with a persisted reserved assistant ID; reopening did not create a second generation. No app console errors were observed; the installed browser extension separately reported an invalidated extension context. No key, token, credential ciphertext or request authorization header was inspected.

This verifies hosted Claude inference and durable web history through `provider-chat`. The physical iPhone send/receive check, including cellular use when available, is awaiting the user's result. Hosted ChatGPT remains gated pending registration and plan-inference access.

Official contracts: [hosted ChatGPT sign-in](https://developers.openai.com/siwc/website), [hosted client access](https://developers.openai.com/siwc/request-client-id), [plan inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication).
