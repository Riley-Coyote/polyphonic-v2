import { ForbiddenError, ValidationError } from "./errors.ts";
import { isOpenRouterAccountError, openRouterAccountError } from "./openrouter-errors.ts";

// Edge functions in this repository currently resolve a few compatible
// supabase-js 2.x versions. Keep this helper structural so a protected class
// member from one SDK build cannot make otherwise identical clients nominally
// incompatible at type-check time.
export type AttachmentAdmin = {
  from: (relation: string) => any;
  storage: { from: (bucket: string) => any };
};

export const ATTACHMENT_BUCKET = "chat-attachments";
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 10;
export const DEFAULT_USER_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 120_000;
export const MAX_MODEL_CONTEXT_CHARS = 120_000;

export type AttachmentKind = "image" | "document" | "spreadsheet" | "presentation" | "code" | "text" | "audio" | "video" | "archive" | "file";

const EXTENSION_KIND: Record<string, AttachmentKind> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", heic: "image", heif: "image", svg: "image",
  pdf: "document", doc: "document", docx: "document", rtf: "document",
  ppt: "presentation", pptx: "presentation",
  xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet", tsv: "spreadsheet",
  txt: "text", md: "text", markdown: "text", html: "text", htm: "text", xml: "text",
  json: "code", jsonl: "code", js: "code", jsx: "code", ts: "code", tsx: "code", css: "code", scss: "code",
  py: "code", rb: "code", go: "code", rs: "code", java: "code", c: "code", h: "code", cpp: "code", hpp: "code",
  cs: "code", sh: "code", bash: "code", zsh: "code", sql: "code", yaml: "code", yml: "code", toml: "code", ini: "code",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", flac: "audio", weba: "audio",
  mp4: "video", mov: "video", webm: "video",
  zip: "archive",
};

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "dylib", "so", "app", "dmg", "pkg", "msi", "apk", "jar", "com", "bat", "cmd", "ps1", "vbs", "scr",
  "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam", "ppsm", "sldm",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export function cleanFileName(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("name is required");
  const name = value.split(/[\\/]/).pop()?.replaceAll("\u0000", "").trim().slice(0, 255) ?? "";
  if (!name || name === "." || name === ".." || name.startsWith(".")) throw new ValidationError("Invalid file name");
  return name;
}

export function extensionOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export function classifyAttachment(name: string, mime: string): AttachmentKind {
  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.has(ext)) throw new ValidationError("Executable and macro-enabled files are not supported");
  if (ext === "webm" && mime.startsWith("audio/")) return "audio";
  const byExtension = EXTENSION_KIND[ext];
  if (byExtension) return byExtension;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/")) return "text";
  throw new ValidationError("This file type is not supported");
}

export function capabilitiesFor(kind: AttachmentKind): Record<string, boolean> {
  return {
    download: true,
    vision: kind === "image" || kind === "video" || kind === "document" || kind === "presentation",
    text: ["document", "spreadsheet", "presentation", "code", "text", "archive", "audio", "video"].includes(kind),
    pages: kind === "document",
    sheets: kind === "spreadsheet",
    slides: kind === "presentation",
    transcript: kind === "audio" || kind === "video",
    playback: kind === "audio" || kind === "video",
  };
}

export function safeStorageName(name: string): string {
  const ext = extensionOf(name);
  const stem = name.slice(0, ext ? -(ext.length + 1) : undefined)
    .normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "attachment";
  return ext ? `${stem}.${ext}` : stem;
}

export async function assertAttachmentScope(admin: AttachmentAdmin, userId: string, threadId: string | null, roomId: string | null, allowDraft = true) {
  if (threadId && roomId) throw new ValidationError("Choose a thread or room, not both");
  if (!threadId && !roomId && allowDraft) return;
  if (!threadId && !roomId) throw new ValidationError("A thread or room is required");
  if (threadId) {
    const { data, error } = await admin.from("threads").select("id").eq("id", threadId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenError("Thread not found");
  }
  if (roomId) {
    const { data, error } = await admin.from("group_room_members").select("id").eq("room_id", roomId).eq("user_id", userId).eq("state", "active").maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenError("You are not an active member of this room");
  }
}

export function sniffMime(bytes: Uint8Array, declared: string, name: string): string {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x4d, 0x5a) || starts(0x7f, 0x45, 0x4c, 0x46) || starts(0xca, 0xfe, 0xba, 0xbe)) {
    throw new ValidationError("Executable content is not supported");
  }
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06)) return MIME_BY_EXTENSION[extensionOf(name)] || "application/zip";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE") return "audio/wav";
  if (starts(0x4f, 0x67, 0x67, 0x53)) return "audio/ogg";
  if (starts(0x66, 0x4c, 0x61, 0x43)) return "audio/flac";
  if (starts(0x49, 0x44, 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return MIME_BY_EXTENSION[extensionOf(name)] || declared;
  const sample = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4096)).trimStart();
  if (extensionOf(name) === "svg" && /^<svg[\s>]/i.test(sample.replace(/^<\?xml[^>]*>\s*/i, ""))) return "image/svg+xml";
  return declared || MIME_BY_EXTENSION[extensionOf(name)] || "application/octet-stream";
}

export function assertMimeMatches(name: string, kind: AttachmentKind, declared: string, verified: string) {
  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.has(ext)) throw new ValidationError("Executable and macro-enabled files are not supported");
  const verifiedKind = classifyAttachment(name, verified);
  if (verifiedKind !== kind) throw new ValidationError("The file contents do not match the selected file type");
  if (declared && declared !== "application/octet-stream") {
    const declaredFamily = declared.split("/")[0];
    const verifiedFamily = verified.split("/")[0];
    if (["image", "audio", "video"].includes(declaredFamily) && declaredFamily !== verifiedFamily) {
      throw new ValidationError("The declared MIME type does not match the file contents");
    }
  }
}

export function assertSafeSvg(text: string) {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) throw new ValidationError("Invalid SVG file");
  if (/<script\b|<foreignObject\b|<!DOCTYPE|<!ENTITY|\son\w+\s*=|javascript:|data:text\/html|@import|url\(\s*["']?\s*(?:https?:|file:|\/\/)|(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|file:|\/\/)/i.test(text)) {
    throw new ValidationError("SVG contains active or external content");
  }
}

export function descriptorFromRow(row: Record<string, any>, signed?: { original?: string | null; display?: string | null; thumbnail?: string | null; derivatives?: any[] }) {
  const derivatives = (signed?.derivatives || (Array.isArray(row.derivatives) ? row.derivatives : []))
    .map((derivative: Record<string, unknown>) => ({
      ...derivative,
      storagePath: undefined,
      storage_path: undefined,
    }));
  return {
    version: 1,
    id: row.id,
    kind: row.kind,
    name: row.original_name,
    mimeType: row.verified_mime_type || row.declared_mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    status: row.status,
    ...(signed?.original ? { preview: {
      url: signed.display || signed.original,
      thumbnailUrl: signed.thumbnail || undefined,
      downloadUrl: signed.original,
      expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    } } : {}),
    capabilities: row.capabilities || {},
    ...(derivatives.length ? { derivatives } : {}),
    ...(row.extracted_text ? { extractedText: row.extracted_text } : {}),
    ...(row.processing_error ? { error: row.processing_error } : {}),
    ...(row.sha256 ? { checksum: row.sha256 } : {}),
    ...(row.duplicate_of ? { duplicateOf: row.duplicate_of } : {}),
    metadata: {
      createdAt: row.created_at,
      readyAt: row.ready_at,
      pageCount: row.page_count ?? undefined,
      durationSeconds: row.duration_seconds ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
    },
  };
}

export async function signedDescriptor(admin: AttachmentAdmin, row: Record<string, any>, expiresIn = 3600) {
  let original: string | null = null;
  let display: string | null = null;
  let thumbnail: string | null = null;
  if (row.status === "ready") {
    const { data } = await admin.storage.from(String(row.bucket)).createSignedUrl(String(row.storage_path), expiresIn);
    original = data?.signedUrl || null;
  }
  const rawDerivatives = Array.isArray(row.derivatives) ? row.derivatives : [];
  const derivatives = [];
  for (const item of rawDerivatives.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const path = typeof item.storage_path === "string" ? item.storage_path : typeof item.storagePath === "string" ? item.storagePath : null;
    let url: string | undefined;
    if (path) {
      const { data } = await admin.storage.from(String(row.bucket)).createSignedUrl(path, expiresIn);
      url = data?.signedUrl;
    }
    const safe = { ...item, storage_path: undefined, storagePath: undefined, ...(url ? { url } : {}) };
    derivatives.push(safe);
    if (item.kind === "safe-display" && url && !display) display = url;
    if ((item.kind === "thumbnail" || item.kind === "safe-display") && url && !thumbnail) thumbnail = url;
  }
  return descriptorFromRow(row, { original, display, thumbnail, derivatives });
}

export async function resolveAttachmentRows(admin: AttachmentAdmin, userId: string, ids: unknown): Promise<Record<string, any>[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const cleanIds = [...new Set(ids.filter((id): id is string => typeof id === "string"))].slice(0, MAX_ATTACHMENTS_PER_TURN);
  const { data, error } = await admin.from("chat_attachments").select("*").in("id", cleanIds);
  if (error) throw error;
  const rows = (data ?? []) as Record<string, any>[];
  const roomIds = [...new Set(rows.map((row) => row.room_id).filter((id): id is string => typeof id === "string"))];
  let memberRoomIds = new Set<string>();
  if (roomIds.length) {
    const { data: memberships, error: membershipError } = await admin.from("group_room_members").select("room_id")
      .eq("user_id", userId).eq("state", "active").in("room_id", roomIds);
    if (membershipError) throw membershipError;
    memberRoomIds = new Set((memberships ?? []).map((membership: { room_id: string }) => membership.room_id));
  }
  const allowed = rows.filter((row) => row.user_id === userId || (typeof row.room_id === "string" && memberRoomIds.has(row.room_id)));
  if (allowed.length !== cleanIds.length) throw new ForbiddenError("One or more attachments are unavailable");
  return cleanIds.map((id) => allowed.find((row) => row.id === id)!).filter(Boolean);
}

type ModelCapabilities = { image: boolean; audio: boolean; video: boolean };
let modelCapabilityCache: { expiresAt: number; rows: Map<string, ModelCapabilities> } | null = null;

export async function getModelCapabilities(model: string, apiKey?: string): Promise<ModelCapabilities> {
  if (!modelCapabilityCache || modelCapabilityCache.expiresAt < Date.now()) {
    const rows = new Map<string, ModelCapabilities>();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      const accountError = apiKey ? openRouterAccountError(response.status) : null;
      if (accountError) {
        await response.body?.cancel().catch(() => {});
        throw accountError;
      }
      if (response.ok) {
        const body = await response.json();
        for (const entry of body?.data || []) {
          const inputs = entry?.architecture?.input_modalities || entry?.architecture?.modality?.split("->")?.[0]?.split("+") || [];
          rows.set(entry.id, {
            image: inputs.includes("image"),
            audio: inputs.includes("audio"),
            video: inputs.includes("video"),
          });
        }
      }
    } catch (error) {
      if (isOpenRouterAccountError(error)) throw error;
      console.warn("[attachments] could not refresh model capabilities", error);
    }
    modelCapabilityCache = { expiresAt: Date.now() + 15 * 60 * 1000, rows };
  }
  const exact = modelCapabilityCache.rows.get(model);
  if (exact) return exact;
  const likelyVision = /(claude|gpt-4|gpt-5|gemini|grok|qwen.*vl|pixtral)/i.test(model);
  return { image: likelyVision, audio: /gemini|gpt-4o-audio/i.test(model), video: /gemini/i.test(model) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

function openRouterMessageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const text = (part as Record<string, unknown>).text;
    return typeof text === "string" ? [text] : [];
  }).join("\n").trim();
}

async function downloadAttachmentBytes(admin: AttachmentAdmin, row: Record<string, any>): Promise<Uint8Array> {
  if (Number(row.size_bytes) > 20 * 1024 * 1024) throw new ValidationError(`${row.original_name} is too large for inline media analysis`);
  const { data, error } = await admin.storage.from(String(row.bucket)).download(String(row.storage_path));
  if (error || !data) throw error || new Error("Could not read attachment media");
  return new Uint8Array(await data.arrayBuffer());
}

async function persistFallbackDerivative(
  admin: AttachmentAdmin,
  row: Record<string, any>,
  derivative: Record<string, unknown>,
) {
  const derivatives = (Array.isArray(row.derivatives) ? row.derivatives : []).filter((item: any) => item?.kind !== derivative.kind);
  derivatives.push(derivative);
  row.derivatives = derivatives;
  await admin.from("chat_attachments").update({ derivatives }).eq("id", row.id);
  return derivative;
}

async function ensureFallbackDerivative(
  admin: AttachmentAdmin,
  row: Record<string, any>,
  signedUrl: string | null,
  apiKey?: string,
) {
  const existing = (Array.isArray(row.derivatives) ? row.derivatives : []).find((item: any) => (
    row.kind === "audio" ? item?.kind === "transcript" : item?.kind === "summary"
  ));
  if (existing?.text) return existing;
  if (!apiKey) throw new ValidationError(`${row.original_name} needs a multimodal model or an OpenRouter key for automatic preparation`);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://polyphonic.chat",
    "X-Title": "Polyphonic Attachments",
  };
  if (row.kind === "image") {
    if (!signedUrl) throw new Error("Could not create temporary image access");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: [
          { type: "text", text: "Describe this uploaded image faithfully for another agent. Transcribe legible text, preserve meaningful layout, and state uncertainty. Do not infer facts that are not visible." },
          { type: "image_url", image_url: { url: signedUrl } },
        ] }],
        temperature: 0.1,
        max_tokens: 1600,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const accountError = openRouterAccountError(response.status);
    if (accountError) {
      await response.body?.cancel().catch(() => {});
      throw accountError;
    }
    const payload = await response.json();
    const text = openRouterMessageText(payload?.choices?.[0]?.message?.content);
    if (!response.ok || !text) throw new ValidationError(`Could not prepare ${row.original_name} for this model`);
    return persistFallbackDerivative(admin, row, { kind: "summary", text, engine: "openrouter-vision" });
  }

  if (row.kind === "audio") {
    const bytes = await downloadAttachmentBytes(admin, row);
    const ext = extensionOf(String(row.original_name));
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-transcribe",
        input_audio: { data: bytesToBase64(bytes), format: ["wav", "mp3", "flac", "m4a", "aac", "ogg"].includes(ext) ? ext : "mp3" },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const accountError = openRouterAccountError(response.status);
    if (accountError) {
      await response.body?.cancel().catch(() => {});
      throw accountError;
    }
    const payload = await response.json();
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!response.ok || !text) throw new ValidationError(`Could not transcribe ${row.original_name}`);
    return persistFallbackDerivative(admin, row, { kind: "transcript", text, engine: "openrouter-stt" });
  }

  if (row.kind === "video") {
    const bytes = await downloadAttachmentBytes(admin, row);
    const mime = String(row.verified_mime_type || row.declared_mime_type || "video/mp4");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: [
          { type: "text", text: "Create a grounded, chronological summary of this uploaded video. Include visible text and spoken content when available, and state uncertainty." },
          { type: "video_url", video_url: { url: `data:${mime};base64,${bytesToBase64(bytes)}` } },
        ] }],
        temperature: 0.1,
        max_tokens: 1800,
      }),
      signal: AbortSignal.timeout(150_000),
    });
    const accountError = openRouterAccountError(response.status);
    if (accountError) {
      await response.body?.cancel().catch(() => {});
      throw accountError;
    }
    const payload = await response.json();
    const text = openRouterMessageText(payload?.choices?.[0]?.message?.content);
    if (!response.ok || !text) throw new ValidationError(`Could not prepare ${row.original_name} for this model`);
    return persistFallbackDerivative(admin, row, { kind: "summary", text, engine: "openrouter-video" });
  }
  return null;
}

function sourceHeader(row: Record<string, any>) {
  return `[Attachment ${row.id}: ${row.original_name}]`;
}

export async function buildModelAttachmentContent(
  admin: AttachmentAdmin,
  userId: string,
  ids: unknown,
  model: string,
  apiKey?: string,
) {
  const rows = await resolveAttachmentRows(admin, userId, ids);
  const capabilities = await getModelCapabilities(model, apiKey);
  const parts: Record<string, unknown>[] = [];
  const context: string[] = [];
  const cachedAnnotations: unknown[] = [];
  let remainingContext = MAX_MODEL_CONTEXT_CHARS;

  for (const row of rows) {
    if (row.status !== "ready") throw new ValidationError(`${row.original_name} is not ready`);
    const name = String(row.original_name || "attachment");
    const mime = String(row.verified_mime_type || row.declared_mime_type || "application/octet-stream");
    const header = sourceHeader(row);
    const { data: signed } = await admin.storage.from(String(row.bucket)).createSignedUrl(String(row.storage_path), 900);
    let derivatives = Array.isArray(row.derivatives) ? row.derivatives : [];
    let summary = derivatives.find((item: any) => item?.kind === "summary" && typeof item?.text === "string")?.text || "";
    let transcript = derivatives.find((item: any) => item?.kind === "transcript" && typeof item?.text === "string")?.text || "";
    if ((row.kind === "image" && !capabilities.image && !summary)
      || (row.kind === "audio" && !capabilities.audio && !transcript)
      || (row.kind === "video" && !capabilities.video && !summary)) {
      await ensureFallbackDerivative(admin, row, signed?.signedUrl || null, apiKey);
      derivatives = Array.isArray(row.derivatives) ? row.derivatives : [];
      summary = derivatives.find((item: any) => item?.kind === "summary" && typeof item?.text === "string")?.text || "";
      transcript = derivatives.find((item: any) => item?.kind === "transcript" && typeof item?.text === "string")?.text || "";
    }
    const extracted = typeof row.extracted_text === "string" ? row.extracted_text : "";
    const bounded = [extracted, transcript, summary].filter(Boolean).join("\n\n").slice(0, Math.max(0, remainingContext));
    remainingContext -= bounded.length;
    context.push(`${header}\nType: ${mime}\nCitation format: ${name} plus the supplied page, slide, sheet, row, timestamp, archive member, or frame marker.${bounded ? `\n\n${bounded}` : ""}`);

    if (row.kind === "image" && capabilities.image && signed?.signedUrl) {
      parts.push({ type: "image_url", image_url: { url: signed.signedUrl } });
    } else if (row.kind === "document" && mime === "application/pdf" && signed?.signedUrl) {
      parts.push({ type: "file", file: { filename: name, file_data: signed.signedUrl } });
      const annotation = derivatives.find((item: any) => item?.kind === "openrouter-file-annotation")?.annotation;
      if (annotation) cachedAnnotations.push(annotation);
    } else if (row.kind === "audio" && capabilities.audio && Number(row.size_bytes) <= 20 * 1024 * 1024) {
      const { data } = await admin.storage.from(String(row.bucket)).download(String(row.storage_path));
      if (data) {
        const bytes = new Uint8Array(await data.arrayBuffer());
        const ext = extensionOf(name);
        parts.push({ type: "input_audio", input_audio: { data: bytesToBase64(bytes), format: ["wav", "mp3", "flac", "m4a", "aac", "ogg"].includes(ext) ? ext : "mp3" } });
      }
    } else if (row.kind === "video" && capabilities.video && Number(row.size_bytes) <= 20 * 1024 * 1024) {
      const { data } = await admin.storage.from(String(row.bucket)).download(String(row.storage_path));
      if (data) {
        const bytes = new Uint8Array(await data.arrayBuffer());
        parts.push({ type: "video_url", video_url: { url: `data:${mime};base64,${bytesToBase64(bytes)}` } });
      }
    }

    if ((row.kind === "video" || row.kind === "presentation" || row.kind === "document") && capabilities.image) {
      for (const keyframe of derivatives.filter((item: any) => ["keyframe", "page", "slide"].includes(item?.kind)).slice(0, 8)) {
        const path = keyframe.storage_path || keyframe.storagePath;
        if (!path) continue;
        const { data } = await admin.storage.from(String(row.bucket)).createSignedUrl(String(path), 900);
        if (data?.signedUrl) parts.push({ type: "image_url", image_url: { url: data.signedUrl } });
      }
    }
  }

  return {
    rows,
    parts,
    cachedAnnotations,
    promptContext: context.length ? `\n\nAuthorized attachment sources:\n${context.join("\n\n---\n\n")}` : "",
  };
}

export async function persistPdfAnnotations(admin: AttachmentAdmin, userId: string, attachmentIds: string[], annotations: unknown[]) {
  if (!attachmentIds.length || !annotations.length) return;
  const rows = await resolveAttachmentRows(admin, userId, attachmentIds);
  for (const row of rows.filter((item) => item.verified_mime_type === "application/pdf")) {
    const matching = annotations.find((annotation: any) => annotation?.type === "file" && (!annotation?.file?.name || annotation.file.name === row.original_name));
    if (!matching) continue;
    const derivatives = (Array.isArray(row.derivatives) ? row.derivatives : []).filter((item: any) => item?.kind !== "openrouter-file-annotation");
    derivatives.push({ kind: "openrouter-file-annotation", annotation: matching });
    await admin.from("chat_attachments").update({ derivatives }).eq("id", row.id);
  }
}
