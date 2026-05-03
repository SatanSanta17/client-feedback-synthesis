# TRD-032: Video Upload and Transcription

> **Status:** Parts 1–3 — Implemented (closes-out audits done). Part 4 — Draft.
>
> Mirrors **PRD-032**. Each part maps to the corresponding PRD part.
>
> **Forward compatibility (full PRD scope):**
> - **Part 2** (server transcription + persistence) replaces the Part 1 stub with a real Whisper call via the AI provider abstraction (`@ai-sdk/openai` `experimental_transcribe`), makes `session_attachments.storage_path` nullable for transcript-only rows, and adds two persistence paths: client-driven on session save, and server-driven auto-persist when the saved session is already known.
> - **Part 3** (transcript UX, including editing per PRD P3.R7) **adds a single column** to `session_attachments` (`last_edited_at TIMESTAMPTZ NULL`) and a single new endpoint method (`PATCH` on the existing attachment route) for transcript edits. Most of P3 ships as side-effects of Parts 1–2: P3.R2 (no download button) was the defensive Part 2 patch; P3.R3 (inline view) inherits from PRD-013's "View content" toggle; P3.R4 (past-session paperclip + count) inherits from PRD-013's `attachment_count`; P3.R5 (re-extraction includes transcripts) inherits from `composeAIInput`'s structural compatibility with the transcript shape (Part 1 Increment 1.5); P3.R6 (adding video to existing sessions) inherits from Part 2's auto-persist branch. Only **P3.R1** (visual sub-label) and **P3.R7** (editable transcripts) are genuinely new work.
> - **Part 4** (edge cases and limits) is mostly verification of behaviour shipped in Parts 1–3 plus one substantive addition. P4.R1 / P4.R2 (OOM and codec failure messages) ship verbatim in Part 1 via `mapToVideoUploadError`; Part 4 refines the heuristic patterns to recognise `RangeError` and `WebAssembly.RuntimeError` explicitly. P4.R3 (`MAX_ATTACHMENTS`) is enforced from Part 1 (client) and Part 2 (server). P4.R5 (audio-only files rejected) is enforced today via the extension whitelist — no audio extension is in `ACCEPTED_EXTENSIONS` or `VIDEO_EXTENSIONS`, so audio uploads surface the existing "not a supported format" toast. P4.R6 (empty-edit rejection) shipped in Part 3 with verbatim messages on both client and server. The only genuinely-new functional work is **P4.R4 — sequential video processing**: a concurrency-1 limit on actively-running pipelines at the `<VideoAttachmentSection>` level, with queued items rendered as "Waiting…" placeholder cards.

---

## Part 1: Client-side audio extraction and upload

> Implements **P1.R1–P1.R9** from PRD-032.
>
> References full PRD scope:
> - The audio-upload endpoint contract here is what Part 2 will fully implement. Wire-format and authentication boundaries are locked in this part.
> - The pending-attachment shape here will be reused by Part 3 (saved video transcript attachments share the same `source_format: "video_transcript"` discriminator).
> - The cancellation, wake-lock, and tab-close-guard hooks introduced here are reused by every subsequent video-related interaction in Parts 3 and 4.

### Overview

Add video upload as a new path through the existing `FileUploadZone`. When the user picks a video, the file is probed for duration in the browser, audio is extracted client-side via `ffmpeg.wasm` running in a Web Worker, and the resulting compressed audio is POSTed to a new transcription endpoint. The original video never leaves the device. The capture form gains a "processing video" banner, requests a screen wake lock, and installs a tab-close guard for the duration of the work. A new per-attachment state machine drives the UI from probe → extract → upload → transcribe → completed | cancelled | error.

No persistence in this part — the returned transcript joins the existing `pendingAttachments` client state under a new `kind: "video_transcript"` variant. Persisting it to `session_attachments` is Part 2.

### Dependencies (npm)

| Package | Purpose | Version |
|---|---|---|
| `@ffmpeg/ffmpeg` | High-level wrapper around `ffmpeg.wasm` (Web Worker orchestration, message protocol) | ^0.12 |
| `@ffmpeg/util` | Helpers (`fetchFile`, `toBlobURL`) for loading binary assets | ^0.12 |
| `@ffmpeg/core` | Single-threaded WebAssembly core (no `SharedArrayBuffer` / no COOP-COEP requirement) | ^0.12 |

Single-threaded core chosen deliberately to avoid `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers (PRD trade-off). All three packages are pulled at install time and the `core` artefacts are copied into `public/ffmpeg/` at build time so they are served from our origin (no third-party CDN at runtime — privacy + reliability).

No new server-side dependency in this part. Whisper / `@ai-sdk/openai` is added in Part 2.

### Database Changes

None in Part 1. The `session_attachments.storage_path` nullable migration and the `video_transcript` `source_format` value are introduced in Part 2.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | **Modify** | Add `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core` |
| `public/ffmpeg/ffmpeg-core.js` | **Create** | Self-hosted `ffmpeg-core.js` (copied from `node_modules/@ffmpeg/core/dist/umd/`) |
| `public/ffmpeg/ffmpeg-core.wasm` | **Create** | Self-hosted core WASM binary |
| `scripts/copy-ffmpeg-assets.mjs` | **Create** | Postinstall step that copies core assets into `public/ffmpeg/` |
| `next.config.ts` | **Modify** | Add `Cache-Control: public, max-age=31536000, immutable` for `/ffmpeg/*` |
| `lib/constants.ts` | **Modify** | Add video-specific constants (extensions, MIME types, size + duration caps, target audio params) |
| `lib/types/video-attachment.ts` | **Create** | Discriminated-union type for `PendingAttachment` (parsed file vs. video transcript) + `VideoUploadState` machine |
| `lib/utils/video/probe-video-metadata.ts` | **Create** | Read duration via `<video>` element — no ffmpeg required |
| `lib/utils/video/extract-audio.ts` | **Create** | Lazy-loads `ffmpeg.wasm`, runs extraction, surfaces progress + abort |
| `lib/utils/video/upload-audio.ts` | **Create** | XHR-based upload with progress + `AbortController` |
| `lib/utils/video/can-process-video.ts` | **Create** | Browser capability gate (Worker, WASM, video element support) |
| `lib/hooks/use-wake-lock.ts` | **Create** | React hook around `navigator.wakeLock` |
| `lib/hooks/use-beforeunload-guard.ts` | **Create** | React hook installing `beforeunload` + Next.js navigation guard |
| `lib/hooks/use-video-attachment.ts` | **Create** | State machine driving probe → extract → upload → transcribe per attachment |
| `app/capture/_components/file-upload-zone.tsx` | **Modify** | Accept video MIME types + extensions; route video files into the video pipeline; suppress for unsupported browsers |
| `app/capture/_components/attachment-list.tsx` | **Modify** | Render the new `kind: "video_transcript"` variant via a dedicated card; share the same parent list to keep ordering and counts correct |
| `app/capture/_components/video-attachment-card.tsx` | **Create** | Per-video card UI: state-driven progress, cancel, error states |
| `app/capture/_components/processing-video-banner.tsx` | **Create** | Persistent banner shown while any video is processing |
| `app/capture/_components/session-capture-form.tsx` | **Modify** | Wire wake lock, beforeunload guard, banner, and the new variant in `pendingAttachments` |
| `app/capture/_components/expanded-session-row.tsx` | **Modify** | Same wiring as capture form for the past-session edit path |
| `app/api/files/transcribe/route.ts` | **Create** | Transcription endpoint — Part 1 stub (validates + returns mock transcript). Part 2 replaces with real Whisper integration. |

### Implementation

#### Increment 1.1: Constants, types, browser capability gate

**What:** Establish the typed surface every later increment depends on. No UI yet.

**Files:**

1. **Modify `lib/constants.ts`**

   Add (do not modify existing constants — they remain authoritative for non-video uploads per PRD scope):

   ```typescript
   // Video upload (PRD-032)
   export const VIDEO_MIME_TYPES = {
     "video/mp4": [".mp4"],
     "video/quicktime": [".mov"],
     "video/webm": [".webm"],
   } as const;

   export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

   // Hard caps from PRD P1.R2
   export const MAX_VIDEO_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
   export const MAX_VIDEO_DURATION_SECONDS = 2 * 60 * 60;       // 2 hours

   // Audio extraction parameters (PRD P1.R3) — tuned for speech-to-text, not playback
   export const AUDIO_EXTRACTION_PARAMS = {
     sampleRate: 16_000,
     channels: 1,
     bitrate: "32k",
     container: "mp3",     // Whisper accepts mp3/m4a/mp4/mpga/wav/webm — mp3 is the most portable
     mimeType: "audio/mpeg",
     extension: ".mp3",
   } as const;

   // Self-hosted ffmpeg core URLs (served from our origin — no third-party CDN at runtime)
   export const FFMPEG_CORE_URL = "/ffmpeg/ffmpeg-core.js";
   export const FFMPEG_WASM_URL = "/ffmpeg/ffmpeg-core.wasm";
   ```

   The `ACCEPTED_FILE_TYPES` and `ACCEPTED_EXTENSIONS` constants are **not modified** — non-video uploads are explicitly out of scope per PRD. Video acceptance is layered on top via a separate constant set the upload zone reads independently.

2. **Create `lib/types/video-attachment.ts`**

   ```typescript
   export type PendingAttachment =
     | {
         kind: "parsed";
         file: File;
         parsed_content: string;
         file_name: string;
         file_type: string;
         file_size: number;
         source_format: "whatsapp" | "slack" | "generic";
       }
     | {
         kind: "video_transcript";
         parsed_content: string;
         file_name: string;          // original video file name
         file_type: string;          // original video MIME
         file_size: number;          // original video size in bytes
         duration_seconds: number;
         source_format: "video_transcript";
         is_edited?: false;          // reserved for Part 3 (PRD P3.R7); always false in Part 1
       };

   export type VideoAttachmentId = string; // crypto.randomUUID() — client-only, used as React key + state-machine key

   export type VideoUploadState =
     | { status: "queued" }
     | { status: "probing" }
     | { status: "extracting"; progress: number }   // 0..1
     | { status: "uploading"; progress: number }    // 0..1
     | { status: "transcribing" }                   // server work, no progress signal
     | { status: "completed"; attachment: Extract<PendingAttachment, { kind: "video_transcript" }> }
     | { status: "cancelled" }
     | { status: "error"; error: VideoUploadError };

   export type VideoUploadError =
     | { code: "FILE_TOO_LARGE"; message: string }
     | { code: "DURATION_TOO_LONG"; message: string }
     | { code: "UNSUPPORTED_BROWSER"; message: string }
     | { code: "EXTRACTION_OOM"; message: string }     // PRD P4.R1 — surfaces in Part 1 transitions, message text in Part 4
     | { code: "EXTRACTION_FAILED"; message: string }  // PRD P4.R2
     | { code: "UPLOAD_FAILED"; message: string }
     | { code: "TRANSCRIPTION_FAILED"; message: string }
     | { code: "EMPTY_TRANSCRIPT"; message: string };  // P2.R8 — defined now, raised in Part 2
   ```

   Discriminated unions per CLAUDE.md ("Discriminated unions for state machines"). The `is_edited` field is declared only on the `video_transcript` variant and reserved for PRD P3.R7 — Part 1 sets it to literal `false` (or omits it), Part 3 widens the type.

3. **Create `lib/utils/video/can-process-video.ts`**

   ```typescript
   export function canProcessVideoInBrowser(): { ok: true } | { ok: false; reason: string } {
     if (typeof window === "undefined") return { ok: false, reason: "server" };
     if (typeof Worker === "undefined") return { ok: false, reason: "Web Worker not supported" };
     if (typeof WebAssembly === "undefined") return { ok: false, reason: "WebAssembly not supported" };
     if (typeof document.createElement("video").canPlayType !== "function") {
       return { ok: false, reason: "video element not supported" };
     }
     return { ok: true };
   }
   ```

   Called once on mount of `FileUploadZone` (Increment 1.4). Result drives whether `.mp4/.mov/.webm` are advertised in `accept` and whether the user-facing tooltip is shown (PRD P1.R8).

#### Increment 1.2: Probe + audio-extraction utilities

**What:** Pure functions / classes that own the heavy lifting. No React. Built and unit-tested in isolation before any UI wires them up.

**Files:**

1. **Create `lib/utils/video/probe-video-metadata.ts`**

   ```typescript
   export interface VideoMetadata {
     duration_seconds: number;
   }

   /**
    * Reads duration via a hidden <video preload="metadata"> element.
    * Does not decode video — only metadata is fetched.
    * Throws on metadata-load failure (corrupt container, unsupported codec).
    */
   export function probeVideoMetadata(file: File, signal?: AbortSignal): Promise<VideoMetadata> {
     return new Promise((resolve, reject) => {
       const url = URL.createObjectURL(file);
       const video = document.createElement("video");
       video.preload = "metadata";
       video.muted = true;

       const cleanup = () => {
         URL.revokeObjectURL(url);
         video.remove();
       };

       const onLoaded = () => {
         const d = video.duration;
         cleanup();
         if (!Number.isFinite(d) || d <= 0) {
           reject(new Error("Could not read video duration"));
         } else {
           resolve({ duration_seconds: d });
         }
       };

       const onError = () => {
         cleanup();
         reject(new Error("Could not read video metadata"));
       };

       const onAbort = () => {
         cleanup();
         reject(new DOMException("Aborted", "AbortError"));
       };

       video.addEventListener("loadedmetadata", onLoaded, { once: true });
       video.addEventListener("error", onError, { once: true });
       signal?.addEventListener("abort", onAbort, { once: true });

       video.src = url;
     });
   }
   ```

   No ffmpeg invoked yet — keeps the duration check fast (sub-second on most files) and rejects oversize/over-duration uploads before paying the ffmpeg.wasm load cost.

2. **Create `lib/utils/video/extract-audio.ts`**

   Wraps `@ffmpeg/ffmpeg`. Lazy-imported via dynamic `import()` so the ~25 MB core never enters the main bundle.

   ```typescript
   import {
     AUDIO_EXTRACTION_PARAMS,
     FFMPEG_CORE_URL,
     FFMPEG_WASM_URL,
   } from "@/lib/constants";

   export interface ExtractAudioOptions {
     onProgress?: (fraction: number) => void; // 0..1
     signal?: AbortSignal;
   }

   export interface ExtractedAudio {
     blob: Blob;
     mimeType: string;     // "audio/mpeg"
     extension: string;    // ".mp3"
   }

   export async function extractAudioFromVideo(
     file: File,
     opts: ExtractAudioOptions = {},
   ): Promise<ExtractedAudio> {
     const { onProgress, signal } = opts;

     // Lazy-load — first call pays the ~25 MB core download, subsequent calls are cached by the browser
     const { FFmpeg } = await import("@ffmpeg/ffmpeg");
     const { fetchFile } = await import("@ffmpeg/util");

     const ffmpeg = new FFmpeg();

     ffmpeg.on("progress", ({ progress }) => {
       if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
     });

     // load() fetches core + wasm from our /ffmpeg/* path (self-hosted, immutable cache)
     await ffmpeg.load({ coreURL: FFMPEG_CORE_URL, wasmURL: FFMPEG_WASM_URL });

     if (signal?.aborted) {
       ffmpeg.terminate();
       throw new DOMException("Aborted", "AbortError");
     }
     signal?.addEventListener("abort", () => ffmpeg.terminate(), { once: true });

     const inputName = "input" + (file.name.match(/\.[^.]+$/)?.[0] ?? ".mp4");
     const outputName = "output" + AUDIO_EXTRACTION_PARAMS.extension;

     try {
       await ffmpeg.writeFile(inputName, await fetchFile(file));

       // -vn: drop video stream
       // -ac 1: mono
       // -ar 16000: 16 kHz sample rate
       // -b:a 32k: target bitrate
       // -f mp3: MP3 container
       await ffmpeg.exec([
         "-i", inputName,
         "-vn",
         "-ac", String(AUDIO_EXTRACTION_PARAMS.channels),
         "-ar", String(AUDIO_EXTRACTION_PARAMS.sampleRate),
         "-b:a", AUDIO_EXTRACTION_PARAMS.bitrate,
         "-f", AUDIO_EXTRACTION_PARAMS.container,
         outputName,
       ]);

       const data = await ffmpeg.readFile(outputName);
       const buffer = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
       const blob = new Blob([buffer], { type: AUDIO_EXTRACTION_PARAMS.mimeType });

       return {
         blob,
         mimeType: AUDIO_EXTRACTION_PARAMS.mimeType,
         extension: AUDIO_EXTRACTION_PARAMS.extension,
       };
     } finally {
       // Always release the ffmpeg instance — frees the WASM heap
       try {
         ffmpeg.terminate();
       } catch {
         // best-effort; nothing to recover
       }
     }
   }
   ```

   Notes for Part 4 forward compat:
   - OOM during `ffmpeg.load()` or `ffmpeg.exec()` surfaces as a thrown error; the calling state machine (Increment 1.4) maps it to `EXTRACTION_OOM` based on error message inspection. Part 4 refines the heuristic.
   - Codec/corruption failures throw from `ffmpeg.exec()` and map to `EXTRACTION_FAILED`.

3. **Create `lib/utils/video/upload-audio.ts`**

   XHR rather than `fetch` — `fetch` does not expose upload-progress events and we want the per-attachment progress bar to be honest, not a spinner-fake.

   ```typescript
   export interface UploadAudioInput {
     audio: Blob;
     audioFileName: string;          // e.g. "<uuid>.mp3"
     videoFileName: string;
     videoFileType: string;
     videoFileSize: number;
     durationSeconds: number;
   }

   export interface UploadAudioResult {
     parsed_content: string;
     file_name: string;
     file_type: string;
     file_size: number;
     duration_seconds: number;
     source_format: "video_transcript";
   }

   export interface UploadAudioOptions {
     onUploadProgress?: (fraction: number) => void;
     signal?: AbortSignal;
   }

   export function uploadAudioForTranscription(
     input: UploadAudioInput,
     opts: UploadAudioOptions = {},
   ): Promise<UploadAudioResult> {
     return new Promise((resolve, reject) => {
       const xhr = new XMLHttpRequest();
       xhr.open("POST", "/api/files/transcribe");
       xhr.responseType = "json";

       xhr.upload.addEventListener("progress", (e) => {
         if (e.lengthComputable && opts.onUploadProgress) {
           opts.onUploadProgress(e.loaded / e.total);
         }
       });

       xhr.addEventListener("load", () => {
         if (xhr.status >= 200 && xhr.status < 300) {
           resolve(xhr.response as UploadAudioResult);
         } else {
           const message = (xhr.response && (xhr.response as { message?: string }).message) ?? "Transcription failed";
           reject(new Error(message));
         }
       });

       xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
       xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
       opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

       const fd = new FormData();
       fd.append("audio", input.audio, input.audioFileName);
       fd.append("video_file_name", input.videoFileName);
       fd.append("video_file_type", input.videoFileType);
       fd.append("video_file_size", String(input.videoFileSize));
       fd.append("duration_seconds", String(input.durationSeconds));

       xhr.send(fd);
     });
   }
   ```

   The wire format (multipart fields + response shape) is the contract Part 2 must honour. It is intentionally locked down here.

#### Increment 1.3: React hooks (wake lock, beforeunload, video attachment state machine)

**What:** Compose the utilities from 1.2 into React-shaped primitives. Hooks live in `lib/hooks/` per CLAUDE.md.

**Files:**

1. **Create `lib/hooks/use-wake-lock.ts`**

   ```typescript
   "use client";

   import { useEffect, useRef } from "react";

   /**
    * Requests a screen wake lock while `active` is true.
    * Re-acquires on tab visibility change (browsers release the lock when the tab is hidden).
    * No-op (with a console.warn) when the API is unavailable.
    */
   export function useWakeLock(active: boolean): void {
     const sentinelRef = useRef<WakeLockSentinel | null>(null);

     useEffect(() => {
       if (!active) return;

       const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
       if (!supported) {
         console.warn("[use-wake-lock] Wake Lock API unavailable in this browser");
         return;
       }

       let cancelled = false;

       const acquire = async () => {
         try {
           const sentinel = await navigator.wakeLock.request("screen");
           if (cancelled) {
             await sentinel.release().catch(() => {});
             return;
           }
           sentinelRef.current = sentinel;
           sentinel.addEventListener("release", () => {
             sentinelRef.current = null;
           });
         } catch (err) {
           console.warn("[use-wake-lock] Failed to acquire wake lock:", err);
         }
       };

       const onVisibility = () => {
         if (document.visibilityState === "visible" && !sentinelRef.current) acquire();
       };

       acquire();
       document.addEventListener("visibilitychange", onVisibility);

       return () => {
         cancelled = true;
         document.removeEventListener("visibilitychange", onVisibility);
         sentinelRef.current?.release().catch(() => {});
         sentinelRef.current = null;
       };
     }, [active]);
   }
   ```

2. **Create `lib/hooks/use-beforeunload-guard.ts`**

   Covers two cases:
   - The user closes the tab / refreshes / navigates to an external origin → native `beforeunload` prompt.
   - The user clicks an in-app `<Link>` → Next.js client-side navigation, which `beforeunload` does **not** intercept. We block via `next/navigation`'s `useRouter().push` patch is brittle; instead we expose `router.events`-equivalent via `useEffect` cleanup + a confirm dialog when the user attempts in-app navigation. For Part 1, the simpler, well-supported half is the `beforeunload` listener — in-app navigation guarding is a known Next.js gap and we add a UI warning ("Don't navigate away") rather than intercept programmatically.

   ```typescript
   "use client";

   import { useEffect } from "react";

   export function useBeforeUnloadGuard(active: boolean, message = "Processing in progress. Leave anyway?"): void {
     useEffect(() => {
       if (!active) return;
       const handler = (e: BeforeUnloadEvent) => {
         e.preventDefault();
         e.returnValue = message; // legacy Chrome
         return message;
       };
       window.addEventListener("beforeunload", handler);
       return () => window.removeEventListener("beforeunload", handler);
     }, [active, message]);
   }
   ```

3. **Create `lib/hooks/use-video-attachment.ts`**

   The state machine. One instance per video attachment in flight. Returned object exposes the current state and a `cancel()` method.

   ```typescript
   "use client";

   import { useCallback, useEffect, useRef, useState } from "react";

   import {
     MAX_VIDEO_DURATION_SECONDS,
     MAX_VIDEO_FILE_SIZE_BYTES,
   } from "@/lib/constants";
   import { extractAudioFromVideo } from "@/lib/utils/video/extract-audio";
   import { probeVideoMetadata } from "@/lib/utils/video/probe-video-metadata";
   import { uploadAudioForTranscription } from "@/lib/utils/video/upload-audio";
   import type {
     PendingAttachment,
     VideoUploadError,
     VideoUploadState,
   } from "@/lib/types/video-attachment";

   export interface UseVideoAttachmentOptions {
     onCompleted: (attachment: Extract<PendingAttachment, { kind: "video_transcript" }>) => void;
     onError: (error: VideoUploadError) => void;
   }

   export function useVideoAttachment(
     file: File,
     opts: UseVideoAttachmentOptions,
   ) {
     const [state, setState] = useState<VideoUploadState>({ status: "queued" });
     const abortRef = useRef<AbortController>(new AbortController());
     const startedRef = useRef(false);

     const cancel = useCallback(() => {
       abortRef.current.abort();
       setState({ status: "cancelled" });
     }, []);

     useEffect(() => {
       if (startedRef.current) return;
       startedRef.current = true;

       const ctrl = abortRef.current;

       (async () => {
         try {
           // ── Pre-flight: file size cap (cheap, synchronous) ───────────────
           if (file.size > MAX_VIDEO_FILE_SIZE_BYTES) {
             const err: VideoUploadError = {
               code: "FILE_TOO_LARGE",
               message: "Video files must be 500 MB or smaller.",
             };
             setState({ status: "error", error: err });
             opts.onError(err);
             return;
           }

           // ── Probe duration ──────────────────────────────────────────────
           setState({ status: "probing" });
           const meta = await probeVideoMetadata(file, ctrl.signal);

           if (meta.duration_seconds > MAX_VIDEO_DURATION_SECONDS) {
             const err: VideoUploadError = {
               code: "DURATION_TOO_LONG",
               message: "Video must be 2 hours or shorter.",
             };
             setState({ status: "error", error: err });
             opts.onError(err);
             return;
           }

           // ── Extract audio ───────────────────────────────────────────────
           setState({ status: "extracting", progress: 0 });
           const audio = await extractAudioFromVideo(file, {
             onProgress: (p) => setState({ status: "extracting", progress: p }),
             signal: ctrl.signal,
           });

           // ── Upload + transcribe ─────────────────────────────────────────
           setState({ status: "uploading", progress: 0 });
           const result = await uploadAudioForTranscription(
             {
               audio: audio.blob,
               audioFileName: `${crypto.randomUUID()}${audio.extension}`,
               videoFileName: file.name,
               videoFileType: file.type,
               videoFileSize: file.size,
               durationSeconds: meta.duration_seconds,
             },
             {
               onUploadProgress: (p) => {
                 setState((prev) =>
                   prev.status === "uploading" ? { status: "uploading", progress: p } : prev,
                 );
                 if (p >= 1) setState({ status: "transcribing" });
               },
               signal: ctrl.signal,
             },
           );

           const completed: Extract<PendingAttachment, { kind: "video_transcript" }> = {
             kind: "video_transcript",
             parsed_content: result.parsed_content,
             file_name: result.file_name,
             file_type: result.file_type,
             file_size: result.file_size,
             duration_seconds: result.duration_seconds,
             source_format: "video_transcript",
             is_edited: false,
           };

           setState({ status: "completed", attachment: completed });
           opts.onCompleted(completed);
         } catch (err) {
           if (ctrl.signal.aborted) {
             setState({ status: "cancelled" });
             return;
           }
           const error = mapToVideoUploadError(err);
           setState({ status: "error", error });
           opts.onError(error);
         }
       })();

       return () => {
         ctrl.abort();
       };
       // file is the input identity; opts.onCompleted/onError are stable callbacks from parent
     }, [file, opts]);

     return { state, cancel };
   }

   function mapToVideoUploadError(err: unknown): VideoUploadError {
     const message = err instanceof Error ? err.message : "Unknown error";
     // Memory-related ffmpeg.wasm failures typically include "memory" or "OOM"
     if (/memory|oom|allocation/i.test(message)) {
       return { code: "EXTRACTION_OOM", message: "Your device couldn't process this video. Try a shorter clip or a different device." };
     }
     if (/ffmpeg|exec|invalid|unsupported|codec|format/i.test(message)) {
       return { code: "EXTRACTION_FAILED", message: "This video format couldn't be processed. Try converting to MP4 or use a different recording." };
     }
     if (/network|timed out|aborted/i.test(message)) {
       return { code: "UPLOAD_FAILED", message: "Could not upload audio for transcription. Please try again." };
     }
     return { code: "TRANSCRIPTION_FAILED", message: "Could not transcribe video — please try again." };
   }
   ```

   Forward compat: the `mapToVideoUploadError` heuristic is intentionally minimal in Part 1. Part 4 (PRD P4.R1, P4.R2) refines the mapping (e.g., distinguishing OOM from generic extraction failure with browser-memory introspection). The state-machine surface (`VideoUploadState` + `VideoUploadError` enum) does not change in Part 4 — only the transitions and message copy.

#### Increment 1.4: UI — upload zone, video card, banner

**What:** Render the per-video state machine. Wire it into the existing `FileUploadZone` and `AttachmentList`.

**Files:**

1. **Modify `app/capture/_components/file-upload-zone.tsx`**

   - Branch on extension at file-drop / file-pick time:
     - If extension is in `VIDEO_EXTENSIONS` → emit a `onVideoSelected(file)` callback (new prop).
     - Otherwise → existing `onFileParsed` path is unchanged (calls `/api/files/parse`).
   - Before mounting, call `canProcessVideoInBrowser()`:
     - If `ok: false`: drop video MIME types from the `<input accept>` attribute, drop video extensions from the user-facing accepted-formats hint, and show a `<Tooltip>` on the (now hidden / suppressed) video chip saying "Your browser doesn't support video upload. Use Chrome, Edge, or Firefox on desktop." (PRD P1.R8)
   - The `currentCount` prop (already used for `MAX_ATTACHMENTS` enforcement) covers video transcripts uniformly — they count as attachments per PRD P4.R3.

   New prop on the existing interface:

   ```typescript
   interface FileUploadZoneProps {
     // existing
     onFileParsed: (result: ParsedAttachment) => void;
     disabled?: boolean;
     currentCount: number;
     // new
     onVideoSelected: (file: File) => void;
   }
   ```

   The zone never holds video state itself; selection handoff is immediate. The parent owns the lifecycle.

2. **Create `app/capture/_components/video-attachment-card.tsx`**

   Receives one in-flight video attachment + state machine output. Renders status-specific UI:

   - `queued` → "Queued…" (ghost row).
   - `probing` → "Reading metadata…" with spinner.
   - `extracting` → "Processing video locally — {percent}%" with a progress bar.
   - `uploading` → "Uploading audio — {percent}%" with progress bar.
   - `transcribing` → "Transcribing…" with indeterminate spinner.
   - `completed` → renders the same compact summary that `AttachmentList` uses for parsed attachments (file name, "Transcript only" sub-label, video icon). PRD P3.R1 visual differentiation lands in Part 3; Part 1 ships a placeholder video icon + the "Transcript only" label so the user understands what's happening.
   - `error` → red error card with `error.message` and a "Remove" button.
   - `cancelled` → silently removed by the parent on cancel; this state is rendered for one frame only.

   Each row exposes a "Cancel" / "Remove" (×) button at all stages (PRD P1.R9). On click → calls `cancel()` from the state machine and removes the entry from parent state.

3. **Modify `app/capture/_components/attachment-list.tsx`**

   The list now accepts both `ParsedAttachment` (existing, immutable on render) and *in-flight* video attachments (rendered via `VideoAttachmentCard`). To keep ordering predictable, the parent component (capture form / expanded session row) owns the merged ordered list and just passes it down. The list internally branches:

   ```tsx
   {items.map((item) =>
     item.type === "parsed"
       ? <ParsedAttachmentCard key={item.id} ... />
       : <VideoAttachmentCard key={item.id} ... />
   )}
   ```

   A small helper type `AttachmentListItem` is added to encode this:

   ```typescript
   type AttachmentListItem =
     | { id: string; type: "parsed"; data: ParsedAttachment }
     | { id: string; type: "video_in_flight"; file: File }
     | { id: string; type: "video_completed"; data: Extract<PendingAttachment, { kind: "video_transcript" }> };
   ```

   The `id` is generated by the parent (a `crypto.randomUUID()` per attachment) so the list survives re-renders without reusing keys.

4. **Create `app/capture/_components/processing-video-banner.tsx`**

   A small, sticky-ish status banner (existing UI primitives — `Alert` from shadcn). Shown whenever `anyVideoInFlight === true` (any item in `video_in_flight` state). Copy:
   > "Processing video — please keep this tab open. Background tabs run slower."

   Dismissible? No — non-dismissible per PRD P1.R4.

#### Increment 1.5: Wire into the capture form and expanded session row

**What:** Mount the banner, the wake lock, the beforeunload guard, and the video pipeline in both places where uploads happen.

**Files:**

1. **Modify `app/capture/_components/session-capture-form.tsx`**

   - Replace the `attachments: ParsedAttachment[]` state with the merged `items: AttachmentListItem[]` shape introduced in Increment 1.4. Existing logic (parsed file path) is unchanged in behaviour.
   - Pass `onVideoSelected` to `<FileUploadZone>`. Implementation appends a `{ id, type: "video_in_flight", file }` row to `items`.
   - Render `<AttachmentList>` over `items`. For each `video_in_flight` row, instantiate the `useVideoAttachment` hook inside `VideoAttachmentCard` (the hook's lifecycle is bounded by the card's mount).
   - The card's `onCompleted` callback transitions the row to `{ id, type: "video_completed", data }` and the `onError` callback either marks it errored or removes it (depending on user choice — error rows render until the user clicks Remove).
   - Compute `anyVideoInFlight = items.some((i) => i.type === "video_in_flight")`.
   - Mount `useWakeLock(anyVideoInFlight)` and `useBeforeUnloadGuard(anyVideoInFlight)`.
   - Render `<ProcessingVideoBanner active={anyVideoInFlight} />` near the form header.
   - Update `composeAIInput()` (existing) to also include `video_completed` rows' `parsed_content` under the same `--- Attachment: <name> ---` framing. Their `source_format` is `"video_transcript"` — the prompt-side framing matches the existing parsed-attachment sections so no signal-extraction changes are required.
   - Update `MAX_COMBINED_CHARS` accounting to sum `parsed_content.length` across both parsed and `video_completed` rows.

2. **Modify `app/capture/_components/expanded-session-row.tsx`**

   Same wiring as the capture form, against the existing `pendingAttachments` state. The expanded view does not show saved video transcripts in this part — those are persisted attachments, which arrive in Part 3. In Part 1, only newly-selected videos in the expanded view flow through this pipeline. Behaviour is otherwise identical to the capture form.

#### Increment 1.6: Transcription endpoint stub + asset hosting

**What:** Lock down the server-side wire format. Real Whisper integration ships in Part 2.

**Files:**

1. **Create `app/api/files/transcribe/route.ts`**

   ```
   POST /api/files/transcribe
   Content-Type: multipart/form-data
   Body:
     audio              (File, required)            audio/mpeg
     video_file_name    (string, required)
     video_file_type    (string, required)
     video_file_size    (string→number, required)
     duration_seconds   (string→number, required)

   Response 200:
     {
       parsed_content: string,
       file_name: string,           // = video_file_name
       file_type: string,           // = video_file_type
       file_size: number,           // = video_file_size
       duration_seconds: number,
       source_format: "video_transcript"
     }

   Response 400 — missing/invalid field
   Response 401 — unauthenticated
   Response 413 — audio exceeds server-side hard cap (TBD, conservative ~50 MB to match Whisper's free-tier ceiling)
   Response 500 — generic
   ```

   Part 1 implementation:
   - Auth check via the existing `requireAuth()` helper.
   - Zod-validate the multipart fields (parse numerics from strings).
   - Read `audio` as `Buffer` via `await audio.arrayBuffer()` — but **do not** persist anywhere. The Buffer goes out of scope at the end of the handler. PRD P2.R3.
   - Return a deterministic mock transcript string: `"[mock transcript — Whisper integration pending in Part 2 of PRD-032 — original video: ${video_file_name}, ${duration_seconds}s]"`.
   - Log entry, audio size, duration, exit.

   The mock transcript flowing through to the client lets the rest of the pipeline (state machine, UI states, char counter, signal extraction round-trip) be tested end-to-end. Part 2 swaps the mock body for the real provider call without changing the route signature.

2. **Create `scripts/copy-ffmpeg-assets.mjs`**

   A 15-line Node script that copies `node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.{js,wasm}` into `public/ffmpeg/`. Wired as `postinstall` in `package.json`. Idempotent.

3. **Modify `next.config.ts`**

   Add a `headers()` entry for `/ffmpeg/:path*` returning `Cache-Control: public, max-age=31536000, immutable` so the 25 MB core file is cached on first download. No COOP/COEP changes — single-threaded core does not need them (PRD trade-off).

#### Increment 1.7: End-of-Part audit

**What:** Apply the CLAUDE.md end-of-part audit checklist to all files created or modified in Part 1. Produces fixes, not a report.

**Scope:** every file in the "Files Changed" table.

**Audit emphasis specific to this part:**
1. **SRP** — `use-video-attachment.ts` should not embed UI strings beyond what the state machine needs; user-facing copy lives in components, not the hook. `mapToVideoUploadError` is the one exception (kept inline because the message and the code are paired).
2. **OCP** — `FileUploadZone` accepts videos via composition (the new `onVideoSelected` prop) without modifying the existing parsed-file path.
3. **DIP** — `useVideoAttachment` depends on `extractAudioFromVideo`, `probeVideoMetadata`, `uploadAudioForTranscription` (concrete functions, but each is a single point of mockability for tests). No direct `ffmpeg` import in the hook.
4. **DRY** — confirm that the file-icon helpers from `attachment-list.tsx` are reused by `video-attachment-card.tsx` (extract to a shared `lib/utils/file-icons.ts` if a fork is starting).
5. **Fail explicitly** — every `catch` in the new files logs before mapping; the `try { ... } finally { ffmpeg.terminate() }` pattern preserves errors.
6. **Design tokens** — progress bars, spinners, banner colours pulled from existing CSS variables. No `bg-orange-500`-style hardcodes.
7. **Logging** — `/api/files/transcribe` logs entry, audio size, duration, exit, errors. Client-side utilities log via `console.warn`/`console.error` with a `[video-attachment]` or `[wake-lock]` prefix.
8. **Dead code** — confirm no test/dev imports leak into `lib/utils/video/`. The `is_edited` field is reserved for Part 3 — it is *typed* but not *used* in Part 1 logic; that is intentional, not dead.
9. **Convention compliance** — kebab-case files, named exports, `'use client'` only on hooks/components that need it, hooks file-named `use-*.ts`.

### Summary of Increments

| Increment | Scope | PRD Requirements |
|-----------|-------|------------------|
| 1.1 | Constants, discriminated-union types, browser capability gate | P1.R1, P1.R2 (cap values), P1.R8 (gate) |
| 1.2 | Probe utility + audio-extraction utility + audio-upload utility | P1.R3 (extraction), P1.R7 (upload contract) |
| 1.3 | Hooks: wake lock, beforeunload guard, per-attachment state machine | P1.R5, P1.R6, plus the orchestration backbone for P1.R3/R7/R9 |
| 1.4 | UI components: video card, banner, upload-zone branch | P1.R1, P1.R4, P1.R8, P1.R9 |
| 1.5 | Capture form + expanded session row wiring | P1.R3–P1.R7 (composition) |
| 1.6 | `/api/files/transcribe` stub + ffmpeg asset hosting | P1.R7 (server contract) |
| 1.7 | End-of-Part code-quality audit | Convention compliance |

### Forward Compatibility Notes (for Parts 2–4)

These are not implemented in Part 1 but the design accounts for them:

- **Part 2 — server transcription:** The `/api/files/transcribe` route shape, multipart fields, response schema, and HTTP status codes are locked in Part 1. Part 2 replaces the mock body with a real Whisper / provider-abstracted call and adds the actual retry/backoff. No client-side change is required when Part 2 ships.
- **Part 2 — persistence:** The completed `video_transcript` attachment shape exactly matches what Part 2 will write into `session_attachments` (with `storage_path = NULL`). The `is_edited?: false` reserved field is the seed for the editing flag in Part 3.
- **Part 3 — UX (icon, "Transcript only" label, edit affordance):** `VideoAttachmentCard`'s completed-state render today is the placeholder Part 3 promotes to the final visual treatment. The discriminated-union type already carries everything the editable transcript view needs; only the card swaps.
- **Part 3 — re-extraction parity:** `composeAIInput()` (modified in Increment 1.5) treats `video_transcript` rows identically to other parsed content, so the existing `/api/ai/extract-signals` route is unchanged today and will remain unchanged when Part 3's edits flow through `parsed_content`.
- **Part 4 — edge cases:** `VideoUploadError`'s code enum is the single source of truth for failure UX. Part 4 only refines the heuristics in `mapToVideoUploadError` and adds a sequential-queue policy at the parent (capture form) level — no changes to the state machine or the UI components.
- **Part 4 — sequential video processing:** Part 1 starts video pipelines in parallel as soon as files are dropped (one state machine each, ffmpeg.wasm is per-instance and runs in its own worker). Part 4 adds a queue at the capture-form level that delays mounting `VideoAttachmentCard` instances beyond a concurrency of 1. The card and hook themselves do not change.

---

## Part 2: Server-side transcription and persistence

> Implements **P2.R1–P2.R8** from PRD-032.
>
> References full PRD scope:
> - The `session_attachments.storage_path` nullable migration introduced here also unblocks Part 3 (editable transcripts continue to live as transcript-only rows; Part 3 layers the `is_edited` flag and edit flow on top of the same shape).
> - The `createTranscriptAttachment()` service introduced here is the surface Part 3's edit-save will reuse to update `parsed_content` on the same row — Part 3 adds an `updateTranscript()` sibling, no new persistence path.
> - The `resolveTranscriptionModel()` + `transcribeAudio()` helpers in `ai-service.ts` are the single point of provider/model configuration. Part 4's retry refinements wrap calls to `transcribeAudio()` without changing the resolver. Backlog items (audio-only uploads, long-video chunking) plug into the same helpers — chunking iterates `transcribeAudio()` per segment.
> - The audio-upload wire format from Part 1 (`POST /api/files/transcribe` multipart contract) is preserved; Part 2 only **adds** an optional `session_id` field. The Part 1 client, if deployed unchanged against a Part 2 server, continues to work — receives a real transcript instead of a mock, no client redeploy required.

### Overview

Replace the Part 1 mock transcript with a real OpenAI Whisper call via the `experimental_transcribe` API in the Vercel AI SDK, behind a `resolveTranscriptionModel()` resolver that mirrors the existing `resolveModel()` pattern. Persist video transcripts as `session_attachments` rows with `storage_path = NULL` via a new `createTranscriptAttachment()` service function. Two persistence paths reflect the PRD's two save scenarios:

- **Manual** (P2.R7 new-session branch). Client receives transcript from `/api/files/transcribe`, holds it in `videoItems` state (Part 1 behaviour), and on session save iterates each completed transcript through the existing `/api/sessions/[id]/attachments` POST route — extended in this part to accept transcript-only payloads (no file Blob when `source_format === "video_transcript"`).
- **Auto** (P2.R7 saved-session branch). For the expanded-row surface where the session already exists, the client passes `session_id` to `/api/files/transcribe`. The server transcribes AND persists in the same request, before sending the response. The transcript survives client disconnect mid-Whisper because the DB write happens server-side.

The audio bitrate `AUDIO_EXTRACTION_PARAMS.bitrate` is reduced from `"32k"` to `"24k"` so a 2-hour video produces ~22 MB of audio — comfortably under Whisper's 25 MB per-request hard limit. The Part 1 server-side audio cap of 50 MB is tightened to 25 MB to align with Whisper rather than reject downstream.

`SavedAttachmentList` is patched defensively in this part: when `source_format === "video_transcript"`, the download button is hidden because there is no original blob to download (`storage_path` is NULL). The full Part 3 visual differentiation (video icon, "Transcript only" label, edit affordance) ships in Part 3; Part 2 only ships the no-download safety so auto-persisted transcripts do not surface a button that 500s.

### Dependencies (npm)

None new. `@ai-sdk/openai ^3.0.50` is already installed and exports `openai.transcription(modelId)` for the `experimental_transcribe` API. The `ai` package re-exports `experimental_transcribe`.

### Database Changes

#### Migration: `docs/032-video-upload/migrations/001-make-storage-path-nullable.sql`

```sql
-- PRD-032 Part 2: video transcripts persist as session_attachments rows with
-- no Storage blob (storage_path = NULL). Existing parsed-file rows are
-- unaffected — they retain their non-null storage paths.
ALTER TABLE session_attachments
  ALTER COLUMN storage_path DROP NOT NULL;
```

That is the entire migration. No data backfill, no index changes, no RLS changes. Existing parsed-file rows continue to have non-null `storage_path`. New transcript rows get NULL. Application-layer invariant (enforced in `attachment-service.ts`): `storage_path IS NOT NULL` for `source_format !== "video_transcript"`; `storage_path IS NULL` for `source_format === "video_transcript"`. We do **not** add a check constraint — coupling the schema to the source-format vocabulary is brittle (audio transcripts in the backlog would also be NULL-blob), and the application-layer enforcement is sufficient.

#### Generated Supabase types

Run `supabase gen types typescript` after migration. The generated `Database['public']['Tables']['session_attachments']['Row']` will reflect `storage_path: string | null`.

### New Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `AI_TRANSCRIPTION_PROVIDER` | `openai` | Provider for the `resolveTranscriptionModel()` resolver. Currently only `openai` is supported. |
| `AI_TRANSCRIPTION_MODEL` | `whisper-1` | Model ID passed to the resolver. |

Defaults are baked in so most deployments need no change. Documented in `.env.example`. Separate from `AI_PROVIDER`/`AI_MODEL` because transcription support is provider-specific (Whisper is OpenAI-only at the AI SDK layer today; Gemini transcription via `generateText` is a different surface).

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/032-video-upload/migrations/001-make-storage-path-nullable.sql` | **Create** | Schema migration |
| `lib/types/database.ts` (or generated equivalent) | **Modify** | Regenerated types — `storage_path: string \| null` |
| `lib/repositories/attachment-repository.ts` | **Modify** | `AttachmentRow.storage_path: string \| null`; new `createTranscript(input)` method on the interface |
| `lib/repositories/supabase/supabase-attachment-repository.ts` | **Modify** | Implement `createTranscript()` — DB insert only, no Storage call |
| `lib/repositories/mock/mock-attachment-repository.ts` (if present) | **Modify** | Mirror the new method for tests |
| `lib/services/attachment-service.ts` | **Modify** | New `createTranscriptAttachment(repo, input)` service function — companion to `uploadAndCreateAttachment` |
| `lib/services/ai-service.ts` | **Modify** | Add `resolveTranscriptionModel()`, `transcribeAudio(buffer, opts)`, `TranscriptionEmptyError`, plus a transcription `PROVIDER_MAP` |
| `lib/constants.ts` | **Modify** | `AUDIO_EXTRACTION_PARAMS.bitrate` `"32k"` → `"24k"` |
| `app/api/files/transcribe/route.ts` | **Modify** | Replace mock with `transcribeAudio()`; tighten `MAX_AUDIO_BYTES` from 50 MB → 25 MB; accept optional `session_id` for auto-persist; new 422 path for empty transcripts |
| `app/api/sessions/[id]/attachments/route.ts` | **Modify** | Accept transcript-only payloads — when `source_format === "video_transcript"`, no `file` field required, `parsed_content` + metadata fields drive the insert |
| `lib/utils/upload-attachments.ts` | **Modify** | Branch on transcript vs file at the call site; transcripts use the same multipart route but a different field shape |
| `lib/utils/video/upload-audio.ts` | **Modify** | `UploadAudioInput` gains optional `sessionId`; `UploadAudioResult` gains optional `attachment: SessionAttachment` (present when server auto-persisted) |
| `lib/hooks/use-video-attachment.ts` | **Modify** | Plumb `sessionId` through to `uploadAudioForTranscription`; surface the auto-persisted attachment in the completed state |
| `lib/hooks/use-video-items-state.ts` | **Modify** | Accept optional `sessionId` and `onAutoPersisted(attachment)` callback; when `sessionId` is set, completed videos are *removed* from `videoItems` (the auto-persisted row replaces them in the parent's `savedAttachments` via `onAutoPersisted`) |
| `app/capture/_components/session-capture-form.tsx` | **Modify** | New-session save flow: after `POST /api/sessions` returns the new session ID, iterate `completedTranscripts` and POST each as a transcript-only attachment. No `sessionId` passed to the hook (manual path). |
| `app/capture/_components/expanded-session-row.tsx` | **Modify** | Saved-session flow: pass `session.id` to `useVideoItemsState`; wire `onAutoPersisted` to merge the row into `savedAttachments`. The save-flow branch for video transcripts becomes a no-op (already persisted). |
| `app/capture/_components/saved-attachment-list.tsx` | **Modify** | Hide download button when `source_format === "video_transcript"` (no blob to download). Defensive Part-2 patch; the full Part 3 visual treatment lands in Part 3. |
| `.env.example` | **Modify** | Document `AI_TRANSCRIPTION_PROVIDER` + `AI_TRANSCRIPTION_MODEL` |

### Implementation

#### Increment 2.1: Schema migration + repository typing

**What:** Make `storage_path` nullable, regenerate Supabase types, widen the repository row type. No behaviour change yet — Part 1's parsed-file flow continues to write non-null `storage_path`. This increment is independently shippable and reversible (a column being nullable accepts both NULL and non-NULL values; rolling back the migration would only fail if any rows had been NULL'd, which they haven't been by this point).

**Files:**

1. **Create `docs/032-video-upload/migrations/001-make-storage-path-nullable.sql`** with the `ALTER TABLE` shown above. Apply via Supabase Dashboard → SQL editor (matches the operational pattern set by previous PRD migrations).

2. **Run `supabase gen types typescript` and commit the regenerated `lib/types/database.ts`** (or wherever the generated file lives in this codebase). The single change is `storage_path: string` → `storage_path: string | null` on the `session_attachments` row type.

3. **Modify `lib/repositories/attachment-repository.ts`:**

   ```typescript
   export interface AttachmentRow {
     id: string;
     session_id: string;
     file_name: string;
     file_type: string;
     file_size: number;
     storage_path: string | null;        // was: string
     parsed_content: string;
     source_format: string;
     created_at: string;
   }

   // Existing AttachmentInsert shape unchanged — parsed-file inserts still
   // require non-null storage_path; the application layer enforces the
   // invariant.

   // NEW: transcript-only insert shape. No file Blob, no storage upload.
   export interface TranscriptAttachmentInsert {
     session_id: string;
     file_name: string;          // original video file name
     file_type: string;          // original video MIME
     file_size: number;          // original video size
     duration_seconds: number;   // for future analytics; not on AttachmentRow yet
     parsed_content: string;
     team_id: string | null;
   }

   export interface AttachmentRepository {
     // ... existing methods unchanged ...

     /** Insert a video transcript row — storage_path = NULL, source_format = 'video_transcript'. */
     createTranscript(input: TranscriptAttachmentInsert): Promise<AttachmentRow>;
   }
   ```

   `duration_seconds` is captured for forward-compat (analytics, search facets) but is not on `AttachmentRow` because the `session_attachments` table doesn't have that column yet — adding it would require a separate migration. For Part 2 the value is logged but not persisted. **YAGNI flag:** if no consumer asks for duration analytics by Part 4, drop the field entirely.

   Actually — re-reading: keeping `duration_seconds` on the insert input but not on the row type means the field is silently dropped on insert. That's confusing. **Decision: drop `duration_seconds` from `TranscriptAttachmentInsert` for Part 2.** The transcribe-route logs include duration; the DB doesn't need it. Add a migration for it only if a Part 3+ consumer requires it.

   So the actual `TranscriptAttachmentInsert` is:

   ```typescript
   export interface TranscriptAttachmentInsert {
     session_id: string;
     file_name: string;
     file_type: string;
     file_size: number;
     parsed_content: string;
     team_id: string | null;
   }
   ```

4. **Modify `lib/repositories/supabase/supabase-attachment-repository.ts`** — implement `createTranscript()`:

   ```typescript
   async createTranscript(input: TranscriptAttachmentInsert): Promise<AttachmentRow> {
     const { data, error } = await supabase
       .from("session_attachments")
       .insert({
         session_id: input.session_id,
         file_name: input.file_name,
         file_type: input.file_type,
         file_size: input.file_size,
         storage_path: null,
         parsed_content: input.parsed_content,
         source_format: "video_transcript",
         team_id: input.team_id,
       })
       .select()
       .single();

     if (error) {
       throw new Error(`Failed to insert transcript attachment: ${error.message}`);
     }
     return data;
   }
   ```

   No Storage call. No cleanup branch (nothing to clean up). RLS policies are unchanged — the existing `INSERT to authenticated` policy covers transcript inserts because `team_id` is the only RLS-relevant field and it carries the same ownership semantics.

5. **Modify `lib/repositories/mock/mock-attachment-repository.ts`** (if it exists; create stub if `attachment-service.ts` is unit-tested against a mock) — mirror the new method.

#### Increment 2.2: Transcription service (resolveTranscriptionModel + transcribeAudio)

**What:** Pure infrastructure. Add the provider/model resolver and the wrapper function. No call sites yet — the route handler is updated in Increment 2.4. This increment is independently shippable as dead-but-tested infrastructure; the dead-code linter will not complain because the new exports are referenced by the audit-time route changes in 2.4 within the same PR series.

**Files:**

1. **Modify `lib/services/ai-service.ts`** — add transcription resolver and wrapper:

   ```typescript
   import { experimental_transcribe as transcribe } from "ai";
   // ...

   // ---------------------------------------------------------------------------
   // Transcription provider resolution
   // ---------------------------------------------------------------------------

   type SupportedTranscriptionProvider = "openai";

   const TRANSCRIPTION_PROVIDER_MAP: Record<
     SupportedTranscriptionProvider,
     (modelId: string) => ReturnType<typeof openai.transcription>
   > = {
     openai: (modelId) => openai.transcription(modelId),
   };

   const TRANSCRIPTION_DEFAULTS = {
     provider: "openai" as const,
     model: "whisper-1",
   };

   export function resolveTranscriptionModel(): {
     model: ReturnType<typeof openai.transcription>;
     label: string;
   } {
     const provider = process.env.AI_TRANSCRIPTION_PROVIDER ?? TRANSCRIPTION_DEFAULTS.provider;
     const modelId = process.env.AI_TRANSCRIPTION_MODEL ?? TRANSCRIPTION_DEFAULTS.model;

     const factory = TRANSCRIPTION_PROVIDER_MAP[provider as SupportedTranscriptionProvider];
     if (!factory) {
       throw new AIConfigError(
         `Unsupported AI_TRANSCRIPTION_PROVIDER: "${provider}". Supported: ${Object.keys(TRANSCRIPTION_PROVIDER_MAP).join(", ")}`
       );
     }

     return { model: factory(modelId), label: `${provider}/${modelId}` };
   }

   // ---------------------------------------------------------------------------
   // Transcription wrapper
   // ---------------------------------------------------------------------------

   export class TranscriptionEmptyError extends Error {
     constructor() {
       super("No speech could be transcribed from this video.");
       this.name = "TranscriptionEmptyError";
     }
   }

   export interface TranscribeAudioResult {
     text: string;
     durationMs: number;
     modelLabel: string;
   }

   /**
    * Transcribe audio using the configured provider + model. Retries
    * transient failures (429, 5xx, network) up to MAX_RETRIES with
    * exponential backoff via withRetry(). Throws TranscriptionEmptyError
    * when the provider returns empty/whitespace-only text (PRD P2.R8).
    */
   export async function transcribeAudio(
     audio: Buffer,
   ): Promise<TranscribeAudioResult> {
     const { model, label } = resolveTranscriptionModel();
     const start = Date.now();

     const result = await withRetry(`transcribe(${label})`, async (attempt) => {
       console.log(
         `[ai-service] transcribe attempt ${attempt + 1}/${MAX_RETRIES + 1} — model: ${label}, audio: ${audio.byteLength} bytes`,
       );
       return transcribe({ model, audio });
     });

     const text = result.text?.trim() ?? "";
     if (text.length === 0) {
       throw new TranscriptionEmptyError();
     }

     return {
       text,
       durationMs: Date.now() - start,
       modelLabel: label,
     };
   }
   ```

   Notes:
   - Reuses the existing `withRetry()` helper, which already handles 429 / 5xx / network errors per the project's standard retry policy.
   - Empty-transcript detection happens **after** retry exhaustion. An empty result from a successful Whisper response is not a transient failure; it means the audio genuinely had no speech (silent video, music-only). PRD P2.R8 says reject.
   - No `signal: AbortSignal` parameter on `transcribeAudio()` for now — Vercel AI SDK's `experimental_transcribe` does not (as of `ai ^6.0.144`) accept an `abortSignal`. Cancellation is handled at the route-handler level (Vercel will terminate the function if the client connection drops; the user-level cancel from Part 1 aborts the audio upload before the server starts the transcribe call).

2. **Modify `.env.example`** — document the new vars near the existing `AI_PROVIDER`/`AI_MODEL` block:

   ```bash
   # Transcription (PRD-032). Currently only OpenAI Whisper is supported.
   # Defaults are sane for most deployments — uncomment to override.
   # AI_TRANSCRIPTION_PROVIDER=openai
   # AI_TRANSCRIPTION_MODEL=whisper-1
   ```

#### Increment 2.3: Manual persistence path (extend attachments route + client save flow)

**What:** Wire the transcript-only persistence path through the existing attachments route. Extend `attachment-service.ts` with `createTranscriptAttachment()`. Update `upload-attachments.ts` to branch on transcript vs file. Update both client surfaces' save flows to persist transcripts. After this increment, the system **persists transcripts on save** even though Whisper is still mocked from Increment 1.6 — users see real persistence behaviour without yet seeing real transcript content. This is a deliberate ordering: feature flip happens in 2.4 with real Whisper, but persistence groundwork is in place first so the feature flip is risk-free.

**Files:**

1. **Modify `lib/services/attachment-service.ts`** — add the new service function:

   ```typescript
   export interface CreateTranscriptInput {
     sessionId: string;
     teamId: string | null;
     fileName: string;          // original video file name
     fileType: string;          // original video MIME
     fileSize: number;          // original video size in bytes
     parsedContent: string;     // the transcript text
   }

   /**
    * Persist a video transcript as a session_attachments row.
    * No Storage upload; storage_path is NULL.
    */
   export async function createTranscriptAttachment(
     repo: AttachmentRepository,
     input: CreateTranscriptInput,
   ): Promise<AttachmentRow> {
     console.log(
       "[attachment-service] createTranscriptAttachment — session:",
       input.sessionId,
       "file:",
       input.fileName,
       "transcript chars:",
       input.parsedContent.length,
     );

     const row = await repo.createTranscript({
       session_id: input.sessionId,
       file_name: input.fileName,
       file_type: input.fileType,
       file_size: input.fileSize,
       parsed_content: input.parsedContent,
       team_id: input.teamId,
     });

     console.log("[attachment-service] created transcript attachment:", row.id);
     return row;
   }
   ```

   Pattern matches existing `uploadAndCreateAttachment` for log shape and ergonomics. Single responsibility — no Storage interaction.

2. **Modify `app/api/sessions/[id]/attachments/route.ts`** — extend POST to accept transcript-only payloads.

   The current route accepts `multipart/form-data` with required `file`, `parsed_content`, `source_format`. Extension:

   ```
   POST /api/sessions/[id]/attachments
   Content-Type: multipart/form-data

   When source_format === "video_transcript":
     - file is OMITTED
     - parsed_content (string, required)
     - source_format = "video_transcript" (required)
     - file_name (string, required)            ← original video file name
     - file_type (string, required)            ← original video MIME (must be in VIDEO_MIME_TYPES)
     - file_size (string→number, required)     ← original video size

   Otherwise (existing behaviour):
     - file (File, required)
     - parsed_content (string, required)
     - source_format (string, required)
   ```

   Implementation: branch on `source_format` early. For `"video_transcript"`:
   1. Validate `file_name` / `file_type` / `file_size` / `parsed_content` (use the same Zod schema shape as `/api/files/transcribe`'s metadata validator — extract to a shared schema in `lib/schemas/transcript-attachment.ts` to honour DRY).
   2. Enforce per-session `MAX_ATTACHMENTS` via the existing `getCountForSession` call.
   3. Enforce per-session combined-character limit (sum existing parsed_content + this transcript) — defensive server-side check matching the client's `MAX_COMBINED_CHARS`.
   4. Call `createTranscriptAttachment()`.
   5. Return the row at HTTP 201.
   6. Log entry, exit, errors with `[api/sessions/[id]/attachments]` prefix.

   For the parsed-file branch (existing): unchanged.

3. **Create `lib/schemas/transcript-attachment.ts`** — DRY for the metadata validator shared between `/api/files/transcribe` and `/api/sessions/[id]/attachments` POST:

   ```typescript
   import { z } from "zod";

   import {
     MAX_VIDEO_DURATION_SECONDS,
     MAX_VIDEO_FILE_SIZE_BYTES,
     VIDEO_MIME_TYPES,
   } from "@/lib/constants";

   const ALLOWED_VIDEO_TYPES = new Set(Object.keys(VIDEO_MIME_TYPES));

   export const transcriptVideoMetadataSchema = z.object({
     video_file_name: z.string().min(1).max(512),
     video_file_type: z.string().refine(
       (v) => ALLOWED_VIDEO_TYPES.has(v),
       "Unsupported video type",
     ),
     video_file_size: z
       .number()
       .int()
       .positive()
       .max(MAX_VIDEO_FILE_SIZE_BYTES, "Video file size exceeds the 500 MB limit"),
     duration_seconds: z
       .number()
       .positive()
       .max(MAX_VIDEO_DURATION_SECONDS, "Video duration exceeds the 2 hour limit"),
   });

   export type TranscriptVideoMetadata = z.infer<typeof transcriptVideoMetadataSchema>;
   ```

   `/api/files/transcribe` (Part 1 stub) currently has this schema inline — Part 2 moves it here and imports. The attachments route imports the same schema.

4. **Modify `lib/utils/upload-attachments.ts`** — branch on transcript vs parsed file:

   ```typescript
   interface ParsedFileAttachment {
     kind: "parsed";
     file: File;
     parsed_content: string;
     source_format: string;
   }

   interface TranscriptAttachment {
     kind: "video_transcript";
     parsed_content: string;
     file_name: string;
     file_type: string;
     file_size: number;
     duration_seconds: number;
   }

   type PendingUpload = ParsedFileAttachment | TranscriptAttachment;

   export async function uploadAttachmentsToSession(
     sessionId: string,
     attachments: PendingUpload[],
   ): Promise<void> {
     let failCount = 0;

     for (const attachment of attachments) {
       try {
         const formData = new FormData();
         if (attachment.kind === "parsed") {
           formData.append("file", attachment.file);
           formData.append("parsed_content", attachment.parsed_content);
           formData.append("source_format", attachment.source_format);
         } else {
           formData.append("source_format", "video_transcript");
           formData.append("parsed_content", attachment.parsed_content);
           formData.append("file_name", attachment.file_name);
           formData.append("file_type", attachment.file_type);
           formData.append("file_size", String(attachment.file_size));
           formData.append("duration_seconds", String(attachment.duration_seconds));
         }

         const res = await fetch(`/api/sessions/${sessionId}/attachments`, {
           method: "POST",
           body: formData,
         });

         if (!res.ok) {
           failCount++;
           console.error(
             `[uploadAttachmentsToSession] upload failed for "${attachment.kind === "parsed" ? attachment.file.name : attachment.file_name}":`,
             await res.text().catch(() => "unknown error"),
           );
         }
       } catch (err) {
         failCount++;
         console.error(/* ... */);
       }
     }

     if (failCount > 0) {
       toast.warning(`${failCount} attachment${failCount > 1 ? "s" : ""} failed to upload. The session was saved.`);
     }
   }
   ```

   Existing parsed-file callers pass `{ kind: "parsed", ... }`; new transcript callers pass `{ kind: "video_transcript", ... }`. The `ParsedAttachment` UI tier type is mapped to `kind: "parsed"` at the call site (capture form / expanded row).

5. **Modify `app/capture/_components/session-capture-form.tsx`** — save flow change:

   In `onSubmit`, after `POST /api/sessions` returns the new session ID:

   ```typescript
   // Build the unified upload list — parsed files + completed transcripts
   const pendingUploads: PendingUpload[] = [
     ...attachments.map((a) => ({ kind: "parsed" as const, file: a.file, parsed_content: a.parsed_content, source_format: a.source_format })),
     ...completedTranscripts.map((t) => ({
       kind: "video_transcript" as const,
       parsed_content: t.parsed_content,
       file_name: t.file_name,
       file_type: t.file_type,
       file_size: t.file_size,
       duration_seconds: t.duration_seconds,
     })),
   ];

   if (pendingUploads.length > 0) {
     await uploadAttachmentsToSession(session.id, pendingUploads);
   }
   ```

   After this completes, the existing `resetVideoItems()` call clears the videoItems state. Net behaviour: transcripts are now persisted as part of save; the UI then resets.

6. **Modify `app/capture/_components/saved-attachment-list.tsx`** — defensive download-button hide:

   ```tsx
   {attachment.source_format !== "video_transcript" && (
     <Button onClick={() => handleDownload(attachment)} ...>
       <Download className="size-3.5" />
     </Button>
   )}
   ```

   For a transcript row, the row still renders the file name + size + the existing "View content" toggle (which works because `parsed_content` is always populated). Just no download button.

#### Increment 2.4: Real transcription (replace mock with Whisper)

**What:** Feature flip. Replace the mock-transcript line in `/api/files/transcribe` with a call to `transcribeAudio()`. Tighten audio-size cap. Reduce client-side bitrate. Empty-transcript handling. After this increment, **users see real transcripts and they persist on save** (because Increment 2.3 already wired persistence). End-to-end working state, no auto-persist yet.

**Files:**

1. **Modify `lib/constants.ts`** — bitrate adjustment:

   ```typescript
   export const AUDIO_EXTRACTION_PARAMS = {
     sampleRate: 16_000,
     channels: 1,
     bitrate: "24k",          // was "32k" — 2hr × 24kbps = ~22 MB, fits Whisper's 25 MB hard limit
     container: "mp3",
     mimeType: "audio/mpeg",
     extension: ".mp3",
   } as const;
   ```

   No code change required at consumer sites; ffmpeg.wasm reads the value at extraction time.

2. **Modify `app/api/files/transcribe/route.ts`** — three coordinated edits:

   a. Tighten `MAX_AUDIO_BYTES` from `50 * 1024 * 1024` to `25 * 1024 * 1024` (Whisper's hard limit). The 413 error message updates accordingly.

   b. Replace the mock-transcript construction with a real `transcribeAudio()` call:

      ```typescript
      import { transcribeAudio, TranscriptionEmptyError, AIConfigError } from "@/lib/services/ai-service";

      // Inside the handler, after audio + metadata validation:
      const audioBuffer = Buffer.from(await audio.arrayBuffer());

      try {
        const result = await transcribeAudio(audioBuffer);

        console.log(
          `[api/files/transcribe] POST — transcribed ${result.text.length} chars in ${result.durationMs}ms (${result.modelLabel})`,
        );

        return NextResponse.json({
          parsed_content: result.text,
          file_name: meta.video_file_name,
          file_type: meta.video_file_type,
          file_size: meta.video_file_size,
          duration_seconds: meta.duration_seconds,
          source_format: "video_transcript" as const,
        });
      } catch (err) {
        if (err instanceof TranscriptionEmptyError) {
          console.warn("[api/files/transcribe] POST — rejected: empty transcript");
          return NextResponse.json(
            { message: err.message },
            { status: 422 },
          );
        }
        if (err instanceof AIConfigError) {
          console.error("[api/files/transcribe] POST — config error:", err.message);
          return NextResponse.json(
            { message: "Transcription service is not configured" },
            { status: 500 },
          );
        }
        // withRetry has already exhausted retries for transient errors at this point.
        // Anything else is non-retryable provider failure.
        console.error(
          "[api/files/transcribe] POST — transcription failed:",
          err instanceof Error ? err.message : err,
        );
        return NextResponse.json(
          { message: "Transcription failed — please try again" },
          { status: 502 },           // 502 Bad Gateway: upstream provider failure
        );
      }
      ```

      The `audioBuffer` lives in memory only inside this handler. Returning or throwing both let it fall out of scope — GC reclaims. PRD P2.R3 (no retention) is preserved.

   c. The `await audio.arrayBuffer()` drain that Part 1 explicitly called for connection-cleanup purposes is now the same call that produces the buffer for Whisper. Single read; no behavioural change for the drain semantics.

3. **Update `lib/types/video-attachment.ts`** — no change needed; `EMPTY_TRANSCRIPT` was reserved in Part 1 with this exact use case in mind. The error mapper in `lib/hooks/use-video-attachment.ts` already treats messages matching the `mapToVideoUploadError` heuristic as `TRANSCRIPTION_FAILED`; for empty-transcript 422s, the server-returned message is "No speech could be transcribed from this video." which doesn't hit any of the existing regex branches, so it falls through to `TRANSCRIPTION_FAILED`. Refine:

   ```typescript
   function mapToVideoUploadError(err: unknown): VideoUploadError {
     const message = err instanceof Error ? err.message : "Unknown error";
     // ... existing branches ...

     // Server returns the empty-transcript message verbatim — match it
     // exactly so the user sees the same wording, not a generic fallback.
     if (/no speech could be transcribed/i.test(message)) {
       return {
         code: "EMPTY_TRANSCRIPT",
         message: "No speech could be transcribed from this video.",
       };
     }

     return {
       code: "TRANSCRIPTION_FAILED",
       message: "Could not transcribe video — please try again.",
     };
   }
   ```

   This is the activation of the `EMPTY_TRANSCRIPT` code reserved in Part 1.

#### Increment 2.5: Auto-persist for saved sessions (sessionId-aware transcribe)

**What:** Honour P2.R7's saved-session branch. The transcribe endpoint accepts an optional `session_id` — when present, the server validates session access and persists the transcript before returning. The expanded-row surface passes `session.id` to `useVideoItemsState`, and on completion the auto-persisted attachment merges into `savedAttachments` (replacing what would otherwise have lingered as a "completed" videoItem).

**Files:**

1. **Modify `app/api/files/transcribe/route.ts`** — add the optional `session_id` field + branch:

   ```typescript
   // After existing validation, look for session_id
   const sessionIdRaw = formData.get("session_id");
   const sessionId =
     typeof sessionIdRaw === "string" && sessionIdRaw.length > 0
       ? sessionIdRaw
       : null;

   if (sessionId) {
     // Validate session access using the existing route-auth helper.
     const ctx = await requireSessionAccess(sessionId, auth.user);
     if (ctx instanceof NextResponse) return ctx;

     // ... transcribe as before ...

     // Persist immediately, before responding. Survives client disconnect.
     const attachmentRepo = createAttachmentRepository(ctx.supabase, ctx.serviceClient);
     const attachment = await createTranscriptAttachment(attachmentRepo, {
       sessionId,
       teamId: ctx.session.team_id,
       fileName: meta.video_file_name,
       fileType: meta.video_file_type,
       fileSize: meta.video_file_size,
       parsedContent: result.text,
     });

     return NextResponse.json({
       parsed_content: result.text,
       file_name: attachment.file_name,
       file_type: attachment.file_type,
       file_size: attachment.file_size,
       duration_seconds: meta.duration_seconds,
       source_format: "video_transcript" as const,
       attachment,                     // NEW: persisted row, present iff session_id provided
     });
   }

   // sessionId absent: stateless response (Part 1/Increment-2.4 contract)
   return NextResponse.json({ /* ... no attachment field ... */ });
   ```

   `requireSessionAccess` is the existing helper from `lib/api/route-auth.ts` — same one the attachments POST route uses. Returns 404 for missing sessions, 403 for cross-workspace access, 401 for unauthenticated. The handler short-circuits via the `instanceof NextResponse` pattern.

   Combined char-limit check before the persist (defensive, matches what `/api/sessions/[id]/attachments` POST does in Increment 2.3). If the transcript would push the session over `MAX_COMBINED_CHARS`, return 422 BEFORE the persist (no orphan row).

   Per-session `MAX_ATTACHMENTS` check before persist. Same pattern.

2. **Modify `lib/utils/video/upload-audio.ts`** — extend the input + result shapes:

   ```typescript
   export interface UploadAudioInput {
     audio: Blob;
     audioFileName: string;
     videoFileName: string;
     videoFileType: string;
     videoFileSize: number;
     durationSeconds: number;
     sessionId?: string;          // NEW
   }

   export interface UploadAudioResult {
     parsed_content: string;
     file_name: string;
     file_type: string;
     file_size: number;
     duration_seconds: number;
     source_format: "video_transcript";
     attachment?: SessionAttachment;   // NEW: present iff sessionId was passed
   }
   ```

   Inside `uploadAudioForTranscription`, conditionally append `session_id` to the FormData when `input.sessionId` is set. Otherwise unchanged.

3. **Modify `lib/hooks/use-video-attachment.ts`** — accept `sessionId`, plumb through:

   ```typescript
   export interface UseVideoAttachmentOptions {
     sessionId?: string;                                   // NEW
     onCompleted: (attachment: VideoTranscriptAttachment) => void;
     onAutoPersisted?: (attachment: SessionAttachment) => void;   // NEW
     onError: (error: VideoUploadError) => void;
   }
   ```

   Inside the run loop, pass `sessionId` to `uploadAudioForTranscription`. After the upload returns:
   - If `result.attachment` is present (server auto-persisted): call `onAutoPersisted(result.attachment)` instead of `onCompleted(transcript)`. The state machine sets `status: "completed"` so the card unmounts cleanly, but the parent has already moved the row out of `videoItems` via `onAutoPersisted`.
   - If `result.attachment` is absent: existing flow — call `onCompleted(transcript)`.

4. **Modify `lib/hooks/use-video-items-state.ts`** — accept `sessionId` + `onAutoPersisted`:

   ```typescript
   export interface UseVideoItemsStateOptions {
     logPrefix: string;
     sessionId?: string;
     onAutoPersisted?: (attachment: SessionAttachment) => void;
   }
   ```

   When `sessionId` is set:
   - The hook still owns `videoItems` state.
   - When a videoItem's per-attachment hook signals auto-persist (server returned attachment), the hook **removes** that videoItem from its array (no "completed" state; the row is now in the parent's `savedAttachments` instead).
   - The hook calls the consumer's `onAutoPersisted(attachment)` so the parent can append to `savedAttachments`.

   When `sessionId` is absent: existing Part 1 / Increment 2.3 behaviour — `handleVideoCompleted` transitions to "completed" status, transcript persists on save.

   The `<VideoAttachmentSection>` component does not change — it still renders a completed-state row when one is present. With auto-persist, completed-state rows simply never appear in `videoItems` because the hook removes them.

5. **Modify `app/capture/_components/expanded-session-row.tsx`:**

   ```typescript
   const {
     videoItems,
     anyVideoInFlight,
     completedTranscripts,
     transcriptChars,
     handleVideoSelected,
     handleVideoCompleted,
     handleVideoError,
     handleVideoRemove,
     reset: resetVideoItems,
   } = useVideoItemsState({
     logPrefix: "[ExpandedSessionRow]",
     sessionId: session.id,                             // NEW
     onAutoPersisted: (attachment) => {                 // NEW
       setSavedAttachments((prev) => [...prev, attachment]);
     },
   });
   ```

   The save-flow branch (`uploadAttachmentsToSession` for the row) for video transcripts becomes effectively dead — `completedTranscripts` will always be empty for the saved-session surface because completed rows auto-persisted and were removed. Keep the unified upload list (treat empty as no-op); don't special-case.

   `<ProcessingVideoBanner active={anyVideoInFlight} />` and the rest of the wiring is unchanged.

6. **`app/capture/_components/session-capture-form.tsx`** — no change. New-session surface doesn't pass `sessionId`; the manual save path from Increment 2.3 continues to handle persistence.

7. **`useVideoItemsState`'s public surface evolves:** consumers that want to opt out of auto-persist (today: capture form) call with `{ logPrefix }` only; consumers that want auto-persist (today: expanded row) pass `{ logPrefix, sessionId, onAutoPersisted }`. ISP: optional fields are only paid for by callers that need them.

#### Increment 2.6: End-of-Part audit

**What:** Apply the CLAUDE.md eleven-point end-of-part audit checklist to all files touched in Increments 2.1–2.5. Produces fixes, not a report.

**Audit emphasis specific to this part:**

1. **SRP.** `transcribeAudio()` is a single function with no side effects beyond the AI call + log. `createTranscriptAttachment()` does one DB insert with no Storage interaction. The transcribe route's two branches (auto-persist vs stateless) share validation but diverge cleanly at the persist step.
2. **OCP.** The transcribe route extends Part 1's contract via an optional field; the attachments route extends via a `source_format`-keyed branch. No Part 1 caller breaks.
3. **ISP.** `useVideoItemsState`'s new `sessionId` + `onAutoPersisted` are optional; capture-form callers pay nothing for the auto-persist surface.
4. **DIP.** `createTranscriptAttachment(repo, input)` depends on the `AttachmentRepository` interface, not the Supabase client. Same pattern as `uploadAndCreateAttachment`.
5. **DRY.** `transcriptVideoMetadataSchema` is shared between `/api/files/transcribe` and `/api/sessions/[id]/attachments`. The `withRetry` helper is reused for transcription. The combined-char-limit check exists in three places (capture form, expanded row, transcribe route auto-persist branch, attachments route) — confirm these all reference `MAX_COMBINED_CHARS` from `lib/constants.ts`, not duplicated literals.
6. **YAGNI.** Confirm `duration_seconds` was dropped from `TranscriptAttachmentInsert` (decision in Increment 2.1). Confirm no unused exports from `ai-service.ts`'s new transcription block. Confirm `TranscriptionEmptyError` is actually thrown and caught.
7. **Fail explicitly.** `transcribeAudio()`'s catches log via `withRetry`'s existing telemetry. The route-handler catches log every failure mode.
8. **Design tokens.** `saved-attachment-list.tsx`'s download-hide branch uses an existing rendering condition; no new tokens introduced.
9. **Logging.** `/api/files/transcribe` logs entry, audio size, duration, transcript length, model label, exit, every 4xx + 5xx. Service-layer `[attachment-service] createTranscriptAttachment` logs entry + result.
10. **Dead code.** With Increment 2.5 done, the new-session save path includes a `completedTranscripts` map that — for the expanded-row surface — will always be empty. **Decision:** keep the unified shape (capture form still uses it), don't conditionalise per consumer.
11. **Convention compliance.** Migration filename matches PRD-019's pattern (`NNN-name.sql`). Schema names lowercase, snake_case (ALTER TABLE follows existing convention).

Run `npx tsc --noEmit` and `npx eslint` across all touched files. Run `npm run build` to catch production-build-only issues. Verify the migration applies cleanly against a fresh Supabase project.

### Summary of Increments

| Increment | Scope | PRD Requirements |
|-----------|-------|------------------|
| 2.1 | Schema migration + repository typing | P2.R4 (schema) |
| 2.2 | `resolveTranscriptionModel` + `transcribeAudio` infrastructure | P2.R2 (provider abstraction), P2.R3 (no retention via memory-only buffer), P2.R8 (empty-transcript error class) |
| 2.3 | Manual persistence path | P2.R4 (persistence), P2.R5 (combined limit), P2.R7 (new-session branch) |
| 2.4 | Real Whisper transcription | P2.R1 (real endpoint), P2.R3 (memory-only), P2.R6 (retry via `withRetry`), P2.R8 (empty-transcript 422) |
| 2.5 | Auto-persist for saved sessions | P2.R7 (saved-session branch) |
| 2.6 | End-of-Part audit | Convention compliance |

### Forward Compatibility Notes (for Parts 3–4)

These are not implemented in Part 2 but the design accounts for them:

- **Part 3 — Editable transcripts (P3.R7):** `createTranscriptAttachment()` and `AttachmentRepository.createTranscript()` form the insert path. Part 3 adds an `updateTranscript(attachmentId, parsedContent, isEdited)` companion plus an `is_edited` column on `session_attachments` (separate migration). The `parsed_content` column is already-large-enough TEXT; no schema change needed there.
- **Part 3 — Visual differentiation (P3.R1, P3.R2):** `saved-attachment-list.tsx`'s download-hide branch in Part 2 is the seed — Part 3 expands it with the video icon, "Transcript only" label, and inline edit affordance gated on `source_format === "video_transcript"`. The same condition that hides the download button gates the new visuals.
- **Part 3 — Re-extraction parity:** `parsed_content` is the single source of truth for AI input regardless of whether it was Whisper-generated or user-edited. The existing `composeAIInput()` (Part 1, Increment 1.5) is unchanged.
- **Part 4 — Empty audio (P4.R1) / codec failures (P4.R2):** `mapToVideoUploadError`'s heuristic gains the `EMPTY_TRANSCRIPT` activation in Part 2 Increment 2.4. Part 4 refines the OOM / codec heuristics on the client side — server-side behaviour from Part 2 stays.
- **Part 4 — Sequential video processing:** Auto-persist serialises naturally because each `useVideoAttachment` instance holds its own controller; Part 4's queue policy (mount limit of 1) operates one level above and is orthogonal to Part 2's concerns.
- **Backlog — Audio-only uploads:** The transcribe endpoint's Whisper call accepts the same audio buffer regardless of source. Adding audio-only support to the upload zone is a UI change that reuses `transcribeAudio()` unchanged.
- **Backlog — Long-video chunking:** `transcribeAudio()` is a single-shot wrapper; chunking is layered above by splitting audio client-side or server-side and concatenating results. The retry policy applies per chunk; no change to the single-chunk path.

---

## Part 3: Video transcript UX in sessions

> Implements **P3.R1–P3.R7** from PRD-032.
>
> **Already shipped via earlier parts (verified in this part's audit):**
> - **P3.R2** (no download button for video transcripts) — Part 2 Increment 2.3 added the defensive `attachment.source_format !== "video_transcript"` gate around the download button in `saved-attachment-list.tsx`.
> - **P3.R3** (inline transcript view) — inherits from PRD-013's existing "View content" chevron toggle in `saved-attachment-list.tsx`. The toggle reads `attachment.parsed_content` regardless of `source_format`; for video transcripts the parsed content is the transcript text.
> - **P3.R4** (past session display + paperclip count) — inherits from PRD-013's `attachment_count` query in `lib/services/session-service.ts`. The query counts non-deleted rows on `session_attachments`; transcript rows are non-deleted rows with NULL `storage_path`, fully counted.
> - **P3.R5** (re-extraction includes video transcripts) — Part 1 Increment 1.5 wired `composeAIInput()` to include both `pendingAttachments` and `completedTranscripts` for the new-session flow, and Part 2 added the saved-session auto-persist path that merges transcript rows into `savedAttachments`. `composeAIInput`'s `AttachmentLike` interface (`file_name + source_format + parsed_content`) is structurally compatible with `SessionAttachment` for video transcripts; no signal-extraction code path treats transcripts specially.
> - **P3.R6** (adding video to existing sessions) — Part 1 added `onVideoSelected` to `FileUploadZone`, used by both `CaptureAttachmentSection` and `ExpandedSessionNotes`. Part 2 Increment 2.5 added the saved-session auto-persist path so videos uploaded from the expanded view persist server-side as soon as Whisper returns.
>
> **New work in this part:** P3.R1 (visual sub-label "Transcript only — original video not stored") and P3.R7 (editable transcripts: Edit affordance, inline textarea editor, "edited" badge with last-edited timestamp tooltip, exclusivity to `source_format = "video_transcript"`).
>
> **References full PRD scope:**
> - The `last_edited_at` column added in this part is the persistence side of P3.R7; the application-layer rule remains "transcripts are the only editable attachment kind" (other formats let the user re-upload a corrected source). The column lands on `session_attachments` (the same table Part 2 made nullable on `storage_path`); both schema changes are forward-compatible with each other.
> - The `is_edited?: false` literal field reserved on `VideoTranscriptAttachment` in Part 1 widens to `is_edited?: boolean` in this part — pending transcripts (capture form, pre-save) carry the flag in client state; the upload-attachments helper propagates it on save; the POST attachments route consumes it to set `last_edited_at = now()` on insert if the user edited the transcript before saving.
> - The shared inline editor component introduced here (`TranscriptEditor`) is single-purpose for now but is shaped for the BACKLOG "Revert edited transcript to original" item — that backlog work would add a separate "Revert" affordance alongside Save/Cancel and an `original_parsed_content` column. None of that is in v1.
> - Part 4's empty-edit rejection (P4.R6 — "Transcript can't be empty. Use Remove if you want to discard this attachment.") is enforced at the editor's save boundary in this part already (client validation + server validation); Part 4 only refines client-side OOM/codec heuristics, not the editor.

### Overview

Two threads land together. **Visual polish** for transcript rows in `saved-attachment-list.tsx` — adds the "Transcript only — original video not stored" sub-label below the file name (P3.R1). The video icon (`FileVideo2` from lucide-react) was already wired in Part 1 via `lib/constants/file-icons.ts` so no additional icon work is needed. **Editable transcripts** for both pending and saved transcripts (P3.R7) — a single column added to `session_attachments` (`last_edited_at TIMESTAMPTZ NULL`), a new repository method (`updateTranscript`), a new service function (`updateTranscriptAttachment`), a new method (`PATCH`) on the existing per-attachment route, and a shared `TranscriptEditor` inline component used by both `SavedAttachmentList` (saved transcripts → PATCH) and `VideoAttachmentSection`'s `CompletedTranscriptCard` (pending transcripts → mutate client state, propagate `is_edited` flag on session save). An `EditedBadge` component renders the indicator with an optional last-edited timestamp tooltip; pending transcripts that have been edited but not yet saved show the badge without a timestamp.

The schema change is additive and reversible: existing rows get NULL on `last_edited_at` ("never edited"); the badge shows when the column is non-null. No CHECK constraint, no application-layer invariant beyond "the column is set when an edit happens." Editing is restricted to `source_format = "video_transcript"` rows (P3.R7) — the PATCH route validates this server-side before touching the row; the client gates the Edit button on the same condition. PDFs/CSVs/etc. remain view-only because users can re-upload a corrected source file for those — video has no equivalent recovery path because the original is intentionally not retained.

### Dependencies (npm)

None new.

### Database Changes

#### Migration: `docs/032-video-upload/002-add-transcript-edit-tracking.sql`

```sql
-- PRD-032 Part 3: track when a video transcript was last edited. NULL means
-- "never edited" (the default for newly transcribed rows). The "edited" badge
-- in the UI is shown when this column is non-null; the tooltip shows the
-- timestamp via the existing format-relative-time helper.
--
-- Application-layer rule: editing is exclusive to source_format = 'video_transcript'.
-- The PATCH route enforces this server-side; the client gates the Edit button
-- on the same condition. No CHECK constraint — coupling the schema to the
-- source-format vocabulary would be brittle (audio_transcript rows in the
-- backlog would also be editable in the same way).
ALTER TABLE session_attachments
  ADD COLUMN last_edited_at TIMESTAMPTZ NULL;
```

That is the entire migration. No backfill, no index changes (the column is read per-row in the UI rather than queried as a filter), no RLS changes.

### New Environment Variables

None.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `docs/032-video-upload/002-add-transcript-edit-tracking.sql` | **Create** | Schema migration |
| `lib/repositories/attachment-repository.ts` | **Modify** | `AttachmentRow.last_edited_at: string \| null`; new `updateTranscript()` method on the interface; existing `createTranscript` insert shape gains optional `last_edited_at` (set when the user edited a pending transcript before save) |
| `lib/repositories/supabase/supabase-attachment-repository.ts` | **Modify** | Implement `updateTranscript()` — UPDATE `parsed_content` + `last_edited_at = now()`, scoped to non-deleted rows, returns the updated row; widen the SELECT field list on existing methods to include `last_edited_at`; `createTranscript` writes `last_edited_at` from input when set |
| `lib/services/attachment-service.ts` | **Modify** | New `updateTranscriptAttachment(repo, attachmentId, parsedContent)` service function; `CreateTranscriptInput` (internal) gains optional `isEdited: boolean` |
| `lib/types/video-attachment.ts` | **Modify** | Widen `VideoTranscriptAttachment.is_edited?: false` to `is_edited?: boolean` |
| `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` | **Modify** | Add PATCH method — auth via `requireSessionAccess`, fetch the row to verify `source_format === "video_transcript"`, validate non-empty `parsed_content` (P4.R6), enforce `MAX_COMBINED_CHARS` server-side (defensive), delegate to `updateTranscriptAttachment`, log entry/exit/errors. DELETE method unchanged. |
| `app/api/sessions/[id]/attachments/route.ts` | **Modify** | Transcript branch in POST accepts optional `is_edited` form field; passes through to the service which passes through to the repo's `createTranscript` to set `last_edited_at = now()` on insert when the user edited the pending transcript before save |
| `lib/utils/upload-attachments.ts` | **Modify** | `PendingAttachmentUpload`'s `video_transcript` variant gains optional `is_edited: boolean`; the FormData builder appends it when set |
| `lib/hooks/use-video-items-state.ts` | **Modify** | New `handleTranscriptEdited(id, parsedContent)` handler — updates the completed videoItem's `data.parsed_content` and sets `data.is_edited = true`; exposed in the hook return |
| `app/capture/_components/transcript-editor.tsx` | **Create** | Shared inline editor — controlled textarea pre-filled with the current transcript, Save/Cancel buttons, non-empty validation (P4.R6 inline error), `onSave(newContent)` and `onCancel()` callbacks. ~50 LOC. Used by both saved (PATCH) and pending (client-state mutation) edit paths |
| `app/capture/_components/edited-badge.tsx` | **Create** | Tiny presentational component — "Edited" pill; optional `timestamp?: string \| null` prop; when set, wraps in a `<Tooltip>` with `formatRelativeTime(timestamp)`; when absent, renders the badge without a tooltip (used for pending transcripts that have been edited but not yet saved) |
| `app/capture/_components/saved-attachment-list.tsx` | **Modify** | Three additions for transcript rows: (1) "Transcript only — original video not stored" sub-label (P3.R1); (2) Edit button alongside Remove for `source_format === "video_transcript"` when `canEdit`; (3) inline `<TranscriptEditor>` rendered in place of the row when in edit mode; (4) `<EditedBadge>` rendered when `last_edited_at` is non-null |
| `app/capture/_components/video-attachment-section.tsx` | **Modify** | `CompletedTranscriptCard` gains an Edit button + inline `<TranscriptEditor>` for pending transcripts. On Save, calls a new `onEdited(id, parsedContent)` prop forwarded from `useVideoItemsState`. `<EditedBadge>` rendered when `data.is_edited === true` |
| `app/capture/_components/expanded-session-notes.tsx` | **Modify** | New `onSavedAttachmentEdited(attachmentId, parsedContent, lastEditedAt)` prop forwarded to `<SavedAttachmentList>`; pass-through wiring |
| `app/capture/_components/expanded-session-row.tsx` | **Modify** | New `handleSavedAttachmentEdited` callback — updates `savedAttachments` in place with the edited row; passes through to `<ExpandedSessionNotes>` |
| `app/capture/_components/capture-attachment-section.tsx` | **Modify** | Forward `onTranscriptEdited` prop down to `<VideoAttachmentSection>` |

### Implementation

#### Increment 3.1: Schema migration + repository typing + service plumbing

**What:** Schema column, type widening end-to-end, service helper. Pure infrastructure — no UI or route changes yet. Independently shippable.

**Files:**

1. **Create `docs/032-video-upload/002-add-transcript-edit-tracking.sql`** with the `ALTER TABLE` shown above. Apply via Supabase Dashboard → SQL editor.

2. **Modify `lib/repositories/attachment-repository.ts`:**

   ```typescript
   export interface AttachmentRow {
     id: string;
     session_id: string;
     file_name: string;
     file_type: string;
     file_size: number;
     storage_path: string | null;
     parsed_content: string;
     source_format: string;
     created_at: string;
     last_edited_at: string | null;          // NEW (PRD-032 Part 3)
   }

   // Existing TranscriptAttachmentInsert shape gains optional is_edited;
   // when true, the repo writes last_edited_at = now() on insert.
   export interface TranscriptAttachmentInsert {
     session_id: string;
     file_name: string;
     file_type: string;
     file_size: number;
     parsed_content: string;
     team_id: string | null;
     is_edited?: boolean;                    // NEW
   }

   export interface AttachmentRepository {
     // ... existing methods unchanged ...

     /** Update a video transcript's parsed_content. Sets last_edited_at = now().
      *  Throws if the row is missing or not a transcript. */
     updateTranscript(
       attachmentId: string,
       parsedContent: string
     ): Promise<AttachmentRow>;
   }
   ```

   The other methods' return types automatically widen (since `AttachmentRow.last_edited_at` is added to the row shape).

3. **Modify `lib/repositories/supabase/supabase-attachment-repository.ts`:**

   - Widen the SELECT field list everywhere from
     ```
     "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at"
     ```
     to
     ```
     "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at, last_edited_at"
     ```
     (4 places: `create`, `createTranscript`, `getBySessionId`, plus the `updateTranscript` impl below).
   - `createTranscript()` — when `input.is_edited === true`, include `last_edited_at: new Date().toISOString()` in the insert. Else omit (defaults to NULL).
   - **New `updateTranscript()`:**

     ```typescript
     async updateTranscript(
       attachmentId: string,
       parsedContent: string
     ): Promise<AttachmentRow> {
       console.log(
         "[supabase-attachment-repo] updateTranscript — id:",
         attachmentId,
         "chars:",
         parsedContent.length,
       );

       const { data, error } = await supabase
         .from("session_attachments")
         .update({
           parsed_content: parsedContent,
           last_edited_at: new Date().toISOString(),
         })
         .eq("id", attachmentId)
         .eq("source_format", "video_transcript")  // defence-in-depth
         .is("deleted_at", null)
         .select(
           "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at, last_edited_at"
         )
         .single();

       if (error || !data) {
         console.error(
           "[supabase-attachment-repo] updateTranscript error:",
           error?.message ?? "no row returned",
         );
         throw new Error(
           `Transcript ${attachmentId} not found or not editable`,
         );
       }

       console.log("[supabase-attachment-repo] updateTranscript success:", data.id);
       return data;
     }
     ```

     The `eq("source_format", "video_transcript")` predicate is defence-in-depth; the route also checks before calling, but a stale client could hypothetically race. The UPDATE matches no row in that case → `error || !data` branch fires → 404 surfaces to the client.

4. **Modify `lib/services/attachment-service.ts`:**

   - `CreateTranscriptInput` (internal — unexported per Part 2 audit) gains optional `isEdited: boolean`.
   - `createTranscriptAttachment` passes the flag through to `repo.createTranscript({ is_edited: input.isEdited })`.
   - **New `updateTranscriptAttachment()`:**

     ```typescript
     export async function updateTranscriptAttachment(
       repo: AttachmentRepository,
       attachmentId: string,
       parsedContent: string,
     ): Promise<AttachmentRow> {
       console.log(
         "[attachment-service] updateTranscriptAttachment — id:",
         attachmentId,
         "chars:",
         parsedContent.length,
       );

       const row = await repo.updateTranscript(attachmentId, parsedContent);

       console.log("[attachment-service] updateTranscriptAttachment — updated:", row.id);
       return row;
     }
     ```

5. **Modify `lib/types/video-attachment.ts`:**

   ```typescript
   | {
       kind: "video_transcript";
       parsed_content: string;
       file_name: string;
       file_type: string;
       file_size: number;
       duration_seconds: number;
       source_format: "video_transcript";
       // PRD-032 Part 3 — widens from `?: false` (Part 1 reservation). Set
       // by the editor when the user modifies the pending transcript before
       // session save; propagated as an `is_edited` flag on the upload
       // payload so the server sets `last_edited_at = now()` on insert.
       is_edited?: boolean;
     };
   ```

#### Increment 3.2: Route extensions — PATCH endpoint + POST is_edited flag

**What:** New PATCH method on the per-attachment route for transcript edits. Existing POST attachments route's transcript branch accepts an `is_edited` flag to set `last_edited_at` on initial insert when a pending transcript was edited before save. Independently shippable as a "the API supports editing" milestone, ahead of the UI work.

**Files:**

1. **Modify `app/api/sessions/[id]/attachments/[attachmentId]/route.ts`:**

   Add a PATCH method alongside the existing DELETE:

   ```
   PATCH /api/sessions/[id]/attachments/[attachmentId]
   Content-Type: application/json
   Body: { parsed_content: string }

   Response 200: { attachment: SessionAttachment }
   Response 400: { message: "parsed_content is required" } | { message: "Transcript can't be empty..." } (P4.R6)
   Response 401: { message: "Authentication required" }
   Response 403: from requireSessionAccess
   Response 404: { message: "Transcript not found" } (also fires for parsed-file rows — they're not editable, so 404 is the right negative answer)
   Response 422: { message: "Combined input exceeds N characters" }
   Response 500: { message: "Failed to update transcript" }
   ```

   Implementation:

   ```typescript
   export async function PATCH(
     request: NextRequest,
     { params }: { params: Promise<{ id: string; attachmentId: string }> }
   ) {
     const { id: sessionId, attachmentId } = await params;

     console.log(
       "[api/sessions/[id]/attachments/[attachmentId]] PATCH — session:",
       sessionId,
       "attachment:",
       attachmentId,
     );

     const auth = await requireAuth();
     if (auth instanceof NextResponse) return auth;

     const ctx = await requireSessionAccess(sessionId, auth.user);
     if (ctx instanceof NextResponse) return ctx;

     let body: { parsed_content?: unknown };
     try {
       body = await request.json();
     } catch {
       return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
     }

     const parsedContent = body.parsed_content;
     if (typeof parsedContent !== "string") {
       return NextResponse.json(
         { message: "parsed_content is required" },
         { status: 400 },
       );
     }
     // P4.R6 — empty/whitespace-only edits are rejected with the verbatim
     // message the editor renders inline. Keep the strings aligned.
     if (parsedContent.trim().length === 0) {
       return NextResponse.json(
         {
           message:
             "Transcript can't be empty. Use Remove if you want to discard this attachment.",
         },
         { status: 400 },
       );
     }

     const attachmentRepo = createAttachmentRepository(ctx.supabase, ctx.serviceClient);

     // Defensive: server-side combined-char check (matches the client cap).
     const existing = await getAttachmentsBySessionId(attachmentRepo, sessionId);
     const target = existing.find((a) => a.id === attachmentId);
     if (!target) {
       return NextResponse.json({ message: "Transcript not found" }, { status: 404 });
     }
     if (target.source_format !== "video_transcript") {
       return NextResponse.json({ message: "Transcript not found" }, { status: 404 });
     }

     const otherChars = existing.reduce(
       (sum, a) => (a.id === attachmentId ? sum : sum + a.parsed_content.length),
       0,
     );
     if (otherChars + parsedContent.length > MAX_COMBINED_CHARS) {
       return NextResponse.json(
         {
           message: `Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters`,
         },
         { status: 422 },
       );
     }

     try {
       const attachment = await updateTranscriptAttachment(
         attachmentRepo,
         attachmentId,
         parsedContent,
       );

       try {
         await ctx.sessionRepo.markStale(sessionId, ctx.user.id);
       } catch (staleErr) {
         console.error(
           "[api/sessions/[id]/attachments/[attachmentId]] PATCH — failed to mark stale:",
           staleErr instanceof Error ? staleErr.message : staleErr,
         );
       }

       console.log(
         "[api/sessions/[id]/attachments/[attachmentId]] PATCH — updated:",
         attachment.id,
       );
       return NextResponse.json({ attachment });
     } catch (err) {
       console.error(
         "[api/sessions/[id]/attachments/[attachmentId]] PATCH error:",
         err instanceof Error ? err.message : err,
       );
       return NextResponse.json(
         { message: "Failed to update transcript" },
         { status: 500 },
       );
     }
   }
   ```

   Imports added: `getAttachmentsBySessionId`, `updateTranscriptAttachment`, `MAX_COMBINED_CHARS`. The "404 for both not-found and not-a-transcript" choice avoids leaking which case is which (would matter if attachmentId enumeration were a concern — it's not really, since RLS scopes session access — but uniform 404 is simpler).

2. **Modify `app/api/sessions/[id]/attachments/route.ts`** (transcript branch):

   In `handleTranscriptUpload`, read an optional `is_edited` form field:

   ```typescript
   const isEditedRaw = formData.get("is_edited");
   const isEdited = isEditedRaw === "true";
   ```

   Pass it through to `createTranscriptAttachment(attachmentRepo, { ..., isEdited })`. The service forwards to the repo, which sets `last_edited_at = now()` on insert when true.

3. **Modify `lib/utils/upload-attachments.ts`:**

   ```typescript
   export type PendingAttachmentUpload =
     | { kind: "parsed"; ... }
     | {
         kind: "video_transcript";
         file_name: string;
         file_type: string;
         file_size: number;
         duration_seconds: number;
         parsed_content: string;
         is_edited?: boolean;          // NEW
       };
   ```

   In the FormData builder, append `is_edited` only when truthy:

   ```typescript
   if (attachment.is_edited) {
     formData.append("is_edited", "true");
   }
   ```

#### Increment 3.3: Shared `TranscriptEditor` and `EditedBadge` components

**What:** Two presentational components used by both the saved and pending edit paths. No state ownership, no side effects — pure UI primitives. Independently shippable as part of the component library.

**Files:**

1. **Create `app/capture/_components/transcript-editor.tsx`:**

   ```typescript
   "use client"

   import { useState } from "react"
   import { Loader2 } from "lucide-react"

   import { Button } from "@/components/ui/button"
   import { Textarea } from "@/components/ui/textarea"

   interface TranscriptEditorProps {
     initialContent: string
     onSave: (newContent: string) => void | Promise<void>
     onCancel: () => void
     isSaving?: boolean
   }

   export function TranscriptEditor({
     initialContent,
     onSave,
     onCancel,
     isSaving = false,
   }: TranscriptEditorProps) {
     const [content, setContent] = useState(initialContent)
     const trimmed = content.trim()
     const isEmpty = trimmed.length === 0
     const isUnchanged = content === initialContent
     const canSave = !isEmpty && !isUnchanged && !isSaving

     return (
       <div className="flex flex-col gap-2 border-t border-border bg-muted/50 px-3 py-2">
         <Textarea
           value={content}
           onChange={(e) => setContent(e.target.value)}
           rows={6}
           className="resize-y font-mono text-xs"
           autoFocus
           disabled={isSaving}
         />
         {isEmpty && (
           <p className="text-xs text-destructive">
             Transcript can&apos;t be empty. Use Remove if you want to discard this
             attachment.
           </p>
         )}
         <div className="flex items-center justify-end gap-2">
           <Button
             type="button"
             variant="outline"
             size="sm"
             onClick={onCancel}
             disabled={isSaving}
           >
             Cancel
           </Button>
           <Button
             type="button"
             size="sm"
             onClick={() => onSave(content)}
             disabled={!canSave}
           >
             {isSaving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
             Save
           </Button>
         </div>
       </div>
     )
   }
   ```

   The component is purely controlled — owns only its in-edit text and gives ownership of save/cancel decisions to the parent. `isSaving` is parent-driven (the parent is responsible for the optimistic update or PATCH-and-wait pattern).

2. **Create `app/capture/_components/edited-badge.tsx`:**

   ```typescript
   "use client"

   import { Badge } from "@/components/ui/badge"
   import { formatRelativeTime } from "@/lib/utils/format-relative-time"

   interface EditedBadgeProps {
     timestamp?: string | null
   }

   export function EditedBadge({ timestamp }: EditedBadgeProps) {
     const tooltipText = timestamp
       ? `Edited ${formatRelativeTime(timestamp)}`
       : null

     const badge = (
       <Badge variant="secondary" className="shrink-0 text-[10px]">
         edited
       </Badge>
     )

     if (!tooltipText) return badge

     // Pre-existing pattern in the codebase: native title attribute for
     // simple text tooltips. The Tooltip primitive isn't installed.
     return <span title={tooltipText}>{badge}</span>
   }
   ```

   Tooltip implementation note: this codebase doesn't have a shadcn `<Tooltip>` primitive installed (verified during Part 1's audit when the same question came up). The native `title` attribute on a wrapping `<span>` is the project's existing pattern for hover-only text tooltips. If the design system later adds `<Tooltip>`, this badge swap is one file.

#### Increment 3.4: Saved-attachment-list — visual differentiation + edit flow

**What:** `SavedAttachmentList` gains the "Transcript only" sub-label (P3.R1), an Edit button for transcripts, the inline editor wired to the PATCH endpoint, and the `<EditedBadge>` for transcripts with non-null `last_edited_at`. The saved-attachment surface ships first because it's where most editing actually happens (auto-persisted transcripts on the expanded session row).

**Files:**

1. **Modify `app/capture/_components/saved-attachment-list.tsx`:**

   New imports:
   ```typescript
   import { Pencil } from "lucide-react"
   import { TranscriptEditor } from "./transcript-editor"
   import { EditedBadge } from "./edited-badge"
   ```

   New state:
   ```typescript
   const [editingId, setEditingId] = useState<string | null>(null)
   const [savingEditId, setSavingEditId] = useState<string | null>(null)
   ```

   New handler:
   ```typescript
   const handleSaveEdit = async (
     attachmentId: string,
     newContent: string,
   ): Promise<void> => {
     setSavingEditId(attachmentId)
     try {
       const res = await fetch(
         `/api/sessions/${sessionId}/attachments/${attachmentId}`,
         {
           method: "PATCH",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ parsed_content: newContent }),
         },
       )
       if (!res.ok) {
         const data = await res.json().catch(() => null)
         toast.error(data?.message ?? "Failed to save transcript")
         return
       }
       const { attachment: updated } = await res.json()
       onEdited(updated)
       setEditingId(null)
       toast.success("Transcript saved")
     } catch {
       toast.error("Failed to save transcript — please try again")
     } finally {
       setSavingEditId(null)
     }
   }
   ```

   New prop: `onEdited: (attachment: SessionAttachment) => void` — the parent updates `savedAttachments` in place with the row from the PATCH response.

   In the row render, three additions for `attachment.source_format === "video_transcript"`:

   - **Sub-label** below the file name (P3.R1):
     ```tsx
     <div className="flex min-w-0 flex-1 flex-col">
       <span className="truncate text-sm text-foreground">{attachment.file_name}</span>
       {attachment.source_format === "video_transcript" && (
         <span className="text-xs text-muted-foreground/80">
           Transcript only — original video not stored
         </span>
       )}
     </div>
     ```

   - **EditedBadge** when `last_edited_at` is non-null (alongside the size + format-badge area).

   - **Edit button** alongside Remove for transcripts when `canEdit`:
     ```tsx
     {attachment.source_format === "video_transcript" && canEdit && (
       <button
         type="button"
         onClick={(e) => {
           e.stopPropagation()
           setEditingId(attachment.id)
         }}
         disabled={savingEditId === attachment.id}
         className="shrink-0 rounded p-0.5 ..."
         aria-label={`Edit ${attachment.file_name}`}
       >
         <Pencil className="size-3.5" />
       </button>
     )}
     ```

   When `editingId === attachment.id`, render the editor in place of the expanded "View content" panel:
   ```tsx
   {editingId === attachment.id ? (
     <TranscriptEditor
       initialContent={attachment.parsed_content}
       isSaving={savingEditId === attachment.id}
       onSave={(newContent) => handleSaveEdit(attachment.id, newContent)}
       onCancel={() => setEditingId(null)}
     />
   ) : (
     /* existing expand/collapse logic */
   )}
   ```

2. **Modify `app/capture/_components/expanded-session-notes.tsx`:**

   New prop `onSavedAttachmentEdited: (attachment: SessionAttachment) => void`, passed to `<SavedAttachmentList onEdited={...} />`.

3. **Modify `app/capture/_components/expanded-session-row.tsx`:**

   ```typescript
   const handleSavedAttachmentEdited = useCallback(
     (updated: SessionAttachment) => {
       setSavedAttachments((prev) =>
         prev.map((a) => (a.id === updated.id ? updated : a)),
       )
     },
     [],
   )
   ```

   Pass `onSavedAttachmentEdited={handleSavedAttachmentEdited}` to `<ExpandedSessionNotes>`.

#### Increment 3.5: Pending-transcript editing (capture form)

**What:** `CompletedTranscriptCard` (the pending-transcript card in `VideoAttachmentSection`) gains the same Edit affordance. On save, the videoItem's `data.parsed_content` is mutated in client state and `data.is_edited = true` is set. The flag propagates through `upload-attachments.ts` to the server, which sets `last_edited_at = now()` on insert.

**Files:**

1. **Modify `lib/hooks/use-video-items-state.ts`:**

   Add a new handler:
   ```typescript
   const handleTranscriptEdited = useCallback(
     (id: string, parsedContent: string) => {
       setVideoItems((prev) =>
         prev.map((v) =>
           v.id === id && v.status === "completed"
             ? {
                 ...v,
                 data: {
                   ...v.data,
                   parsed_content: parsedContent,
                   is_edited: true,
                 },
               }
             : v,
         ),
       )
     },
     [],
   )
   ```

   Expose in the return value alongside the other handlers.

2. **Modify `app/capture/_components/video-attachment-section.tsx`:**

   New prop `onEdited?: (id: string, parsedContent: string) => void` on `<VideoAttachmentSection>`. `CompletedTranscriptCard` accepts an `onEdited` callback prop.

   Inside `CompletedTranscriptCard`:
   - New local state: `const [isEditing, setIsEditing] = useState(false)`
   - When `isEditing`, render `<TranscriptEditor>` in place of the chevron-toggled content panel
   - On save: call `onEdited(attachment.id, newContent)` (synchronous client-state mutation; no `isSaving` flag because this is purely client-side), close the editor
   - When `attachment.is_edited === true`, render `<EditedBadge timestamp={null} />` (no timestamp because the persistence write hasn't happened yet)
   - Edit button alongside the existing remove (×) button

3. **Modify `app/capture/_components/capture-attachment-section.tsx`:**

   New prop `onTranscriptEdited?: (id: string, parsedContent: string) => void`, forwarded to `<VideoAttachmentSection onEdited={onTranscriptEdited}>`.

4. **Modify `app/capture/_components/expanded-session-notes.tsx`:**

   New prop `onPendingTranscriptEdited?: (id: string, parsedContent: string) => void`, forwarded to `<VideoAttachmentSection>`.

5. **Modify `app/capture/_components/session-capture-form.tsx`:**

   Pass `onTranscriptEdited={handleTranscriptEdited}` (from the hook) to `<CaptureAttachmentSection>`.

   Update the save flow's transcript-payload mapping to include the flag:

   ```typescript
   ...completedTranscripts.map<PendingAttachmentUpload>((t) => ({
     kind: "video_transcript",
     file_name: t.file_name,
     file_type: t.file_type,
     file_size: t.file_size,
     duration_seconds: t.duration_seconds,
     parsed_content: t.parsed_content,
     is_edited: t.is_edited === true,   // NEW
   })),
   ```

6. **Modify `app/capture/_components/expanded-session-row.tsx`:**

   Pass `onPendingTranscriptEdited={handleTranscriptEdited}` to `<ExpandedSessionNotes>`. The expanded-row save flow (still has a manual upload path even though most transcripts auto-persist) also propagates the flag.

   For the auto-persist path in Increment 2.5, the user can't have edited the pending transcript before save (it auto-persists immediately). After auto-persist, the row is in `savedAttachments` and edits go through the PATCH path from Increment 3.4. So no change to `useVideoAttachment`'s sessionId-aware branch.

#### Increment 3.6: End-of-Part audit

**What:** Apply the CLAUDE.md eleven-point end-of-part audit checklist to all files touched in Increments 3.1–3.5. Produces fixes, not a report.

**Audit emphasis specific to this part:**

1. **SRP.** `TranscriptEditor` owns only the textarea state; save/cancel decisions belong to the parent. `EditedBadge` is purely presentational. `updateTranscriptAttachment` does one DB UPDATE with no Storage interaction. The PATCH route's two pre-flight checks (existence + source_format) collapse to a single 404 — uniform negative answer.
2. **OCP.** PATCH is added alongside DELETE on the existing route file; no behaviour change to DELETE. The POST attachments route's transcript branch gains an optional `is_edited` field; the parsed-file branch is untouched.
3. **ISP.** `TranscriptEditor`'s prop interface (initialContent, onSave, onCancel, isSaving?) is the minimum to do its job — no styling overrides, no validation flags one caller would use.
4. **DIP.** `updateTranscriptAttachment(repo, ...)` depends on the `AttachmentRepository` interface, not the Supabase client.
5. **DRY.** `TranscriptEditor` and `EditedBadge` are shared between saved-attachment-list and video-attachment-section's `CompletedTranscriptCard` — no duplicated editor implementation. The "Transcript only — original video not stored" string lives in saved-attachment-list (the shipping copy site for the saved row); `CompletedTranscriptCard` already had the same string from Part 1, so the message is co-located in the only two places where it renders. **Decision:** do not extract to a constant — two call sites with identical content is below the abstraction threshold; if a third surface needs it, extract then.
6. **YAGNI.** Confirm the PATCH endpoint accepts only `parsed_content` (not `file_name`, `is_edited`, etc.). `last_edited_at` is server-set, not client-set. No `original_parsed_content` column or revert affordance — backlog only.
7. **Fail explicitly.** PATCH route logs every 4xx + 5xx; service + repo log entry/exit + errors. The empty-content check uses the verbatim P4.R6 message both client-side (in `TranscriptEditor`) and server-side (in PATCH route) — keep them aligned.
8. **Design tokens.** `TranscriptEditor` uses existing `<Textarea>` and `<Button>` primitives; `EditedBadge` uses the existing `<Badge>` component. No new tokens.
9. **Logging.** PATCH route, `updateTranscriptAttachment`, and `updateTranscript` repository method all log entry, exit, errors with consistent prefixes.
10. **Dead code.** With Increment 3.5 done, `is_edited?: boolean` on `VideoTranscriptAttachment` is wired end-to-end. The Part 1 reservation is now live code.
11. **Convention compliance.** Migration filename `002-add-transcript-edit-tracking.sql` follows the existing `NNN-name.sql` pattern. Schema names lowercase, snake_case.

Run `npx tsc --noEmit`, `npx eslint` across all touched files, and `npm run build`. Verify the migration applies cleanly.

### Summary of Increments

| Increment | Scope | PRD Requirements |
|-----------|-------|------------------|
| 3.1 | Schema + repository typing + service plumbing | P3.R7 (data model side) |
| 3.2 | PATCH endpoint + POST is_edited flag | P3.R7 (API surface), P4.R6 (empty-edit rejection — server side) |
| 3.3 | Shared `TranscriptEditor` + `EditedBadge` components | P3.R7 (shared primitives) |
| 3.4 | Saved-attachment-list editing + visual sub-label | P3.R1, P3.R7 (saved path), P4.R6 (empty-edit rejection — client side) |
| 3.5 | Pending-transcript editing (capture form) | P3.R7 (pending path) |
| 3.6 | End-of-Part audit | Convention compliance |

### Forward Compatibility Notes (for Part 4)

- **Part 4 — Empty audio (P4.R1) / codec failures (P4.R2):** Client-side error mapper in `useVideoAttachment` is the only refinement target; Part 3 doesn't change the mapper.
- **Part 4 — Empty-edit rejection (P4.R6):** Already enforced in this part — both the server-side PATCH route (verbatim message) and the client-side `TranscriptEditor` (inline error gates the Save button). Part 4 has nothing to add for P4.R6.
- **Part 4 — Sequential video processing (P4.R4):** Editing is orthogonal to the queue policy. The queue gates which `VideoAttachmentCard` instances mount; once a card has reached `completed` and become a videoItem (manual flow) or a savedAttachments row (auto-persist flow), the editor is always available.
- **Backlog — Revert edited transcript to original:** Would add an `original_parsed_content` column on insert (populated only when the row's `parsed_content` is later edited) plus a "Revert" button alongside Save/Cancel in `TranscriptEditor`. Schema-additive, type-additive, UI-additive — no breaking change. Skipped in v1 because the schema clean-up cost vs. user demand (none yet) is negative.
- **Backlog — Audio-only file uploads:** When audio-only is added, those rows would also be transcript-only (`source_format = "audio_transcript"` say). The current editing exclusivity check (`source_format === "video_transcript"`) would need to widen to include audio transcripts. Single boolean on `attachment` — `isEditableSourceFormat(source_format)` helper — minor change at that point.
- **Backlog — Cloud meeting integrations / In-browser recording:** Both feed transcripts through the same `session_attachments` rows as `video_transcript`. The editing UX inherits unchanged.

---

## Part 4: Edge cases and limits

> Implements **P4.R1–P4.R6** from PRD-032.
>
> **Already shipped via earlier parts (verified in this part's audit):**
> - **P4.R1** (OOM error message — `"Your device couldn't process this video. Try a shorter clip or a different device."`) — Part 1 Increment 1.3 wired the verbatim message into `mapToVideoUploadError`'s `EXTRACTION_OOM` branch. Part 4 refines the detection heuristic; the message itself is unchanged.
> - **P4.R2** (codec/format error message — `"This video format couldn't be processed. Try converting to MP4 or use a different recording."`) — Part 1 Increment 1.3 wired the verbatim message into `mapToVideoUploadError`'s `EXTRACTION_FAILED` branch. Part 4 refines the detection heuristic; the message itself is unchanged.
> - **P4.R3** (`MAX_ATTACHMENTS` enforcement, video transcripts counted) — Part 1 Increment 1.4 client-side enforcement in `FileUploadZone` (counts both parsed files and video items via `currentCount`), Part 2 Increment 2.3 server-side enforcement in `/api/sessions/[id]/attachments` POST transcript branch, Part 2 Increment 2.5 pre-flight check in `/api/files/transcribe` auto-persist branch.
> - **P4.R5** (audio-only files rejected as unsupported) — `.mp3`, `.m4a`, `.wav` are not in `ACCEPTED_EXTENSIONS` or `VIDEO_EXTENSIONS`. The `processFiles` loop in `FileUploadZone` rejects with the existing `"\"${fileName}\" is not a supported format. Accepted: ..."` toast. No code change needed; the rejection is structural.
> - **P4.R6** (empty-edit rejection — `"Transcript can't be empty. Use Remove if you want to discard this attachment."`) — Part 3 Increments 3.2 + 3.3 wired the verbatim message into both the server-side PATCH route (400 response) and the client-side `TranscriptEditor` (inline error gating the Save button).
>
> **New work in this part:** P4.R4 (sequential video processing) and a refinement of the OOM/codec heuristics in `mapToVideoUploadError` to catch `RangeError` and `WebAssembly.RuntimeError` explicitly.
>
> **References full PRD scope:**
> - The sequential queue introduced here operates at `<VideoAttachmentSection>` level — gates which `<VideoAttachmentCard>` instances mount based on the current items list. The per-attachment state machine (`useVideoAttachment`) is unchanged; the queue is a parent-level concern, matching the original Part 1 forward-compat note ("Part 4's queue policy operates one level above and is orthogonal to Part 2's concerns"). The auto-persist branch (Part 2) flows through naturally — auto-persisted items are removed from the videoItems list, advancing the queue automatically without any new logic.
> - Heuristic refinement is confined to `mapToVideoUploadError` in `lib/hooks/use-video-attachment.ts`. The `VideoUploadErrorCode` enum (Part 1 Increment 1.1) is unchanged — Part 4 adds NO new error codes, only better detection of existing ones. Downstream UI (`<VideoAttachmentCard>`'s error rendering) is unchanged.
> - Backlog items called out in the PRD (audio-only uploads, long-video chunking, multi-threaded ffmpeg.wasm, server-side fallback, revert edited transcript, cloud meeting integrations, in-browser recording, per-team transcription quota) are explicitly out of scope. Each is layered above the architecture this part finalises; none requires a Part 4 hook.

### Overview

Two narrow changes. **Sequential video processing**: `<VideoAttachmentSection>` finds the first `in_flight` item in the items list and only that one gets a fully-mounted `<VideoAttachmentCard>` (which auto-starts its `useVideoAttachment` pipeline on mount). All other `in_flight` items render as inline `Clock`-icon "Waiting…" placeholder cards with file name + size + cancel button. When the active card completes (manual flow → item flips to `completed`; auto-persist flow → item is removed), the parent's state update triggers a re-render and the new "first in_flight" item's card mounts and starts. Errored cards stay rendered (the user sees the inline error and dismisses via Remove); the queue advances on dismissal. The per-attachment state machine and the `<VideoAttachmentCard>` itself are unchanged.

**Heuristic refinement** in `mapToVideoUploadError`: explicit `RangeError` instance check (canonical JS signal for memory exhaustion) and `WebAssembly.RuntimeError` constructor-name check (ffmpeg.wasm surfaces "memory access out of bounds" as a `RuntimeError` when the WASM heap is exhausted) added to the OOM branch. Codec/format regex widened with `invalid (data|argument)`, `unable to find`, `could not decode`, `malformed` patterns to catch the specific ffmpeg.wasm failure modes. Existing message-text regex kept as a fallback. No enum changes; no UI changes; the same `EXTRACTION_OOM` and `EXTRACTION_FAILED` codes map to the same verbatim user messages from P4.R1 / P4.R2.

### Dependencies (npm)

None new.

### Database Changes

None.

### New Environment Variables

None.

### Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `app/capture/_components/video-attachment-section.tsx` | **Modify** | Find first `in_flight` item, mount only that card; render other `in_flight` items as inline "Waiting…" placeholders with file name + Cancel button + `Clock` icon. The completed-transcript card and the active card paths are unchanged |
| `lib/hooks/use-video-attachment.ts` | **Modify** | Refine `mapToVideoUploadError` — add explicit `RangeError` / `WebAssembly.RuntimeError` detection for `EXTRACTION_OOM`; widen codec regex with specific ffmpeg.wasm patterns for `EXTRACTION_FAILED` |

### Implementation

#### Increment 4.1: Sequential video processing (P4.R4)

**What:** Add a concurrency-1 queue at `<VideoAttachmentSection>` level. Find the first `in_flight` item; only that one gets a fully-mounted `<VideoAttachmentCard>`. Other `in_flight` items render as inline "Waiting…" placeholder cards. The queue advances naturally as items transition out of `in_flight` (manual completion / auto-persist removal / cancellation / error-dismissal).

**Files:**

1. **Modify `app/capture/_components/video-attachment-section.tsx`:**

   - Add `Clock` import from `lucide-react`.
   - Compute `firstInFlightIndex = items.findIndex((i) => i.status === "in_flight")` once per render.
   - Branch the per-item render:
     - `completed` items → existing `<CompletedTranscriptCard>` path (unchanged).
     - `in_flight` items where `index === firstInFlightIndex` → existing `<VideoAttachmentCard>` path (unchanged — pipeline auto-starts on mount).
     - `in_flight` items where `index !== firstInFlightIndex` → new inline `<QueuedVideoCard>` placeholder.
   - Add a small `QueuedVideoCard` helper component (file-local, ~20 lines) — `Clock` icon + file-type icon + file name + "Waiting…" sub-label + file size + Cancel (`X`) button.

   The card and the per-attachment hook are not modified — the gating is purely "do we mount the card or not."

   ```tsx
   const firstInFlightIndex = items.findIndex((i) => i.status === "in_flight")

   return (
     <div className="flex flex-col gap-2">
       {items.map((item, index) => {
         if (item.status === "completed") {
           return (
             <CompletedTranscriptCard
               key={item.id}
               attachment={item.data}
               onEdited={onEdited ? (parsedContent) => onEdited(item.id, parsedContent) : undefined}
               onRemove={() => onRemove(item.id)}
             />
           )
         }
         // item.status === "in_flight"
         if (index === firstInFlightIndex) {
           return (
             <VideoAttachmentCard
               key={item.id}
               file={item.file}
               sessionId={sessionId}
               onCompleted={(attachment) => onCompleted(item.id, attachment)}
               onAutoPersisted={
                 onAutoPersisted
                   ? (attachment) => onAutoPersisted(item.id, attachment)
                   : undefined
               }
               onError={(error) => onError(item.id, error)}
               onCancel={() => onRemove(item.id)}
             />
           )
         }
         return (
           <QueuedVideoCard
             key={item.id}
             file={item.file}
             onRemove={() => onRemove(item.id)}
           />
         )
       })}
     </div>
   )
   ```

   `QueuedVideoCard`:

   ```tsx
   function QueuedVideoCard({ file, onRemove }: { file: File; onRemove: () => void }) {
     const Icon = FILE_ICONS[file.type] ?? FILE_ICONS["video/mp4"]
     return (
       <div className="rounded-md border border-border bg-muted/30">
         <div className="flex items-center gap-3 px-3 py-2">
           <Clock className="size-4 shrink-0 text-muted-foreground" />
           <Icon className="size-4 shrink-0 text-muted-foreground" />
           <div className="flex min-w-0 flex-1 flex-col">
             <span className="truncate text-sm text-foreground">{file.name}</span>
             <span className="text-xs text-muted-foreground">Waiting…</span>
           </div>
           <span className="shrink-0 text-xs text-muted-foreground">
             {formatFileSize(file.size)}
           </span>
           <button
             type="button"
             onClick={onRemove}
             className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
             aria-label={`Cancel queued upload ${file.name}`}
           >
             <X className="size-3.5" />
           </button>
         </div>
       </div>
     )
   }
   ```

   No state, no effects — pure presentational. The Cancel button calls `onRemove` (the parent's videoItem-removal handler), which is the same path active and completed cards use.

**Behavioural notes:**

- **Errored cards block the queue until dismissed.** If the first `in_flight` item enters `error` substate (per the per-attachment hook's state machine), the videoItem stays `in_flight` at the list level — the card displays the inline error with a Remove button. `firstInFlightIndex` still points at it. Queued items don't start. User clicks Remove → onCancel → parent removes the item → re-render → the new "first in_flight" item's card mounts. **This is intentional**: surfaces the error to the user, requires explicit dismissal, no silent failure. Matches the existing per-card error UX from Part 1.
- **Auto-persisted items don't block the queue.** Part 2's auto-persist branch removes the item from `videoItems` entirely (the `handleVideoAutoPersisted` handler in `useVideoItemsState` does `setVideoItems(prev => prev.filter(...))`). The queue advances naturally on the same render cycle that adds the row to `savedAttachments`.
- **Cancellation advances the queue immediately.** The active card's Cancel button already calls `cancel()` (hook abort) AND `onCancel()` (parent removal) in the same handler (from Part 1 Increment 1.4). Removing the item triggers a re-render; the next `in_flight` item's card mounts.
- **No state-shape change.** `VideoListItem` stays as `in_flight | completed`. The queue is purely a render-time decision in the section. The hook (`useVideoItemsState`) doesn't change. The per-attachment state machine doesn't change.

#### Increment 4.2: Heuristic refinement for OOM and codec failures (P4.R1, P4.R2)

**What:** Better detection of OOM and codec failures in `mapToVideoUploadError`. The existing message-regex catches some real cases but misses two specific patterns ffmpeg.wasm produces: `RangeError` (canonical JS memory-exhaustion signal) and `WebAssembly.RuntimeError` ("memory access out of bounds" when the WASM heap is exhausted). Widen the codec/format regex with patterns I have direct evidence of from ffmpeg.wasm error logs: `invalid data`, `invalid argument`, `unable to find`, `could not decode`, `malformed`. Verbatim user messages from P4.R1 / P4.R2 are unchanged — only the detection patterns are refined.

**Files:**

1. **Modify `lib/hooks/use-video-attachment.ts`:**

   ```typescript
   function mapToVideoUploadError(err: unknown): VideoUploadError {
     const message = err instanceof Error ? err.message : "Unknown error"

     // OOM detection — RangeError is the canonical JS signal for memory
     // exhaustion; ffmpeg.wasm WebAssembly RuntimeError surfaces "memory
     // access out of bounds" when the WASM heap is exhausted. Either, or the
     // existing message-regex (covers Chrome/Firefox runtime variants).
     const isRangeError = err instanceof RangeError
     const isWasmRuntimeError =
       err instanceof Error && err.constructor.name === "RuntimeError"
     if (
       isRangeError ||
       isWasmRuntimeError ||
       /memory|oom|allocation|out of bounds|out of memory/i.test(message)
     ) {
       return {
         code: "EXTRACTION_OOM",
         message:
           "Your device couldn't process this video. Try a shorter clip or a different device.",
       }
     }

     // Codec / format / corrupt-file failures. Patterns refined to catch
     // the specific shapes ffmpeg.wasm produces: "Invalid data", "Invalid
     // argument", "Unable to find a suitable output format", etc.
     if (
       /ffmpeg|exec|invalid (data|argument)|unsupported|codec|format|unable to find|could not decode|malformed/i.test(
         message,
       )
     ) {
       return {
         code: "EXTRACTION_FAILED",
         message:
           "This video format couldn't be processed. Try converting to MP4 or use a different recording.",
       }
     }

     // Network / upload failures from the XHR. The fetch-level errors don't
     // come through here (already classified earlier in the run loop).
     if (/network|timed out/i.test(message)) {
       return {
         code: "UPLOAD_FAILED",
         message: "Could not upload audio for transcription. Please try again.",
       }
     }

     // Server returned the empty-transcript message verbatim from
     // TranscriptionEmptyError — match it so the user sees the same wording
     // rather than the generic fallback. Activates the EMPTY_TRANSCRIPT code
     // reserved in Part 1's VideoUploadErrorCode enum.
     if (/no speech could be transcribed/i.test(message)) {
       return {
         code: "EMPTY_TRANSCRIPT",
         message: "No speech could be transcribed from this video.",
       }
     }

     return {
       code: "TRANSCRIPTION_FAILED",
       message: "Could not transcribe video — please try again.",
     }
   }
   ```

   The `err.constructor.name === "RuntimeError"` check uses constructor-name string comparison because `WebAssembly.RuntimeError` isn't always exposed as a global (varies by JS runtime). Defensive but cheap.

   No new error codes. No enum change. No UI change. Just better routing of existing errors to existing branches.

#### Increment 4.3: End-of-Part audit + already-shipped verification

**What:** Apply the CLAUDE.md eleven-point audit checklist to the two files touched in 4.1–4.2. Verify the four already-shipped Part 4 requirements (P4.R1, P4.R2, P4.R3, P4.R5, P4.R6) still hold via grep + spot-check. Update `ARCHITECTURE.md` and `CHANGELOG.md`. **Closes PRD-032.**

**Audit emphasis specific to this part:**

1. **SRP.** `<VideoAttachmentSection>`'s render is one decision (which card type) per item. `QueuedVideoCard` is presentational only. `mapToVideoUploadError` is one classification function — no side effects, just a pure mapping.
2. **OCP.** The queue logic is added as a new render branch in `<VideoAttachmentSection>`; existing card paths (active, completed) are unchanged. The heuristic refinement adds detection patterns; existing message-regex stays as a fallback.
3. **ISP.** No new props on `<VideoAttachmentSection>`; queue policy is internal. `QueuedVideoCard`'s prop interface is the minimum (file + onRemove).
4. **DIP.** `mapToVideoUploadError` operates on `unknown` and tests via `instanceof` / regex; doesn't depend on any concrete error class except built-in `RangeError`.
5. **DRY.** `QueuedVideoCard` reuses the same `FILE_ICONS` map and `formatFileSize` helper as the active card. The Cancel button JSX is similar to the active card's Cancel — three similar lines, below the abstraction threshold.
6. **YAGNI.** No new error codes (used existing `EXTRACTION_OOM` / `EXTRACTION_FAILED`). No new audio-rejection message — the existing toast satisfies P4.R5. No global "queue indicator" component — the per-card "Waiting…" sub-label IS the queue indicator (the PRD's wording allows this).
7. **Fail explicitly.** Errored cards still surface inline; user must dismiss to advance the queue. No silent error swallowing.
8. **Design tokens.** `Clock` icon uses existing `text-muted-foreground`. No new tokens.
9. **Logging.** No new logs needed in the section render. The error mapper is pure (no logs by design — logging happens at the per-attachment hook's catch block, unchanged).
10. **Dead code.** `QueuedVideoCard` is consumed by exactly one site (its parent function in the same file). No exports.
11. **Convention compliance.** File-local helper component pattern matches `CompletedTranscriptCard`'s shape (introduced Part 1).

**Already-shipped verification (grep + spot-check):**

- **P4.R1** — confirm `mapToVideoUploadError`'s `EXTRACTION_OOM` branch returns the verbatim `"Your device couldn't process this video. Try a shorter clip or a different device."`.
- **P4.R2** — confirm the `EXTRACTION_FAILED` branch returns the verbatim `"This video format couldn't be processed. Try converting to MP4 or use a different recording."`.
- **P4.R3** — confirm `MAX_ATTACHMENTS = 5` is referenced in `FileUploadZone` (client cap) AND in `/api/sessions/[id]/attachments` POST (server cap, both parsed-file and transcript branches) AND in `/api/files/transcribe` auto-persist pre-flight. The TRD's Part 1 Increment 1.4 + Part 2 Increment 2.3 + 2.5 cover this.
- **P4.R5** — confirm `.mp3`, `.m4a`, `.wav` are NOT in `ACCEPTED_EXTENSIONS` or `VIDEO_EXTENSIONS`. The `processFiles` loop in `FileUploadZone` rejects with `"\"${fileName}\" is not a supported format. Accepted: ..."`.
- **P4.R6** — confirm the verbatim `"Transcript can't be empty. Use Remove if you want to discard this attachment."` appears in BOTH `app/api/sessions/[id]/attachments/[attachmentId]/route.ts` (PATCH 400 branch) AND `app/capture/_components/transcript-editor.tsx` (inline `<p>`). Part 3 Increment 3.6's audit cross-checked these — re-confirm in Part 4 audit since strings drift over time.

**Documentation:**

- `ARCHITECTURE.md` — Current State paragraph extended with a brief Part 4 sentence noting the sequential queue + heuristic refinement, with **Closes PRD-032** marker. `<VideoAttachmentSection>` file-map entry annotated with the queue-render note. `mapToVideoUploadError` paragraph in the use-video-attachment description annotated with the refinement.
- `CHANGELOG.md` — Part 4 entry under `[Unreleased]`. Per-increment breakdown. Behavioural state. Migration: none.

### Summary of Increments

| Increment | Scope | PRD Requirements |
|-----------|-------|------------------|
| 4.1 | Sequential video processing — concurrency-1 at `<VideoAttachmentSection>` | P4.R4 |
| 4.2 | Heuristic refinement in `mapToVideoUploadError` for OOM and codec failures | P4.R1 (detection), P4.R2 (detection) |
| 4.3 | End-of-Part audit + already-shipped verification + docs | P4.R1, P4.R2, P4.R3, P4.R5, P4.R6 (verification) |

### Forward Compatibility Notes (PRD-032 closes after this part — backlog reference only)

These are explicitly out of scope for Part 4 but shaped to plug in cleanly:

- **Backlog — Audio-only file uploads:** new `AUDIO_EXTENSIONS` constant set, threaded through `FileUploadZone`'s extension check. The route would skip the `extractAudioFromVideo` step (audio is already audio) and go straight to the transcribe POST with the file as `audio`. Would also need to widen `source_format` to support `audio_transcript` (similar shape to `video_transcript` — `storage_path = NULL`, editable per P3.R7). The editing exclusivity check (`source_format === "video_transcript"`) would need a small `isEditableSourceFormat()` helper extracted at that point.
- **Backlog — Long-video chunking:** `extractAudioFromVideo` becomes a multi-chunk wrapper. Each chunk is transcribed independently via `transcribeAudio`; results are concatenated server-side. The `withRetry` policy applies per chunk; UPLOAD_FAILED on one chunk would currently fail the whole video. Stretch goal: per-chunk progress + partial-failure recovery.
- **Backlog — Multi-threaded ffmpeg.wasm:** swap `@ffmpeg/core` for `@ffmpeg/core-mt`. Requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers on the app (set in `next.config.ts`). Audit any third-party iframes / OAuth popup flows for COOP/COEP compatibility before flipping.
- **Backlog — Server-side fallback for weak devices:** add an opt-in path where audio extraction happens server-side (e.g., on a Supabase Edge Function or a dedicated worker). Triggered by a user-toggleable preference or auto-detected on `EXTRACTION_OOM` failure with a "retry server-side" affordance. Server-side ffmpeg has its own cost model; gate behind a feature flag.
- **Backlog — Revert edited transcript to original (PRD-032 P3 backlog):** add `original_parsed_content TEXT NULL` column on `session_attachments`; populated only on first edit; "Revert" affordance in `<TranscriptEditor>` alongside Save/Cancel. Schema-additive, type-additive, UI-additive — no breaking change to anything Part 3 ships.
- **Backlog — Cloud meeting integrations + In-browser recording:** both feed transcripts through the same `session_attachments` rows as `video_transcript`. The editing UX, the queue, the heuristic mapper all inherit unchanged. New surfaces, same plumbing.
- **Backlog — Per-team transcription quota:** operational concern (track minutes-of-video transcribed per team) — out of band from the editing/queue work. Would add a counter table and a check in the transcribe route. Unrelated to anything Part 4 changes.

**PRD-032 closes after this part's audit ships.**
