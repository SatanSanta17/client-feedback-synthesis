import { MAX_TRANSCRIPTION_CONCURRENCY } from "@/lib/constants";
import type { SessionAttachment } from "@/lib/services/attachment-service";
import type { ExtractedAudioChunk } from "@/lib/utils/video/extract-audio";

export interface UploadAudioChunkInput {
  audio: Blob;
  audioFileName: string;
  videoFileName: string;
  videoFileType: string;
  videoFileSize: number;
  durationSeconds: number;
}

export interface UploadAudioChunkResult {
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

// Thrown when the transcribe route returns 422 for an individual chunk that
// contained no speech. Callers treat this as an empty transcript rather than
// a fatal error so a single silent segment doesn't abort the whole batch.
export class TranscriptionEmptyChunkError extends Error {
  constructor(message = "Empty transcript for chunk") {
    super(message);
    this.name = "TranscriptionEmptyChunkError";
  }
}

// Single-chunk POST to /api/files/transcribe. The route is now stateless —
// persistence (if any) happens via /api/files/transcribe/finalize after all
// chunks return. XMLHttpRequest (not fetch) because fetch does not expose
// upload-progress events.
function uploadChunkForTranscription(
  input: UploadAudioChunkInput,
  opts: UploadAudioOptions = {},
): Promise<UploadAudioChunkResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/transcribe");
    xhr.responseType = "json";

    const onAbort = () => xhr.abort();
    const detachSignalListener = () =>
      opts.signal?.removeEventListener("abort", onAbort);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && opts.onUploadProgress) {
        opts.onUploadProgress(event.loaded / event.total);
      }
    });

    xhr.addEventListener("load", () => {
      detachSignalListener();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as UploadAudioChunkResult);
        return;
      }
      const body = xhr.response as { message?: string } | null;
      if (xhr.status === 422) {
        reject(new TranscriptionEmptyChunkError(body?.message));
        return;
      }
      reject(new Error(body?.message ?? "Transcription failed"));
    });

    xhr.addEventListener("error", () => {
      detachSignalListener();
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("timeout", () => {
      detachSignalListener();
      reject(new Error("Upload timed out"));
    });

    xhr.addEventListener("abort", () => {
      detachSignalListener();
      reject(new DOMException("Aborted", "AbortError"));
    });

    if (opts.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const fd = new FormData();
    fd.append("audio", input.audio, input.audioFileName);
    fd.append("video_file_name", input.videoFileName);
    fd.append("video_file_type", input.videoFileType);
    fd.append("video_file_size", String(input.videoFileSize));
    fd.append("duration_seconds", String(input.durationSeconds));

    xhr.send(fd);
  });
}

export interface TranscribeChunkedAudioMeta {
  videoFileName: string;
  videoFileType: string;
  videoFileSize: number;
  durationSeconds: number;
  // When set, finalize is called after stitching so the server persists the
  // transcript on the named session. Survives client-disconnect-on-stitch
  // because the per-chunk transcripts are also already gone otherwise.
  sessionId?: string;
}

export interface TranscribeChunkedAudioCallbacks {
  // Aggregate upload progress in [0, 1] across all chunks.
  onAggregateUploadProgress?: (fraction: number) => void;
  // Fires when chunk i has finished transcription. chunksDone is 1-based.
  onChunkTranscribed?: (chunksDone: number, totalChunks: number) => void;
  signal?: AbortSignal;
}

export interface TranscribeChunkedAudioResult {
  parsed_content: string;
  file_name: string;
  file_type: string;
  file_size: number;
  duration_seconds: number;
  source_format: "video_transcript";
  // Present iff meta.sessionId was set AND the finalize call succeeded.
  attachment?: SessionAttachment;
}

// Top-level orchestrator. Fans the per-chunk transcribe requests out with a
// shared abort signal, waits for all, stitches the transcripts back together
// in chunk order, then (optionally) calls the finalize route to persist.
//
// On any chunk failure the orchestrator aborts every sibling request via an
// internal AbortController so we don't pay for transcription that's about to
// be discarded.
export async function transcribeChunkedAudio(
  chunks: ExtractedAudioChunk[],
  meta: TranscribeChunkedAudioMeta,
  callbacks: TranscribeChunkedAudioCallbacks = {},
): Promise<TranscribeChunkedAudioResult> {
  if (chunks.length === 0) {
    throw new Error("transcribeChunkedAudio called with no chunks");
  }

  // Compose the parent signal with an internal one so a single chunk
  // failure can abort siblings without affecting the parent's semantics.
  const internalCtrl = new AbortController();
  const onParentAbort = () => internalCtrl.abort();
  if (callbacks.signal?.aborted) {
    internalCtrl.abort();
  } else {
    callbacks.signal?.addEventListener("abort", onParentAbort, { once: true });
  }

  const perChunkProgress = new Array<number>(chunks.length).fill(0);
  const reportAggregate = () => {
    if (!callbacks.onAggregateUploadProgress) return;
    const sum = perChunkProgress.reduce((s, p) => s + p, 0);
    callbacks.onAggregateUploadProgress(sum / chunks.length);
  };

  let chunksDone = 0;

  const transcribeOne = async (
    chunk: ExtractedAudioChunk,
  ): Promise<UploadAudioChunkResult> => {
    let result: UploadAudioChunkResult;
    try {
      result = await uploadChunkForTranscription(
        {
          audio: chunk.blob,
          audioFileName: `chunk-${String(chunk.index).padStart(3, "0")}-${crypto.randomUUID()}${chunk.extension}`,
          videoFileName: meta.videoFileName,
          videoFileType: meta.videoFileType,
          videoFileSize: meta.videoFileSize,
          // We report the *full video* duration to each chunk POST because the
          // route's metadata schema enforces it equals the original recording's
          // duration. The Whisper call itself doesn't use this field — it just
          // rides along for the eventual finalize payload.
          durationSeconds: meta.durationSeconds,
        },
        {
          onUploadProgress: (fraction) => {
            perChunkProgress[chunk.index] = fraction;
            reportAggregate();
          },
          signal: internalCtrl.signal,
        },
      );
    } catch (err) {
      // A silent chunk is not a fatal error — the all-empty guard after
      // stitching still fails the video if *every* chunk came back empty.
      if (err instanceof TranscriptionEmptyChunkError) {
        console.warn(
          `[transcribeChunkedAudio] chunk ${chunk.index} returned empty transcript — substituting empty string`,
        );
        result = {
          parsed_content: "",
          file_name: meta.videoFileName,
          file_type: meta.videoFileType,
          file_size: meta.videoFileSize,
          duration_seconds: meta.durationSeconds,
          source_format: "video_transcript",
        };
      } else {
        throw err;
      }
    }

    // Mark this chunk's upload phase complete so the aggregate doesn't get
    // stuck below 1.0 even after Whisper returns.
    perChunkProgress[chunk.index] = 1;
    reportAggregate();

    chunksDone += 1;
    callbacks.onChunkTranscribed?.(chunksDone, chunks.length);
    return result;
  };

  let chunkResults: UploadAudioChunkResult[];
  try {
    chunkResults = await runWithConcurrency(
      chunks,
      MAX_TRANSCRIPTION_CONCURRENCY,
      transcribeOne,
    );
  } catch (err) {
    // Cancel any sibling requests still in flight. If the parent aborted us,
    // this is a no-op; if a chunk failed organically, this stops the others.
    internalCtrl.abort();
    throw err;
  } finally {
    callbacks.signal?.removeEventListener("abort", onParentAbort);
  }

  const stitched = chunkResults
    .map((r) => r.parsed_content.trim())
    .filter((s) => s.length > 0)
    .join("\n");

  if (stitched.length === 0) {
    throw new Error("No speech could be transcribed from this video.");
  }

  const baseResult: TranscribeChunkedAudioResult = {
    parsed_content: stitched,
    file_name: meta.videoFileName,
    file_type: meta.videoFileType,
    file_size: meta.videoFileSize,
    duration_seconds: meta.durationSeconds,
    source_format: "video_transcript",
  };

  if (!meta.sessionId) {
    return baseResult;
  }

  const attachment = await finalizeTranscript(
    {
      sessionId: meta.sessionId,
      parsedContent: stitched,
      videoFileName: meta.videoFileName,
      videoFileType: meta.videoFileType,
      videoFileSize: meta.videoFileSize,
      durationSeconds: meta.durationSeconds,
    },
    callbacks.signal,
  );

  return { ...baseResult, attachment };
}

interface FinalizeInput {
  sessionId: string;
  parsedContent: string;
  videoFileName: string;
  videoFileType: string;
  videoFileSize: number;
  durationSeconds: number;
}

async function finalizeTranscript(
  input: FinalizeInput,
  signal?: AbortSignal,
): Promise<SessionAttachment> {
  const res = await fetch("/api/files/transcribe/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: input.sessionId,
      parsed_content: input.parsedContent,
      video_file_name: input.videoFileName,
      video_file_type: input.videoFileType,
      video_file_size: input.videoFileSize,
      duration_seconds: input.durationSeconds,
    }),
    signal,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Failed to save transcript");
  }

  const data = (await res.json()) as { attachment: SessionAttachment };
  return data.attachment;
}

async function runWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
