import {
  AUDIO_EXTRACTION_PARAMS,
  FFMPEG_CORE_URL,
  FFMPEG_WASM_URL,
} from "@/lib/constants";

export interface ExtractAudioOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ExtractedAudio {
  blob: Blob;
  mimeType: string;
  extension: string;
}

// Lazy-imports @ffmpeg/ffmpeg so the ~25 MB WASM core never lands in the
// main bundle — paid only when the user actually picks a video.
export async function extractAudioFromVideo(
  file: File,
  opts: ExtractAudioOptions = {},
): Promise<ExtractedAudio> {
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
    const outputName = "output" + AUDIO_EXTRACTION_PARAMS.extension;

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
      AUDIO_EXTRACTION_PARAMS.container,
      outputName,
    ]);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const data = await ffmpeg.readFile(outputName);
    const view =
      data instanceof Uint8Array
        ? data
        : new TextEncoder().encode(String(data));

    // Copy into a fresh ArrayBuffer — the SharedArrayBuffer-vs-ArrayBuffer
    // split in TS lib means a Uint8Array<ArrayBufferLike> is not a BlobPart.
    const ab = new ArrayBuffer(view.byteLength);
    new Uint8Array(ab).set(view);

    return {
      blob: new Blob([ab], { type: AUDIO_EXTRACTION_PARAMS.mimeType }),
      mimeType: AUDIO_EXTRACTION_PARAMS.mimeType,
      extension: AUDIO_EXTRACTION_PARAMS.extension,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      ffmpeg.terminate();
    } catch {
      // already terminated by abort handler — best-effort
    }
  }
}
