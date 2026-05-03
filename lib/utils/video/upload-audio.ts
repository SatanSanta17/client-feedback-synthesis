import type { SessionAttachment } from "@/lib/services/attachment-service";

export interface UploadAudioInput {
  audio: Blob;
  audioFileName: string;
  videoFileName: string;
  videoFileType: string;
  videoFileSize: number;
  durationSeconds: number;
  // PRD-032 Part 2 — when present, the server persists the transcript before
  // responding. Survives client disconnect mid-Whisper.
  sessionId?: string;
}

export interface UploadAudioResult {
  parsed_content: string;
  file_name: string;
  file_type: string;
  file_size: number;
  duration_seconds: number;
  source_format: "video_transcript";
  // Present iff sessionId was provided AND the server persisted successfully.
  attachment?: SessionAttachment;
}

export interface UploadAudioOptions {
  onUploadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

// XMLHttpRequest (not fetch) because fetch does not expose upload-progress
// events. Honest progress bar > spinner-fake.
export function uploadAudioForTranscription(
  input: UploadAudioInput,
  opts: UploadAudioOptions = {},
): Promise<UploadAudioResult> {
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
        resolve(xhr.response as UploadAudioResult);
        return;
      }
      const body = xhr.response as { message?: string } | null;
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
    if (input.sessionId) {
      fd.append("session_id", input.sessionId);
    }

    xhr.send(fd);
  });
}
