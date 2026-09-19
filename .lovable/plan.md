# Fix Luca image prompt routing

## What is happening
Image requests are deliberately excluded from Lucas newer agent runtime. They fall into an older shortcut that sends your raw message straight to image generation, so Luca never gets to write the visual prompt they describe in the conversation.

## Changes
- Turn the extended abilities on for everyone and remove the per-account allowlist, so there is one code path instead of two.
- Let image requests run through the newer runtime, where Luca writes the actual image prompt.
- Keep the older shortcut only as the fallback for accounts whose runtime cannot offer image tools at all.
- Add regression coverage for the new routing, then deploy only the chat function and verify a real image request.

## Technical detail
- Remove the allowlist branch from the extended-tools gate and default it on.
- Narrow the image-request exclusion in chat-multi so it no longer blocks the agent runtime.
- No change to the image provider, image functions, frontend, or database.
