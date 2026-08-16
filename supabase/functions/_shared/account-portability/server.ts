import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../cors.ts";
import {
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_VERSION,
  ACCOUNT_PORTABILITY_BUCKET,
  type AccountExportChunkRef,
  type AccountExportPayload,
  type ChunkedEncryptedArchive,
  type EncryptedArchiveChunk,
  type ImportIdMaps,
  type JsonRecord,
  type PortableAsset,
  type PortableTableConfig,
  EXCLUDED_PORTABILITY_TABLES,
  PORTABLE_TABLES,
  archiveFileName,
  assertArchivePayload,
  buildManifest,
  bytesToBase64,
  collectStorageRefsFromTables,
  createArchiveCryptoContext,
  createArchiveDecryptContext,
  createIdMaps,
  decryptArchive,
  decryptArchiveRowsChunk,
  encryptArchiveRowsChunk,
  encryptPayload,
  parsePortableArchiveText,
  redactPortableRow,
  rewriteStoragePathForUser,
  sha256Text,
  sourceRowId,
  tableCounts,
  transformRowForImport,
} from "./archive.ts";

type LooseTable = {
  Row: JsonRecord;
  Insert: JsonRecord;
  Update: JsonRecord;
  Relationships: [];
};

type LooseDatabase = {
  public: {
    Tables: Record<string, LooseTable>;
    Views: Record<string, LooseTable>;
    Functions: Record<string, never>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
};

type SupabaseAdmin = ReturnType<typeof createClient<LooseDatabase>>;

const MAX_BUNDLED_ASSETS = 200;
// Kept modest so a single base64-encoded asset can never blow the isolate heap.
const MAX_SINGLE_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BUNDLED_ASSET_BYTES = 200 * 1024 * 1024;
const BUNDLE_STORAGE_ASSETS = Deno.env.get("ACCOUNT_PORTABILITY_BUNDLE_ASSETS") !== "false";

export interface AuthContext {
  admin: SupabaseAdmin;
  user: { id: string; email?: string | null };
  authHeader: string;
}

export interface PreviewResult {
  archive_hash: string;
  export_id: string;
  exported_at: string;
  counts: Record<string, number>;
  assets: { total: number; missing: number };
  warnings: string[];
  duplicate_job_id: string | null;
  agent_mappings: Array<{
    source_id: string;
    target_id: string;
    mode: "resident-merge" | "keep" | "restored-id";
  }>;
  conflicts: Array<{ table: string; source_id: string; reason: string }>;
}

export interface ApplyResult {
  counts: Record<string, number>;
  warnings: string[];
  row_maps: number;
  assets_uploaded: number;
  assets_missing: number;
}

interface FullResolvedArchive {
  kind: "full";
  archiveText: string;
  archiveHash: string;
  payload: AccountExportPayload;
}

interface ChunkedResolvedArchive {
  kind: "chunked";
  archiveText: string;
  archiveHash: string;
  passphrase: string;
  archive: ChunkedEncryptedArchive;
}

type ResolvedArchive = FullResolvedArchive | ChunkedResolvedArchive;

interface DeferredColumnUpdate {
  table: string;
  idColumn: string;
  targetRowId: string;
  column: string;
  value: string;
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw httpError("Missing authorization", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Supabase environment is not configured");

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) throw httpError("Unauthorized", 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return { admin, user, authHeader };
}

export async function readJsonBody(req: Request): Promise<JsonRecord> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid JSON body");
    return body as JsonRecord;
  } catch {
    throw httpError("Invalid JSON body", 400);
  }
}

export function requiredString(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw httpError(`${key} required`, 400);
  }
  return value;
}

export function handleError(req: Request, error: unknown): Response {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : 500;
  const message = error instanceof Error ? error.message : "Unknown error";
  return jsonResponse(req, { error: message }, status);
}

export function httpError(message: string, status: number): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function createEncryptedAccountExport(
  admin: SupabaseAdmin,
  userId: string,
  passphrase: string,
): Promise<{
  exportId: string;
  fileName: string;
  archiveText: string;
  archiveHash: string;
  payload: AccountExportPayload;
}> {
  const exportId = crypto.randomUUID();
  const payload = await buildExportPayload(admin, userId, exportId);
  const encrypted = await encryptPayload(payload, passphrase);
  const archiveText = JSON.stringify(encrypted);
  const archiveHash = await sha256Text(archiveText);
  return {
    exportId,
    fileName: archiveFileName(exportId),
    archiveText,
    archiveHash,
    payload,
  };
}

export function startChunkedAccountExportJob(
  admin: SupabaseAdmin,
  userId: string,
  passphrase: string,
  jobId: string,
  expiresAt: string,
): void {
  const task = runChunkedAccountExportJob(admin, userId, passphrase, jobId, expiresAt);
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
  if (runtime.EdgeRuntime?.waitUntil) {
    runtime.EdgeRuntime.waitUntil(task);
  } else {
    void task;
  }
}

async function runChunkedAccountExportJob(
  admin: SupabaseAdmin,
  userId: string,
  passphrase: string,
  jobId: string,
  expiresAt: string,
): Promise<void> {
  try {
    const result = await createChunkedAccountExport(admin, userId, passphrase, jobId);
    const { error: updateError } = await admin
      .from("account_portability_jobs")
      .update({
        status: "completed",
        archive_hash: result.archiveHash,
        file_name: result.fileName,
        storage_bucket: ACCOUNT_PORTABILITY_BUCKET,
        storage_path: result.storagePath,
        counts: result.counts,
        warnings: result.warnings,
        manifest: result.manifest,
        expires_at: expiresAt,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    console.error("account export failed", jobId, error);
    await admin
      .from("account_portability_jobs")
      .update({
        status: "failed",
        errors: [error instanceof Error ? error.message : "Unknown export error"],
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    await deleteExportJobChunks(admin, userId, jobId).catch(() => {});
  }
}

async function heartbeatExportJob(
  admin: SupabaseAdmin,
  userId: string,
  jobId: string,
  counts: Record<string, number>,
  progress: { tables_done: number; total_tables: number; chunks: number; stage: string },
): Promise<void> {
  const { error } = await admin
    .from("account_portability_jobs")
    .update({
      counts,
      preview: { progress },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);
  if (error) console.warn("export heartbeat failed", jobId, error.message);
}

/** Removes the per-chunk objects of an export job, keeping the final archive file. */
export async function deleteExportJobChunks(
  admin: SupabaseAdmin,
  userId: string,
  jobId: string,
): Promise<number> {
  const prefix = `${userId}/${jobId}/chunks`;
  const { data, error } = await admin.storage.from(ACCOUNT_PORTABILITY_BUCKET).list(prefix, { limit: 1000 });
  if (error || !data?.length) return 0;
  const paths = data.map((item: { name: string }) => `${prefix}/${item.name}`);
  const { error: removeError } = await admin.storage.from(ACCOUNT_PORTABILITY_BUCKET).remove(paths);
  if (removeError) return 0;
  return paths.length;
}

async function createChunkedAccountExport(
  admin: SupabaseAdmin,
  userId: string,
  passphrase: string,
  jobId: string,
): Promise<{
  counts: Record<string, number>;
  warnings: string[];
  manifest: ChunkedEncryptedArchive["manifest"];
  fileName: string;
  storagePath: string;
  archiveHash: string;
}> {
  const exportId = crypto.randomUUID();
  const exportedAt = new Date().toISOString();
  const context = await createArchiveCryptoContext(passphrase);
  const chunks: AccountExportChunkRef[] = [];
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  const refs = new Map<string, { bucket: string; path: string }>();
  let chunkIndex = 0;
  let tablesDone = 0;

  for (const config of PORTABLE_TABLES) {
    counts[config.name] = 0;
    if (config.userColumn) {
      for await (const rows of fetchTableRowPages(admin, config, userId, warnings)) {
        const redacted = rows.map((row) => redactPortableRow(config, row));
        counts[config.name] += redacted.length;
        for (const ref of collectStorageRefsFromTables({ [config.name]: redacted })) {
          refs.set(`${ref.bucket}/${ref.path}`, ref);
        }
        if (redacted.length === 0) continue;

        const encryptedChunk = await encryptArchiveRowsChunk(config.name, chunkIndex, redacted, context);
        const chunkText = JSON.stringify(encryptedChunk);
        const chunkPath = `${userId}/${jobId}/chunks/${String(chunkIndex).padStart(6, "0")}-${safeStorageName(config.name)}.json`;
        const { error: uploadError } = await admin.storage
          .from(ACCOUNT_PORTABILITY_BUCKET)
          .upload(chunkPath, new Blob([chunkText], { type: "application/json" }), {
            upsert: true,
            contentType: "application/json",
          });
        if (uploadError) throw new Error(`Could not upload ${config.name} chunk: ${uploadError.message}`);

        chunks.push({
          table: config.name,
          index: chunkIndex,
          row_count: redacted.length,
          storage_bucket: ACCOUNT_PORTABILITY_BUCKET,
          storage_path: chunkPath,
          sha256: await sha256Text(chunkText),
        });
        chunkIndex += 1;
      }
    }
    tablesDone += 1;
    await heartbeatExportJob(admin, userId, jobId, counts, {
      tables_done: tablesDone,
      total_tables: PORTABLE_TABLES.length,
      chunks: chunkIndex,
      stage: `tables:${config.name}`,
    });
  }

  if (BUNDLE_STORAGE_ASSETS) {
    for (const ref of await listWorkspaceStorageRefs(admin, userId, warnings)) {
      refs.set(`${ref.bucket}/${ref.path}`, ref);
    }
  }
  const assetRefs = uniqueRefs([...refs.values()]);
  await heartbeatExportJob(admin, userId, jobId, counts, {
    tables_done: tablesDone,
    total_tables: PORTABLE_TABLES.length,
    chunks: chunkIndex,
    stage: "assembling",
  });

  const fileName = archiveFileName(exportId);
  const storagePath = `${userId}/${jobId}/${fileName}`;
  const header = {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    mode: "chunked" as const,
    encryption: context.encryption,
    export_id: exportId,
    exported_at: exportedAt,
    source_user_id: userId,
  };

  let assetTotal = 0;
  let assetMissing = 0;
  const manifestRef: { value: ChunkedEncryptedArchive["manifest"] | null } = { value: null };

  // The archive is emitted as a stream: chunk bodies are piped straight from
  // storage and assets are encoded one at a time, so peak memory stays at a
  // single chunk/asset instead of the whole archive.
  async function* archiveParts(): AsyncGenerator<string> {
    const headerText = JSON.stringify(header);
    yield `${headerText.slice(0, -1)},"chunks":[`;

    for (let i = 0; i < chunks.length; i += 1) {
      const ref = chunks[i];
      const chunkText = await downloadArchiveChunkText(admin, ref);
      yield `${i === 0 ? "" : ","}${JSON.stringify({ ...ref, inline_payload: chunkText })}`;
    }
    yield `],"assets":[`;

    let first = true;
    for await (const asset of streamExportAssets(admin, assetRefs, warnings)) {
      assetTotal += 1;
      if (asset.missing) assetMissing += 1;
      yield `${first ? "" : ","}${JSON.stringify(asset)}`;
      first = false;
    }
    yield `],"warnings":${JSON.stringify(warnings)}`;

    const manifest = {
      app: "polyphonic",
      tables: counts,
      assets: { total: assetTotal, missing: assetMissing },
      excluded: [...EXCLUDED_PORTABILITY_TABLES],
    } as ChunkedEncryptedArchive["manifest"];
    manifestRef.value = manifest;
    yield `,"manifest":${JSON.stringify(manifest)}}`;
  }

  const archiveHash = await uploadStreamedArchive(storagePath, archiveParts());
  await deleteExportJobChunks(admin, userId, jobId).catch(() => {});

  return {
    counts,
    warnings,
    manifest: manifestRef.value || {
      app: "polyphonic",
      tables: counts,
      assets: { total: assetTotal, missing: assetMissing },
      excluded: [...EXCLUDED_PORTABILITY_TABLES],
    } as ChunkedEncryptedArchive["manifest"],
    fileName,
    storagePath,
    archiveHash,
  };
}

/** Uploads a generated archive to storage as a stream, returning its sha256. */
async function uploadStreamedArchive(
  storagePath: string,
  parts: AsyncGenerator<string>,
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase environment is not configured");

  const hasher = new Sha256Stream();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await parts.next();
        if (next.done) {
          controller.close();
          return;
        }
        const bytes = encoder.encode(next.value);
        hasher.update(bytes);
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const endpoint = `${supabaseUrl}/storage/v1/object/${ACCOUNT_PORTABILITY_BUCKET}/${storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
      "x-upsert": "true",
      "Cache-Control": "3600",
    },
    body,
    // Deno requires an explicit duplex hint for streamed request bodies.
    ...({ duplex: "half" } as Record<string, unknown>),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not upload export archive (${response.status}): ${detail.slice(0, 300)}`);
  }
  await response.body?.cancel().catch(() => {});
  return hasher.hex();
}


export async function decryptArchiveBody(body: JsonRecord): Promise<{ archiveText: string; payload: AccountExportPayload; archiveHash: string }> {
  const archiveText = requiredString(body, "archive_text");
  const passphrase = requiredString(body, "passphrase");
  const archive = parsePortableArchiveText(archiveText);
  if (!("payload" in archive)) throw new Error("Use resolveArchiveBody for chunked archives");
  const payload = await decryptArchive(archive, passphrase);
  return { archiveText, payload: assertArchivePayload(payload), archiveHash: await sha256Text(archiveText) };
}

export async function resolveArchiveBody(body: JsonRecord): Promise<ResolvedArchive> {
  const archiveText = requiredString(body, "archive_text");
  const passphrase = requiredString(body, "passphrase");
  const archive = parsePortableArchiveText(archiveText);
  const archiveHash = await sha256Text(archiveText);
  if (!("payload" in archive)) {
    return { kind: "chunked", archiveText, archiveHash, passphrase, archive };
  }
  const payload = await decryptArchive(archive, passphrase);
  return { kind: "full", archiveText, payload: assertArchivePayload(payload), archiveHash };
}

export async function buildImportPreview(
  admin: SupabaseAdmin,
  payload: AccountExportPayload,
  targetUserId: string,
  archiveHash: string,
): Promise<{ preview: PreviewResult; maps: ImportIdMaps }> {
  const existingAgentIds = await fetchExistingAgentIds(admin, targetUserId);
  const maps = createIdMaps(payload, existingAgentIds);
  const warnings = [...(payload.warnings || [])];
  const conflicts = await collectImportConflicts(admin, payload, targetUserId, maps);
  const duplicateJobId = await findDuplicateCompletedImport(admin, targetUserId, archiveHash);
  const agentMappings = (payload.tables.agent_configs || [])
    .map((row) => {
      const sourceId = typeof row.id === "string" ? row.id : "";
      if (!sourceId) return null;
      const targetId = maps.agents[sourceId] || sourceId;
      return {
        source_id: sourceId,
        target_id: targetId,
        mode: sourceId === targetId && isResidentAgent(sourceId)
          ? "resident-merge" as const
          : sourceId === targetId
            ? "keep" as const
            : "restored-id" as const,
      };
    })
    .filter(Boolean) as PreviewResult["agent_mappings"];

  if (payload.version !== ACCOUNT_EXPORT_VERSION || payload.format !== ACCOUNT_EXPORT_FORMAT) {
    warnings.push("Archive format is not the current Polyphonic export format.");
  }

  return {
    maps,
    preview: {
      archive_hash: archiveHash,
      export_id: payload.export_id,
      exported_at: payload.exported_at,
      counts: tableCounts(payload.tables),
      assets: payload.manifest?.assets ?? {
        total: payload.assets?.length ?? 0,
        missing: (payload.assets || []).filter((asset) => asset.missing).length,
      },
      warnings,
      duplicate_job_id: duplicateJobId,
      agent_mappings: agentMappings,
      conflicts,
    },
  };
}

export async function buildImportPreviewForArchive(
  admin: SupabaseAdmin,
  resolved: ResolvedArchive,
  targetUserId: string,
): Promise<{ preview: PreviewResult; maps: ImportIdMaps }> {
  if (resolved.kind === "full") {
    return buildImportPreview(admin, resolved.payload, targetUserId, resolved.archiveHash);
  }

  const existingAgentIds = await fetchExistingAgentIds(admin, targetUserId);
  const minimalPayload = await buildMinimalPayloadForIdMaps(admin, resolved);
  const maps = createIdMaps(minimalPayload, existingAgentIds);
  const conflicts = await collectImportConflictsForArchive(admin, resolved, targetUserId, maps);
  const duplicateJobId = await findDuplicateCompletedImport(admin, targetUserId, resolved.archiveHash);
  const agentMappings = (minimalPayload.tables.agent_configs || [])
    .map((row) => {
      const sourceId = typeof row.id === "string" ? row.id : "";
      if (!sourceId) return null;
      const targetId = maps.agents[sourceId] || sourceId;
      return {
        source_id: sourceId,
        target_id: targetId,
        mode: sourceId === targetId && isResidentAgent(sourceId)
          ? "resident-merge" as const
          : sourceId === targetId
            ? "keep" as const
            : "restored-id" as const,
      };
    })
    .filter(Boolean) as PreviewResult["agent_mappings"];

  return {
    maps,
    preview: {
      archive_hash: resolved.archiveHash,
      export_id: resolved.archive.export_id,
      exported_at: resolved.archive.exported_at,
      counts: resolved.archive.manifest.tables,
      assets: resolved.archive.manifest.assets,
      warnings: [...(resolved.archive.warnings || [])],
      duplicate_job_id: duplicateJobId,
      agent_mappings: agentMappings,
      conflicts,
    },
  };
}

export async function applyImportPayload(
  admin: SupabaseAdmin,
  payload: AccountExportPayload,
  targetUserId: string,
  importJobId: string,
  maps: ImportIdMaps,
): Promise<ApplyResult> {
  const warnings = [...(payload.warnings || [])];
  const counts: Record<string, number> = {};
  const deferredUpdates: DeferredColumnUpdate[] = [];
  let rowMaps = 0;
  const assetStats = await uploadAssetsForImport(admin, payload, targetUserId, importJobId, maps, warnings);

  for (const config of PORTABLE_TABLES) {
    counts[config.name] = 0;
    if (config.readOnly) continue;

    const sourceRows = payload.tables[config.name] || [];
    if (sourceRows.length === 0) continue;

    const prepared: Array<{ source: JsonRecord; target: JsonRecord }> = [];
    for (const source of sourceRows) {
      if (await shouldSkipExistingTarget(admin, config, source, targetUserId, maps)) {
        warnings.push(`${config.name}:${sourceRowId(config, source)} already exists in the target account; skipped.`);
        continue;
      }
      prepared.push({
        source,
        target: transformRowForImport(config, source, targetUserId, maps, importJobId, payload.export_id),
      });
    }

    if (prepared.length === 0) continue;

    for (const batch of chunk(prepared, importBatchSizeFor(config))) {
      const rows = batch.map((item) => item.target);
      const mapRows = batch
        .map((item) => buildMapRow(config, item.source, targetUserId, importJobId, maps))
        .filter(Boolean) as JsonRecord[];
      await insertRowMaps(admin, mapRows);
      rowMaps += mapRows.length;

      const query = config.onConflict
        ? admin.from(config.name).upsert(rows, { onConflict: config.onConflict })
        : admin.from(config.name).insert(rows);
      const { error } = await query;
      if (error) throw new Error(`Import failed on ${config.name}: ${error.message}`);

      counts[config.name] += rows.length;
      deferredUpdates.push(...buildDeferredColumnUpdates(config, batch, maps, warnings));
    }
  }

  await applyDeferredColumnUpdates(admin, targetUserId, deferredUpdates, warnings);
  const bridgeStats = await ensureImportedHypomnemaContinuity(admin, targetUserId, importJobId);
  warnings.push(...bridgeStats.warnings);
  if (bridgeStats.created > 0) {
    counts.hypomnema_entry = (counts.hypomnema_entry || 0) + bridgeStats.created;
    rowMaps += bridgeStats.rowMaps;
  }

  return {
    counts,
    warnings,
    row_maps: rowMaps,
    assets_uploaded: assetStats.uploaded,
    assets_missing: assetStats.missing,
  };
}

export async function applyImportArchive(
  admin: SupabaseAdmin,
  resolved: ResolvedArchive,
  targetUserId: string,
  importJobId: string,
  maps: ImportIdMaps,
): Promise<ApplyResult> {
  if (resolved.kind === "full") {
    return applyImportPayload(admin, resolved.payload, targetUserId, importJobId, maps);
  }

  const warnings = [...(resolved.archive.warnings || [])];
  const counts: Record<string, number> = {};
  const deferredUpdates: DeferredColumnUpdate[] = [];
  let rowMaps = 0;
  const assetPayload = archiveShellPayload(resolved.archive);
  const assetStats = await uploadAssetsForImport(admin, assetPayload, targetUserId, importJobId, maps, warnings);

  for (const config of PORTABLE_TABLES) {
    counts[config.name] = 0;
    if (config.readOnly) continue;

    for await (const sourceRows of iterateArchiveRows(admin, resolved, config.name)) {
      if (sourceRows.length === 0) continue;
      const prepared: Array<{ source: JsonRecord; target: JsonRecord }> = [];
      for (const source of sourceRows) {
        if (await shouldSkipExistingTarget(admin, config, source, targetUserId, maps)) {
          warnings.push(`${config.name}:${sourceRowId(config, source)} already exists in the target account; skipped.`);
          continue;
        }
        prepared.push({
          source,
          target: transformRowForImport(config, source, targetUserId, maps, importJobId, resolved.archive.export_id),
        });
      }

      for (const batch of chunk(prepared, importBatchSizeFor(config))) {
        if (batch.length === 0) continue;
        const rows = batch.map((item) => item.target);
        const mapRows = batch
          .map((item) => buildMapRow(config, item.source, targetUserId, importJobId, maps))
          .filter(Boolean) as JsonRecord[];
        await insertRowMaps(admin, mapRows);
        rowMaps += mapRows.length;

        const query = config.onConflict
          ? admin.from(config.name).upsert(rows, { onConflict: config.onConflict })
          : admin.from(config.name).insert(rows);
        const { error } = await query;
        if (error) throw new Error(`Import failed on ${config.name}: ${error.message}`);

        counts[config.name] += rows.length;
        deferredUpdates.push(...buildDeferredColumnUpdates(config, batch, maps, warnings));
      }
    }
  }

  await applyDeferredColumnUpdates(admin, targetUserId, deferredUpdates, warnings);
  const bridgeStats = await ensureImportedHypomnemaContinuity(admin, targetUserId, importJobId);
  warnings.push(...bridgeStats.warnings);
  if (bridgeStats.created > 0) {
    counts.hypomnema_entry = (counts.hypomnema_entry || 0) + bridgeStats.created;
    rowMaps += bridgeStats.rowMaps;
  }

  return {
    counts,
    warnings,
    row_maps: rowMaps,
    assets_uploaded: assetStats.uploaded,
    assets_missing: assetStats.missing,
  };
}

export function startAccountImportJob(
  admin: SupabaseAdmin,
  resolved: ResolvedArchive,
  targetUserId: string,
  importJobId: string,
  maps: ImportIdMaps,
): void {
  const task = runAccountImportJob(admin, resolved, targetUserId, importJobId, maps);
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
  if (runtime.EdgeRuntime?.waitUntil) {
    runtime.EdgeRuntime.waitUntil(task);
  } else {
    void task;
  }
}

async function runAccountImportJob(
  admin: SupabaseAdmin,
  resolved: ResolvedArchive,
  targetUserId: string,
  importJobId: string,
  maps: ImportIdMaps,
): Promise<void> {
  try {
    const result = await applyImportArchive(admin, resolved, targetUserId, importJobId, maps);
    const { error: updateError } = await admin
      .from("account_portability_jobs")
      .update({
        status: "completed",
        counts: result.counts,
        warnings: result.warnings,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", importJobId)
      .eq("user_id", targetUserId);
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    const errors = [error instanceof Error ? error.message : "Unknown import error"];
    try {
      const deleted = await rollbackImportJob(admin, targetUserId, importJobId);
      const deletedCount = Object.values(deleted).reduce((sum, count) => sum + count, 0);
      errors.push(`Rolled back ${deletedCount} rows from the failed import job.`);
    } catch (rollbackError) {
      errors.push(`Rollback after import failure failed: ${rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error"}`);
    }
    await admin
      .from("account_portability_jobs")
      .update({
        status: "failed",
        errors,
        updated_at: new Date().toISOString(),
      })
      .eq("id", importJobId)
      .eq("user_id", targetUserId);
  }
}

export async function rollbackFailedImportAttempts(
  admin: SupabaseAdmin,
  targetUserId: string,
  archiveHash: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("account_portability_jobs")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("direction", "import")
    .eq("archive_hash", archiveHash)
    .eq("status", "failed");
  if (error) throw new Error(error.message);

  const rolledBack: string[] = [];
  for (const job of data || []) {
    const jobId = typeof job.id === "string" ? job.id : "";
    if (!jobId) continue;
    await rollbackImportJob(admin, targetUserId, jobId);
    const { error: updateError } = await admin
      .from("account_portability_jobs")
      .update({
        status: "rolled_back",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", targetUserId);
    if (updateError) throw new Error(updateError.message);
    rolledBack.push(jobId);
  }
  return rolledBack;
}

export async function rollbackImportJob(admin: SupabaseAdmin, targetUserId: string, jobId: string): Promise<Record<string, number>> {
  const { data: maps, error } = await admin
    .from("account_portability_row_map")
    .select("table_name,target_id")
    .eq("user_id", targetUserId)
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);

  const byTable = new Map<string, string[]>();
  const mapRows = (maps || []) as Array<{ table_name?: unknown; target_id?: unknown }>;
  for (const row of mapRows) {
    if (typeof row.table_name !== "string" || typeof row.target_id !== "string") continue;
    if (!row?.table_name || !row?.target_id) continue;
    const config = PORTABLE_TABLES.find((item) => item.name === row.table_name);
    if (!config?.idColumn || config.readOnly) continue;
    const ids = byTable.get(row.table_name) || [];
    ids.push(row.target_id);
    byTable.set(row.table_name, ids);
  }

  const deleted: Record<string, number> = {};
  const reverseTables = [...PORTABLE_TABLES].reverse();
  for (const config of reverseTables) {
    const ids = byTable.get(config.name);
    if (!ids?.length || !config.idColumn) continue;
    deleted[config.name] = 0;
    for (const batch of chunk([...new Set(ids)], 100)) {
      const { count, error: deleteError } = await admin
        .from(config.name)
        .delete({ count: "exact" })
        .eq(config.userColumn || "user_id", targetUserId)
        .in(config.idColumn, batch);
      if (deleteError) throw new Error(`Rollback failed on ${config.name}: ${deleteError.message}`);
      deleted[config.name] += count || 0;
    }
  }

  return deleted;
}

async function buildExportPayload(admin: SupabaseAdmin, userId: string, exportId: string): Promise<AccountExportPayload> {
  const tables: Record<string, JsonRecord[]> = {};
  const warnings: string[] = [];

  for (const config of PORTABLE_TABLES) {
    tables[config.name] = [];
    if (!config.userColumn) continue;
    const rows = await fetchTableRows(admin, config, userId, warnings);
    tables[config.name] = rows.map((row) => redactPortableRow(config, row));
  }

  const refs = collectStorageRefsFromTables(tables);
  if (BUNDLE_STORAGE_ASSETS) {
    refs.push(...await listWorkspaceStorageRefs(admin, userId, warnings));
  }
  const assets = BUNDLE_STORAGE_ASSETS
    ? await downloadAssets(admin, uniqueRefs(refs), warnings)
    : deferredAssets(uniqueRefs(refs), warnings);

  const manifest = buildManifest(tables, assets, warnings);
  return {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    export_id: exportId,
    exported_at: new Date().toISOString(),
    source_user_id: userId,
    manifest,
    tables,
    assets,
    warnings,
  };
}

function deferredAssets(
  refs: Array<{ bucket: string; path: string }>,
  warnings: string[],
): PortableAsset[] {
  if (refs.length > 0) {
    warnings.push(
      `Storage asset binaries were deferred to keep this export within edge compute limits; ${refs.length} asset reference${refs.length === 1 ? "" : "s"} preserved.`,
    );
  }
  return refs.map((ref) => ({
    ...ref,
    missing: true,
    error: "asset binary deferred",
  }));
}

async function fetchTableRows(
  admin: SupabaseAdmin,
  config: PortableTableConfig,
  userId: string,
  warnings: string[],
): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(config.name)
      .select("*")
      .eq(config.userColumn!, userId)
      .range(from, from + pageSize - 1);
    if (error) {
      warnings.push(`${config.name} could not be exported: ${error.message}`);
      return rows;
    }
    rows.push(...((data || []) as JsonRecord[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function* fetchTableRowPages(
  admin: SupabaseAdmin,
  config: PortableTableConfig,
  userId: string,
  warnings: string[],
): AsyncGenerator<JsonRecord[]> {
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(config.name)
      .select("*")
      .eq(config.userColumn!, userId)
      .range(from, from + pageSize - 1);
    if (error) {
      warnings.push(`${config.name} could not be exported: ${error.message}`);
      return;
    }
    const rows = (data || []) as JsonRecord[];
    if (rows.length > 0) yield rows;
    if (rows.length < pageSize) return;
  }
}

async function downloadAssets(
  admin: SupabaseAdmin,
  refs: Array<{ bucket: string; path: string }>,
  warnings: string[],
): Promise<PortableAsset[]> {
  const assets: PortableAsset[] = [];
  let bundled = 0;
  let totalBytes = 0;
  for (const ref of refs) {
    if (bundled >= MAX_BUNDLED_ASSETS) {
      warnings.push(`Storage asset skipped because the export reached the bundled asset limit: ${ref.bucket}/${ref.path}`);
      assets.push({ ...ref, missing: true, error: "bundled asset limit reached" });
      continue;
    }

    const knownSize = await storageObjectSize(admin, ref.bucket, ref.path);
    if (knownSize === null) {
      warnings.push(`Storage asset size unknown; not bundled: ${ref.bucket}/${ref.path}`);
      assets.push({ ...ref, missing: true, error: "size unknown" });
      continue;
    }
    if (knownSize > MAX_SINGLE_ASSET_BYTES) {
      warnings.push(`Storage asset too large for encrypted archive: ${ref.bucket}/${ref.path}`);
      assets.push({ ...ref, size: knownSize, missing: true, error: "asset too large" });
      continue;
    }
    if (totalBytes + knownSize > MAX_TOTAL_BUNDLED_ASSET_BYTES) {
      warnings.push(`Storage asset skipped to keep the export under archive limits: ${ref.bucket}/${ref.path}`);
      assets.push({ ...ref, size: knownSize, missing: true, error: "archive asset budget reached" });
      continue;
    }

    const { data, error } = await admin.storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      warnings.push(`Storage asset missing: ${ref.bucket}/${ref.path}`);
      assets.push({ ...ref, missing: true, error: error?.message || "missing" });
      continue;
    }
    const buffer = await data.arrayBuffer();
    if (buffer.byteLength > MAX_SINGLE_ASSET_BYTES || totalBytes + buffer.byteLength > MAX_TOTAL_BUNDLED_ASSET_BYTES) {
      warnings.push(`Storage asset skipped after download size check: ${ref.bucket}/${ref.path}`);
      assets.push({ ...ref, size: buffer.byteLength, missing: true, error: "asset size cap exceeded" });
      continue;
    }
    totalBytes += buffer.byteLength;
    bundled += 1;
    assets.push({
      ...ref,
      content_type: data.type || "application/octet-stream",
      size: buffer.byteLength,
      base64: bytesToBase64(new Uint8Array(buffer)),
    });
  }
  return assets;
}

/**
 * Yields export assets one at a time so a streamed archive never holds more
 * than a single base64-encoded asset in memory.
 */
async function* streamExportAssets(
  admin: SupabaseAdmin,
  refs: Array<{ bucket: string; path: string }>,
  warnings: string[],
): AsyncGenerator<PortableAsset> {
  if (!BUNDLE_STORAGE_ASSETS) {
    for (const asset of deferredAssets(refs, warnings)) yield asset;
    return;
  }

  let bundled = 0;
  let totalBytes = 0;
  for (const ref of refs) {
    if (bundled >= MAX_BUNDLED_ASSETS) {
      warnings.push(`Storage asset skipped because the export reached the bundled asset limit: ${ref.bucket}/${ref.path}`);
      yield { ...ref, missing: true, error: "bundled asset limit reached" };
      continue;
    }

    const knownSize = await storageObjectSize(admin, ref.bucket, ref.path);
    if (knownSize === null) {
      warnings.push(`Storage asset size unknown; not bundled: ${ref.bucket}/${ref.path}`);
      yield { ...ref, missing: true, error: "size unknown" };
      continue;
    }
    if (knownSize > MAX_SINGLE_ASSET_BYTES) {
      warnings.push(`Storage asset too large for encrypted archive: ${ref.bucket}/${ref.path}`);
      yield { ...ref, size: knownSize, missing: true, error: "asset too large" };
      continue;
    }
    if (totalBytes + knownSize > MAX_TOTAL_BUNDLED_ASSET_BYTES) {
      warnings.push(`Storage asset skipped to keep the export under archive limits: ${ref.bucket}/${ref.path}`);
      yield { ...ref, size: knownSize, missing: true, error: "archive asset budget reached" };
      continue;
    }

    const { data, error } = await admin.storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      warnings.push(`Storage asset missing: ${ref.bucket}/${ref.path}`);
      yield { ...ref, missing: true, error: error?.message || "missing" };
      continue;
    }
    const buffer = await data.arrayBuffer();
    if (buffer.byteLength > MAX_SINGLE_ASSET_BYTES || totalBytes + buffer.byteLength > MAX_TOTAL_BUNDLED_ASSET_BYTES) {
      warnings.push(`Storage asset skipped after download size check: ${ref.bucket}/${ref.path}`);
      yield { ...ref, size: buffer.byteLength, missing: true, error: "asset size cap exceeded" };
      continue;
    }
    totalBytes += buffer.byteLength;
    bundled += 1;
    yield {
      ...ref,
      content_type: data.type || "application/octet-stream",
      size: buffer.byteLength,
      base64: bytesToBase64(new Uint8Array(buffer)),
    };
  }
}


async function storageObjectSize(admin: SupabaseAdmin, bucket: string, path: string): Promise<number | null> {
  const cleanPath = path.replace(/^\/+/, "");
  const parts = cleanPath.split("/");
  const name = parts.pop();
  if (!name) return null;
  const prefix = parts.join("/");
  const { data, error } = await admin.storage.from(bucket).list(prefix, {
    limit: 100,
    offset: 0,
    search: name,
  });
  if (error || !data) return null;
  const item = data.find((entry: unknown) => {
    const record = entry as { name?: unknown };
    return record.name === name;
  });
  return sizeFromStorageListItem(item);
}

function sizeFromStorageListItem(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const record = item as { metadata?: Record<string, unknown> | null; size?: unknown };
  const raw = record.metadata?.size ?? record.size;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function uploadAssetsForImport(
  admin: SupabaseAdmin,
  payload: AccountExportPayload,
  targetUserId: string,
  importJobId: string,
  maps: ImportIdMaps,
  warnings: string[],
): Promise<{ uploaded: number; missing: number }> {
  let uploaded = 0;
  let missing = 0;
  for (const asset of payload.assets || []) {
    const key = `${asset.bucket}/${asset.path}`;
    if (asset.missing || !asset.base64) {
      missing += 1;
      warnings.push(`Storage asset was not present in archive: ${key}`);
      continue;
    }
    const targetPath = rewriteStoragePathForUser(asset, payload.source_user_id, targetUserId, importJobId);
    const bytes = base64ToUint8(asset.base64);
    const blob = new Blob([bytes as unknown as BlobPart], { type: asset.content_type || "application/octet-stream" });
    const { error } = await admin.storage
      .from(asset.bucket)
      .upload(targetPath, blob, {
        upsert: true,
        contentType: asset.content_type || "application/octet-stream",
      });
    if (error) {
      missing += 1;
      warnings.push(`Storage asset could not be restored: ${key} (${error.message})`);
      continue;
    }

    let signedUrl: string | undefined;
    if (asset.bucket === "chat-attachments" || asset.bucket === "workspace-files") {
      const { data } = await admin.storage.from(asset.bucket).createSignedUrl(targetPath, 60 * 60 * 24 * 30);
      signedUrl = data?.signedUrl;
    }

    maps.assets[key] = { bucket: asset.bucket, path: targetPath, signedUrl };
    uploaded += 1;
  }
  return { uploaded, missing };
}

async function listWorkspaceStorageRefs(
  admin: SupabaseAdmin,
  userId: string,
  warnings: string[],
): Promise<Array<{ bucket: string; path: string }>> {
  const bucket = "workspace-files";
  const refs: Array<{ bucket: string; path: string }> = [];
  const root = `workspaces/${userId}`;

  async function visit(prefix: string, depth: number): Promise<void> {
    if (depth > 8) return;
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset: 0 });
    if (error) {
      warnings.push(`Workspace files could not be listed: ${error.message}`);
      return;
    }
    for (const item of data || []) {
      const path = `${prefix}/${item.name}`;
      const metadata = (item as { metadata?: Record<string, unknown> | null }).metadata;
      if (metadata && (metadata.size || metadata.mimetype || metadata.cacheControl)) {
        refs.push({ bucket, path });
      } else {
        await visit(path, depth + 1);
      }
    }
  }

  await visit(root, 0);
  return refs;
}

async function fetchExistingAgentIds(admin: SupabaseAdmin, userId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("agent_configs").select("id").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return new Set((data || [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string"));
}

async function findDuplicateCompletedImport(admin: SupabaseAdmin, userId: string, archiveHash: string): Promise<string | null> {
  const { data } = await admin
    .from("account_portability_jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("direction", "import")
    .eq("archive_hash", archiveHash)
    .in("status", ["completed", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return typeof data?.id === "string" ? data.id : null;
}

async function collectImportConflicts(
  admin: SupabaseAdmin,
  payload: AccountExportPayload,
  targetUserId: string,
  maps: ImportIdMaps,
): Promise<PreviewResult["conflicts"]> {
  const conflicts: PreviewResult["conflicts"] = [];
  for (const config of PORTABLE_TABLES) {
    if (config.readOnly) continue;
    for (const row of payload.tables[config.name] || []) {
      const sourceId = sourceRowId(config, row);
      if (await shouldSkipExistingTarget(admin, config, row, targetUserId, maps)) {
        conflicts.push({
          table: config.name,
          source_id: sourceId,
          reason: config.name === "agent_configs"
            ? "Target account already has this resident agent configuration."
            : "Target account already has a row for this merge key.",
        });
      }
    }
  }
  return conflicts;
}

async function buildMinimalPayloadForIdMaps(
  admin: SupabaseAdmin,
  resolved: ChunkedResolvedArchive,
): Promise<AccountExportPayload> {
  const tables: Record<string, JsonRecord[]> = {};
  for (const config of PORTABLE_TABLES) tables[config.name] = [];

  for await (const { config, rows } of iterateArchiveTableRows(admin, resolved)) {
    const target = tables[config.name] || [];
    for (const row of rows) {
      const minimal = minimalRowForIdMap(config, row);
      if (sourceRowId(config, minimal)) target.push(minimal);
    }
    tables[config.name] = target;
  }

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    export_id: resolved.archive.export_id,
    exported_at: resolved.archive.exported_at,
    source_user_id: resolved.archive.source_user_id,
    manifest: resolved.archive.manifest,
    tables,
    assets: resolved.archive.assets || [],
    warnings: resolved.archive.warnings || [],
  };
}

async function collectImportConflictsForArchive(
  admin: SupabaseAdmin,
  resolved: ChunkedResolvedArchive,
  targetUserId: string,
  maps: ImportIdMaps,
): Promise<PreviewResult["conflicts"]> {
  const conflicts: PreviewResult["conflicts"] = [];
  for await (const { config, rows } of iterateArchiveTableRows(admin, resolved)) {
    if (config.readOnly) continue;
    if (!config.singleton && config.name !== "agent_configs") continue;
    for (const row of rows) {
      const sourceId = sourceRowId(config, row);
      if (await shouldSkipExistingTarget(admin, config, row, targetUserId, maps)) {
        conflicts.push({
          table: config.name,
          source_id: sourceId,
          reason: config.name === "agent_configs"
            ? "Target account already has this resident agent configuration."
            : "Target account already has a row for this merge key.",
        });
      }
    }
  }
  return conflicts;
}

async function* iterateArchiveRows(
  admin: SupabaseAdmin,
  resolved: ResolvedArchive,
  tableName: string,
): AsyncGenerator<JsonRecord[]> {
  if (resolved.kind === "full") {
    const rows = resolved.payload.tables[tableName] || [];
    for (const batch of chunk(rows, 500)) yield batch;
    return;
  }
  for await (const item of iterateArchiveTableRows(admin, resolved, tableName)) {
    yield item.rows;
  }
}

async function* iterateArchiveTableRows(
  admin: SupabaseAdmin,
  resolved: ChunkedResolvedArchive,
  tableName?: string,
): AsyncGenerator<{ config: PortableTableConfig; rows: JsonRecord[] }> {
  const configByName = new Map(PORTABLE_TABLES.map((config) => [config.name, config]));
  const refs = [...resolved.archive.chunks]
    .filter((ref) => !tableName || ref.table === tableName)
    .sort((a, b) => a.index - b.index);
  if (refs.length === 0) return;
  const context = await createArchiveDecryptContext(resolved.passphrase, resolved.archive.encryption);

  for (const ref of refs) {
    const config = configByName.get(ref.table);
    if (!config) continue;
    const encryptedChunk = await downloadArchiveChunk(admin, ref);
    const rows = await decryptArchiveRowsChunk(encryptedChunk, context);
    yield { config, rows };
  }
}

async function downloadArchiveChunk(
  admin: SupabaseAdmin,
  ref: AccountExportChunkRef,
): Promise<EncryptedArchiveChunk> {
  const text = typeof ref.inline_payload === "string" && ref.inline_payload.length > 0
    ? ref.inline_payload
    : await downloadArchiveChunkText(admin, ref);
  const actualHash = await sha256Text(text);
  if (actualHash !== ref.sha256) throw new Error(`Export chunk ${ref.index} failed integrity check`);
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Export chunk ${ref.index} is invalid`);
  return parsed as EncryptedArchiveChunk;
}

async function downloadArchiveChunkText(
  admin: SupabaseAdmin,
  ref: AccountExportChunkRef,
): Promise<string> {
  const { data, error } = await admin.storage.from(ref.storage_bucket).download(ref.storage_path);
  if (error || !data) throw new Error(`Could not read export chunk ${ref.index}: ${error?.message || "missing"}`);
  return data.text();
}

function archiveShellPayload(archive: ChunkedEncryptedArchive): AccountExportPayload {
  return {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    export_id: archive.export_id,
    exported_at: archive.exported_at,
    source_user_id: archive.source_user_id,
    manifest: archive.manifest,
    tables: {},
    assets: archive.assets || [],
    warnings: archive.warnings || [],
  };
}

function minimalRowForIdMap(config: PortableTableConfig, row: JsonRecord): JsonRecord {
  const minimal: JsonRecord = {};
  if (config.idColumn && row[config.idColumn] !== undefined) minimal[config.idColumn] = row[config.idColumn];
  if (config.userColumn && row[config.userColumn] !== undefined) minimal[config.userColumn] = row[config.userColumn];
  if (config.agentColumn && row[config.agentColumn] !== undefined) minimal[config.agentColumn] = row[config.agentColumn];
  if (row.doc_type !== undefined) minimal.doc_type = row.doc_type;
  return minimal;
}

async function shouldSkipExistingTarget(
  admin: SupabaseAdmin,
  config: PortableTableConfig,
  source: JsonRecord,
  targetUserId: string,
  maps: ImportIdMaps,
): Promise<boolean> {
  if (config.name === "agent_configs") {
    const sourceId = typeof source.id === "string" ? source.id : "";
    const targetId = sourceId ? maps.ids.agent_configs?.[sourceId] || sourceId : "";
    if (!targetId || !isResidentAgent(targetId)) return false;
    const { data } = await admin
      .from("agent_configs")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("id", targetId)
      .maybeSingle();
    return Boolean(data);
  }

  if (!config.singleton || !config.onConflict) return false;

  let query = admin.from(config.name).select(config.idColumn || config.userColumn || "*");
  for (const column of config.onConflict.split(",").map((item) => item.trim()).filter(Boolean)) {
    const value = conflictColumnValue(column, config, source, targetUserId, maps);
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

function conflictColumnValue(
  column: string,
  config: PortableTableConfig,
  source: JsonRecord,
  targetUserId: string,
  maps: ImportIdMaps,
): string | number | boolean | null {
  if (column === config.userColumn || column === "user_id") return targetUserId;
  if (column === config.agentColumn || column === "agent_id") {
    const agent = typeof source[column] === "string" ? source[column] : "";
    return maps.agents[agent] || agent;
  }
  const value = source[column];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ? value
    : null;
}

function buildMapRow(
  config: PortableTableConfig,
  row: JsonRecord,
  targetUserId: string,
  importJobId: string,
  maps: ImportIdMaps,
): JsonRecord | null {
  const sourceId = sourceRowId(config, row);
  const targetId = sourceId ? maps.ids[config.name]?.[sourceId] || sourceId : "";
  if (!sourceId || !targetId) return null;
  const sourceAgent = config.agentColumn && typeof row[config.agentColumn] === "string"
    ? row[config.agentColumn] as string
    : null;
  return {
    job_id: importJobId,
    user_id: targetUserId,
    table_name: config.name,
    source_id: sourceId,
    target_id: targetId,
    source_agent_id: sourceAgent,
    target_agent_id: sourceAgent ? maps.agents[sourceAgent] || sourceAgent : null,
  };
}

async function insertRowMaps(admin: SupabaseAdmin, mapRows: JsonRecord[]): Promise<void> {
  for (const mapBatch of chunk(mapRows, 500)) {
    if (mapBatch.length === 0) continue;
    const { error } = await admin.from("account_portability_row_map").insert(mapBatch);
    if (error) throw new Error(`Could not record import provenance: ${error.message}`);
  }
}

function buildDeferredColumnUpdates(
  config: PortableTableConfig,
  batch: Array<{ source: JsonRecord; target: JsonRecord }>,
  maps: ImportIdMaps,
  warnings: string[],
): DeferredColumnUpdate[] {
  if (!config.idColumn || !config.deferredRemapColumns) return [];
  const updates: DeferredColumnUpdate[] = [];
  for (const item of batch) {
    const targetRowId = typeof item.target[config.idColumn] === "string" ? item.target[config.idColumn] as string : "";
    if (!targetRowId) continue;
    for (const [column, tableName] of Object.entries(config.deferredRemapColumns)) {
      const sourceValue = item.source[column];
      if (typeof sourceValue !== "string" || !sourceValue) continue;
      const targetValue = maps.ids[tableName]?.[sourceValue];
      if (!targetValue) {
        warnings.push(`${config.name}:${sourceRowId(config, item.source)} deferred reference ${column} could not be restored.`);
        continue;
      }
      updates.push({
        table: config.name,
        idColumn: config.idColumn,
        targetRowId,
        column,
        value: targetValue,
      });
    }
  }
  return updates;
}

async function applyDeferredColumnUpdates(
  admin: SupabaseAdmin,
  targetUserId: string,
  updates: DeferredColumnUpdate[],
  warnings: string[],
): Promise<void> {
  for (const update of updates) {
    const { error } = await admin
      .from(update.table)
      .update({ [update.column]: update.value })
      .eq("user_id", targetUserId)
      .eq(update.idColumn, update.targetRowId);
    if (error) throw new Error(`Import failed while restoring ${update.table}.${update.column}: ${error.message}`);
  }
  if (updates.length > 0) warnings.push(`Restored ${updates.length} deferred portability reference${updates.length === 1 ? "" : "s"} after row import.`);
}

async function ensureImportedHypomnemaContinuity(
  admin: SupabaseAdmin,
  targetUserId: string,
  importJobId: string,
): Promise<{ created: number; rowMaps: number; warnings: string[] }> {
  try {
    const { data, error } = await admin
      .from("account_portability_row_map")
      .select("target_id,target_agent_id")
      .eq("user_id", targetUserId)
      .eq("job_id", importJobId)
      .eq("table_name", "hypomnema_entry");
    if (error) throw new Error(error.message);

    const byAgent = new Map<string, number>();
    for (const row of data || []) {
      const agentId = typeof row.target_agent_id === "string" ? row.target_agent_id : "";
      if (!shouldBridgeHypomnemaAgent(agentId)) continue;
      byAgent.set(agentId, (byAgent.get(agentId) || 0) + 1);
    }
    if (byAgent.size === 0) return { created: 0, rowMaps: 0, warnings: [] };

    const warnings: string[] = [];
    let created = 0;
    let rowMaps = 0;
    for (const [agentId, importedCount] of byAgent.entries()) {
      const { count, error: activeError } = await admin
        .from("hypomnema_entry")
        .select("id", { count: "exact", head: true })
        .eq("user_id", targetUserId)
        .eq("agent_id", agentId)
        .eq("active", true);
      if (activeError) {
        warnings.push(`Could not verify active hypomnema continuity for ${agentId}: ${activeError.message}`);
        continue;
      }
      if ((count || 0) > 0) continue;

      const { data: inserted, error: insertError } = await admin
        .from("hypomnema_entry")
        .insert({
          user_id: targetUserId,
          agent_id: agentId,
          content: "i'm carrying a restored account history here. the old hypomnema entries came through as imported prior context rather than active attention, so this bridge exists to keep the relationship from being treated as first contact while the imported substrate settles.",
          density: "primary",
          primary_in_thread: true,
          domain: "meta",
          tags: ["account-portability", "continuity", "restored"],
          confidence: 0.72,
          source: "onboarding",
          foundational: true,
          active_attention: true,
          meta: {
            account_portability: {
              bridge: true,
              import_job_id: importJobId,
              imported_hypomnema_rows: importedCount,
              target_agent_id: agentId,
              imported_at: new Date().toISOString(),
            },
          },
        })
        .select("id")
        .single();
      const targetId = typeof inserted?.id === "string" ? inserted.id : "";
      if (insertError || !targetId) {
        warnings.push(`Could not add hypomnema continuity bridge for ${agentId}: ${insertError?.message || "unknown error"}`);
        continue;
      }

      try {
        await insertRowMaps(admin, [{
          job_id: importJobId,
          user_id: targetUserId,
          table_name: "hypomnema_entry",
          source_id: `account-portability-continuity-bridge:${agentId}`,
          target_id: targetId,
          source_agent_id: agentId,
          target_agent_id: agentId,
        }]);
      } catch (mapError) {
        await admin
          .from("hypomnema_entry")
          .delete()
          .eq("user_id", targetUserId)
          .eq("id", targetId);
        warnings.push(`Could not track hypomnema continuity bridge for ${agentId}: ${mapError instanceof Error ? mapError.message : "unknown error"}`);
        continue;
      }
      created += 1;
      rowMaps += 1;
      warnings.push(`Added a hypomnema continuity bridge for ${agentId} because ${importedCount} imported hypomnema row${importedCount === 1 ? "" : "s"} were not active after restore.`);
    }
    return { created, rowMaps, warnings };
  } catch (error) {
    return {
      created: 0,
      rowMaps: 0,
      warnings: [`Hypomnema continuity bridge check failed: ${error instanceof Error ? error.message : "unknown error"}`],
    };
  }
}

function shouldBridgeHypomnemaAgent(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "observer" || normalized === "guardian") return false;
  if (normalized.startsWith("classic:")) return false;
  return true;
}

function uniqueRefs(refs: Array<{ bucket: string; path: string }>): Array<{ bucket: string; path: string }> {
  const map = new Map<string, { bucket: string; path: string }>();
  for (const ref of refs) {
    if (!ref.bucket || !ref.path) continue;
    map.set(`${ref.bucket}/${ref.path}`, ref);
  }
  return [...map.values()];
}

function base64ToUint8(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function importBatchSizeFor(config: PortableTableConfig): number {
  return config.importBatchSize ?? 200;
}

function isResidentAgent(agentId: string): boolean {
  return ["luca", "anima", "vektor", "observer", "guardian"].includes(agentId);
}

function safeStorageName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "table";
}
