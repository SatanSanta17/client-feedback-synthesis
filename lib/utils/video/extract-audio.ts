import {
  AUDIO_EXTRACTION_PARAMS,
  FFMPEG_CORE_URL,
  FFMPEG_WASM_URL,
  TRANSCRIPTION_CHUNK_SECONDS,
} from "@/lib/constants";

export interface ExtractAudioOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ExtractedAudioChunk {
  blob: Blob;
  mimeType: string;
  extension: string;
  index: number;
  // Approximate duration of this chunk in seconds. The last chunk is shorter
  // when total duration isn't an exact multiple of TRANSCRIPTION_CHUNK_SECONDS;
  // callers use this only for proportional progress accounting.
  durationSeconds: number;
}

// Lazy-imports @ffmpeg/ffmpeg so the ~25 MB WASM core never lands in the
// main bundle — paid only when the user actually picks a video. ffmpeg's
// segment muxer produces N MP3 chunks in a single pass; we read each one
// out of the virtual filesystem and surface them in order.
export async function extractAudioFromVideo(
  file: File,
  totalDurationSeconds: number,
  opts: ExtractAudioOptions = {},
): Promise<ExtractedAudioChunk[]> {
  const { onProgress, signal } = opts;

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();

  ffmpeg.on("progress", ({ progress }) => {
    if (onProgress) {
      onProgress(Math.max(0, Math.min(1, progress)));
    }
  });

  const onAbort = () => {
    try {
      ffmpeg.terminate();
    } catch {
      // ffmpeg may already be torn down — best-effort
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    await ffmpeg.load({ coreURL: FFMPEG_CORE_URL, wasmURL: FFMPEG_WASM_URL });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const inputName = "input" + (file.name.match(/\.[^.]+$/)?.[0] ?? ".mp4");
    // %03d gives us up to 1000 chunks — far above our 10-chunk worst case
    // (2 hr at 12 min/chunk). The segment muxer fills these from 000 upward.
    const outputPattern = "chunk%03d" + AUDIO_EXTRACTION_PARAMS.extension;

    await ffmpeg.writeFile(inputName, await fetchFile(file));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    await ffmpeg.exec([
      "-i",
      inputName,
      "-vn",
      "-ac",
      String(AUDIO_EXTRACTION_PARAMS.channels),
      "-ar",
      String(AUDIO_EXTRACTION_PARAMS.sampleRate),
      "-b:a",
      AUDIO_EXTRACTION_PARAMS.bitrate,
      "-f",
      "segment",
      "-segment_time",
      String(TRANSCRIPTION_CHUNK_SECONDS),
      "-segment_format",
      AUDIO_EXTRACTION_PARAMS.container,
      "-reset_timestamps",
      "1",
      outputPattern,
    ]);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const expectedChunks = Math.max(
      1,
      Math.ceil(totalDurationSeconds / TRANSCRIPTION_CHUNK_SECONDS),
    );

    const chunks: ExtractedAudioChunk[] = [];
    for (let i = 0; i < expectedChunks; i++) {
      const name = `chunk${String(i).padStart(3, "0")}${AUDIO_EXTRACTION_PARAMS.extension}`;
      const data = await ffmpeg.readFile(name);
      const view =
        data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));

      // Copy into a fresh ArrayBuffer — the SharedArrayBuffer-vs-ArrayBuffer
      // split in TS lib means a Uint8Array<ArrayBufferLike> is not a BlobPart.
      const ab = new ArrayBuffer(view.byteLength);
      new Uint8Array(ab).set(view);

      const isLast = i === expectedChunks - 1;
      const chunkDuration = isLast
        ? totalDurationSeconds - i * TRANSCRIPTION_CHUNK_SECONDS
        : TRANSCRIPTION_CHUNK_SECONDS;

      chunks.push({
        blob: new Blob([ab], { type: AUDIO_EXTRACTION_PARAMS.mimeType }),
        mimeType: AUDIO_EXTRACTION_PARAMS.mimeType,
        extension: AUDIO_EXTRACTION_PARAMS.extension,
        index: i,
        durationSeconds: chunkDuration,
      });
    }

    return chunks;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      ffmpeg.terminate();
    } catch {
      // already terminated by abort handler — best-effort
    }
  }
}
