import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ImagePayloadError,
  inferImageAspectRatio,
  looksLikeDirectImageGenerationRequest,
  looksLikeImageToolRequest,
  parseImageApiPayload,
} from '../../supabase/functions/_shared/image-generation';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Luca image intent routing', () => {
  it.each([
    'generate an image of a fox in snow',
    'create me a picture of a quiet observatory',
    'make two photos of the same room',
    'draw an illustration of Luca',
    'show me an image of a glass machine',
    'please use generate_image for this portrait',
    'invoke the image generator',
  ])('routes %s through the image tool path', (prompt) => {
    expect(looksLikeImageToolRequest(prompt)).toBe(true);
    expect(looksLikeDirectImageGenerationRequest(prompt)).toBe(true);
  });

  it.each([
    'build an SVG diagram of the architecture',
    'create a Mermaid chart',
    'make an HTML page',
    'design a React component',
  ])('keeps renderable output out of deterministic raster generation: %s', (prompt) => {
    expect(looksLikeDirectImageGenerationRequest(prompt)).toBe(false);
  });

  it('routes edits to the image planner but not deterministic generation', () => {
    expect(looksLikeImageToolRequest('edit that image and make it darker')).toBe(true);
    expect(looksLikeDirectImageGenerationRequest('edit that image and make it darker')).toBe(false);
  });

  it('infers supported aspect ratios', () => {
    expect(inferImageAspectRatio('wide 16:9 wallpaper')).toBe('landscape');
    expect(inferImageAspectRatio('vertical 9:16 portrait')).toBe('portrait');
    expect(inferImageAspectRatio('square avatar')).toBe('square');
    expect(inferImageAspectRatio('surprise me')).toBe('auto');
  });
});

describe('provider image response contracts', () => {
  it('parses the current OpenRouter Images API payload', () => {
    expect(parseImageApiPayload({ data: [{ b64_json: 'aW1hZ2U=', media_type: 'image/webp' }] }, 'openrouter')).toEqual({
      base64: 'aW1hZ2U=',
      mimeType: 'image/webp',
      revisedPrompt: undefined,
    });
  });

  it('parses the OpenAI payload and revised prompt', () => {
    expect(parseImageApiPayload({ data: [{ b64_json: 'aW1hZ2U=', revised_prompt: 'revised' }] }, 'openai')).toEqual({
      base64: 'aW1hZ2U=',
      mimeType: 'image/png',
      revisedPrompt: 'revised',
    });
  });

  it('returns diagnostic metadata for malformed provider payloads', () => {
    expect(() => parseImageApiPayload({ data: [{ url: 'unexpected' }] }, 'openrouter')).toThrowError(ImagePayloadError);
    try {
      parseImageApiPayload({ data: [{ url: 'unexpected' }] }, 'openrouter');
    } catch (error) {
      expect(error).toMatchObject({ provider: 'openrouter', code: 'missing_b64_json', returnedKeys: ['url'] });
    }
  });
});

describe('image pipeline integration guards', () => {
  const chat = source('supabase/functions/chat-multi/index.ts');
  const planner = source('supabase/functions/anima-tool-execute/index.ts');
  const provider = source('supabase/functions/_shared/imageModel.ts');
  const create = source('supabase/functions/anima-image-create/index.ts');

  const runtime = source('supabase/functions/_shared/agent-runtime/openrouter-agent.ts');

  it('keeps the deterministic planner only as the fallback when the runtime has no image tools', () => {
    expect(chat).toContain('const runtimeCanRenderMedia = isExtendedRuntimeToolsEnabled(userId)');
    expect(chat).toContain('!runtimeCanRenderMedia && looksLikeImageToolRequest(messageWithAttachments)');
    expect(chat).toContain('!likelyGeneratedMediaRequest');
    expect(planner).toContain('looksLikeDirectImageGenerationRequest(latestContent)');
    expect(planner).toContain('executeDeterministicImageGeneration');
  });

  it('offers the runtime image tools to every user with no allowlist', () => {
    expect(runtime).not.toContain('AGENT_RUNTIME_EXTENDED_TOOLS_ALLOWLIST');
    expect(runtime).toContain('"false"');
    expect(runtime).toContain('name: "generate_image"');
    expect(runtime).toContain('name: "edit_image"');
  });

  it('persists generated images as attachments so they render inline', () => {
    expect(runtime).toContain('function buildMediaAttachments(');
    expect(runtime).toContain('buildMediaAttachments(toolCalls, toolResults)');
    expect(runtime).toContain('parsed?.ok === true && parsed?.result');
    expect(runtime).toContain('mediaAttachments.length > 0 ? { attachments: mediaAttachments }');
    expect(runtime).toContain('attachments: mediaAttachments');
    expect(chat).toContain('requireImageGeneration: looksLikeDirectImageGenerationRequest(messageWithAttachments)');
    expect(runtime).toContain('You MUST call generate_image exactly once before replying');
    expect(runtime).toContain('{ type: "function" as const, name: "generate_image" }');
  });

  it('uses the dedicated OpenRouter Images API and preserves OpenAI generation', () => {
    expect(provider).toContain('https://openrouter.ai/api/v1/images');
    expect(provider).not.toContain('https://openrouter.ai/api/v1/chat/completions');
    expect(provider).toContain('https://api.openai.com/v1/images/generations');
    expect(provider).toContain('input_references');
  });

  it('attributes internal image calls to the user and keeps inline image attachments', () => {
    expect(planner).toContain('body = { user_id: userId, prompt: args.prompt');
    expect(chat).toContain('if (name !== "generate_image" && name !== "edit_image") continue;');
    expect(chat).toContain('storage_path: parsed?.storage_path');
  });

  it('keeps Research Team and Forge isolated from image routing', () => {
    expect(chat).toContain('const likelyResearchTeamRequest');
    expect(chat).toContain('!likelyResearchTeamRequest');
    expect(planner).toContain('edgeFn = "research-team-run"');
    expect(planner).toContain('TOOL_SCHEMAS.filter((schema) => toolName(schema) !== "forge_agent")');
  });

  it('returns structured provider, quota, malformed-payload, and storage errors', () => {
    expect(create).toContain('code: "quota_exceeded"');
    expect(create).toContain('code: "storage_upload_failed"');
    expect(create).toContain('returned_keys:');
    expect(provider).toContain('code: "provider_http_error"');
    expect(provider).toContain('code: error.code');
  });
});
