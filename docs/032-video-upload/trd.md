# TRD-032: Video Upload and Transcription

> **Status:** Part 1 — Draft
>
> Mirrors **PRD-032**. Each part maps to the corresponding PRD part.
>
> **Forward compatibility (full PRD scope):**
> - **Part 2** (server transcription) needs a stable audio-upload endpoint contract and metadata shape that the Part 1 client already conforms to. Part 1 ships a thin endpoint stub that validates and returns a mock transcript so the client can be exercised end-to-end without waiting for Whisper integration.
> - **Part 3** (transcript UX, including editing per PRD P3.R7) reuses the same `pending video transcript` client-state shape that Part 1 introduces. Discriminated union with `kind: "video_transcript"` carries `parsed_content`, original-video metadata, and a place for an `is_edited` flag — populated only in Part 3 but reserved in Part 1 typings.
> - **Part 4** (edge cases) builds on the per-attachment state machine introduced in Part 1. Out-of-memory, codec failures, and sequential video processing all hook into the same state machine surface — Part 4 only adds new transitions, no new architecture.

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
