# Fix Luca image prompt routing

## What is happening
Image requests are deliberately excluded from Luca’s newer agent runtime. They fall into an older deterministic shortcut that sends the latest user message directly to image generation, so Luca never gets the chance to author the visual prompt shown in the conversation.

## Changes
- Route image requests through the newer agent runtime when extended tools are enabled for that user.
- Keep the existing deterministic shortcut unchanged for users who do not have the extended image tools.
- Add regression coverage proving allowlisted requests use Luca’s `generate_image` tool while non-allowlisted requests retain the existing path.
- Deploy only `chat-multi`, then verify the affected account can generate from Luca-authored tool arguments.

## Technical detail
- Import and use the existing `isExtendedRuntimeToolsEnabled(userId)` gate in `chat-multi`.
- Narrow the `likelyGeneratedMediaRequest` exclusion so it applies only when the newer runtime cannot expose image tools.
- Do not change the image provider, image function, frontend, database, or global rollout settings.
