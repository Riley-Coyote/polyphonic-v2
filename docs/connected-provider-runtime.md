# Connected model providers

This change adds two desktop-independent cloud paths to Polyphonic web and Ghost mobile:

- **ChatGPT plan:** an approved hosted Sign in with ChatGPT registration, followed by the user's explicit plan-inference grants.
- **Claude:** a direct Anthropic Console API key, optional workspace ID, and available API credits. A Claude subscription login is not an API key.

Neither path requires a running desktop. They retain the selected Polyphonic resident and load its existing cloud identity, conversation, project and readable continuity context. This first version supports text chat. Desktop tools, attachments, council, Observer, autonomous writes and other background model calls are unavailable on these connections.

## Implementation

`provider-connections` verifies the Supabase user before listing safe profile metadata, validating an Anthropic key with model discovery, starting/finalizing ChatGPT OAuth, discovering authorized models, creating a bound conversation, or disconnecting. Responses never include provider credentials, refresh tokens, private identity details or ciphertext. `list` includes an account-scoped `thread_bindings` map so mobile can probe the new service without changing its legacy thread SELECT.

`provider-oauth` uses authorization code + PKCE, state, nonce, signed OIDC validation and a secure HttpOnly browser-binding cookie. A one-use top-level start ticket avoids relying on third-party cookies. The callback stores an encrypted five-minute completion transaction; it does **not** attach credentials. The original authenticated Polyphonic account must finalize the fragment-only completion ticket. Reconnect must retain the verified provider subject. New pending records and credential versions fence a disconnect that happens during authorization or key validation.

`provider-chat` uses the canonical saved user-message UUID as its dispatch identity. It validates the owned thread, immutable connection, selected model, current provider grant and text-only context before atomically claiming one upstream request. It emits `content`/`done`/`error` SSE compatible with Ghost. The assistant UUID is reserved before dispatch, persisted before `done`, and distinct from the opaque upstream response ID. Repeated requests recover that row; an interrupted or uncertain request never automatically starts another paid request. A new explicit user message can continue after an unknown turn. Usage never falls back to another provider.

The additive migration stores metadata in an owner-readable table and ciphertext in a private service-only table. AES-256-GCM authenticates each secret's owner, connection and purpose. A deployment secret supplies the encryption key. Durable 45-second refresh leases and version checks coordinate rotating OAuth refresh tokens across function instances. Disconnect purges locally before bounded remote revocation. Legacy chat routes reject bound conversations before making a model request.

## Deployment configuration

Prepare and deploy the complete change together. This work has not changed production schema, secrets, function deployments or the published website.

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

Official contracts: [hosted ChatGPT sign-in](https://developers.openai.com/siwc/website), [hosted client access](https://developers.openai.com/siwc/request-client-id), [plan inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication).
