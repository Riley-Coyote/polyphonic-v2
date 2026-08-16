# Export failures: diagnosis and fix

## What I found

The user's export is not hitting a configured size limit — it is running out of memory in the export worker at the very last step, and the job then dies silently.

Evidence from the live database and storage:

- The affected account has run 7 exports since yesterday (02:00–09:16 UTC today). All 7 are still `status = "processing"`, with empty `errors`, no file name, and no completion time. Nothing ever marked them failed.
- Every attempt writes exactly the same 69 encrypted chunks (~27 MB) in ~30 seconds, and always stops right after the last table (`crisis_events`). Then it dies — the final archive file is never written.
- Their last successful export was Aug 11 (68 chunks, final archive 67 MB). Since then their data grew: engrams 2,647 → 2,884, mnemos states 2,581 → 2,810, attachments 32 → 38.
- Failed attempts leave their chunks behind: 940 orphaned objects, 623 MB, in the export bucket for this one user.

Root cause: after all table chunks are uploaded, the worker assembles ONE giant JSON string in memory that contains every chunk again (`inline_payload`) plus every storage asset base64-encoded, then uploads it. Peak memory is roughly 2–3x the archive size. At 67 MB it just fit on Aug 11; with the extra data added since, it now exceeds the edge worker's memory ceiling and the isolate is killed outright — which is why no error is ever recorded and the job hangs in "processing" forever (the UI just spins).

Secondary problems the same incident exposes:

- No failure is recorded when the worker is killed, so the user gets no message at all.
- No progress heartbeat, so a hung job is indistinguishable from a slow one.
- Orphaned chunks from failed jobs are never cleaned up (623 MB and growing for this user alone).

## The fix

1. Stream the final archive instead of buffering it
   - Assemble the export file as a stream: write the JSON header, then pipe each chunk's text straight from storage into the upload body one at a time, then the assets, then the footer.
   - Peak memory becomes ~one chunk instead of the whole archive, so exports scale with account size instead of falling off a cliff.
   - The downloaded `.polyphonic-export` file stays byte-compatible and self-contained, so existing import/restore keeps working unchanged.

2. Keep assets out of memory
   - Download-and-encode each asset one at a time into the same stream, and lower the in-archive asset budget so a big attachment set degrades into references with a clear warning instead of killing the job.

3. Make failures visible
   - Heartbeat the job row as each table finishes (tables done / chunks written) so progress is observable.
   - Add a watchdog that marks any export stuck in `processing` past a timeout as `failed` with an actionable message, and surface that message in the export UI instead of an endless spinner.

4. Clean up
   - Delete chunk objects for failed/expired jobs (including the 623 MB currently orphaned), and mark the 7 zombie jobs as failed so the user can retry cleanly.

5. Verify
   - Re-run the export for the affected account end to end, confirm it reaches `completed` with a downloadable file, confirm the row counts match the tables, and confirm an import preview of the resulting file parses.

## Technical notes

- `supabase/functions/_shared/account-portability/server.ts` — `createChunkedAccountExport` (chunk loop, `inline_payload`, final `JSON.stringify(archive)` + upload) is where the memory blowup is; `runChunkedAccountExportJob`'s catch never runs on an OOM kill.
- Streamed upload will go through the storage REST endpoint with a `ReadableStream` body, since the JS client's `upload` wants a Blob.
- Asset caps live at the top of the same file (`MAX_BUNDLED_ASSETS`, `MAX_SINGLE_ASSET_BYTES`, `MAX_TOTAL_BUNDLED_ASSET_BYTES`).
- Watchdog can be a scheduled sweep plus a check inside `account-portability-status` so a stale job is reported the moment the user polls.
- No schema change is strictly required; an optional `progress` jsonb column on `account_portability_jobs` would make the heartbeat cleaner (currently it would go into `manifest`/`warnings`).
