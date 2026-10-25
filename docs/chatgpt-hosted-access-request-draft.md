# Draft: Polyphonic hosted Sign in with ChatGPT access

Status: prepared with Riley's launch direction and confirmed contact details in the official browser form. Submission was attempted on 2026-10-24, but no confirmation returned and the page logged Cloudflare verification errors. The prefilled form remains open for completion; submission is not confirmed.

**Application:** Polyphonic / Ghost mobile companion.

**Official request:** https://openai.com/form/sign-in-with-chatgpt-interest/

**Public website:** https://polyphonic.chat

**Business model:** Basic access to Polyphonic is currently free. We plan to offer paid cloud services in the future. The initial cloud launch lets users explicitly connect their own provider API credentials; approved ChatGPT plan usage would be an additional user-selected funding option. We are requesting the hosted integration path rather than assuming free access qualifies for the local open-source flow.

**Product:** A user-owned AI conversation platform with cloud residents, persistent conversation history and optional desktop runtimes. Users explicitly choose a connected account and model for each new cloud conversation. Ghost mobile can chat through the same cloud account while the user's desktop is unavailable.

**Requested access:** A hosted commercial Sign in with ChatGPT client and permission for consenting users to fund supported inference with their ChatGPT plans. Identity-only OIDC access does not fulfill this use case. Please confirm the approved scopes, plan eligibility, supported API operations and hosted/remote execution conditions for both the web client and native companion using our server-side broker.

**Requested OAuth flow:** Authorization code with PKCE S256, state, nonce, backend token exchange and verified OIDC signatures/issuer/audience/expiration. Please provision the exact token-endpoint authentication method (`none` or `client_secret_basic`) and a static client ID. We will use only the issued method and approved scopes.

**Callback:**

```text
https://kknchdnrujzheulqzowv.supabase.co/functions/v1/provider-oauth/callback
```

**Requested scope review:** `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, subject to the permissions granted to this hosted registration and each consenting user.

**Inference:** Model discovery and streamed text Responses with `store:false`; full bounded conversation context is supplied explicitly. We do not silently switch funding sources when usage runs out. The first release does not offer desktop tools, file inputs or background tasks through this connection.

**Credential handling implemented for review:** Provider tokens stay in an encrypted server vault with per-user/connection authenticated encryption. The browser/native client receives safe metadata only. Final linking requires the same authenticated Polyphonic account that initiated the flow. One-use state and browser binding prevent callback replay. Version checks and durable refresh leases coordinate rotating refresh tokens. Disconnect removes local credentials before best-effort provider revocation.

**Privacy:** https://polyphonic.chat/privacy

**Terms:** https://polyphonic.chat/terms

Riley confirmed the application contact and name for the official form; the contact email is kept out of this source document. Service/data-retention commitments must match the published policies. No provider approval, plan eligibility or access is implied by this request.
