export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Route constants — change these to redirect users to a different page app-wide
export const DEFAULT_AUTH_ROUTE = "/dashboard";
export const ONBOARDING_ROUTE = "/capture";

export const MAX_COMBINED_CHARS = 250_000;

export const MAX_ATTACHMENTS = 5;

export const ACCEPTED_FILE_TYPES: Record<string, string[]> = {
  "text/plain": [".txt"],
  "application/pdf": [".pdf"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/json": [".json"],
};

export const ACCEPTED_EXTENSIONS = [".txt", ".pdf", ".csv", ".docx", ".json"];

// Video upload (PRD-032) — kept separate from ACCEPTED_FILE_TYPES because the
// pipeline (browser-side audio extraction + transcription) does not share the
// parsed-file flow.
export const VIDEO_MIME_TYPES: Record<string, string[]> = {
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/webm": [".webm"],
};

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

export const MAX_VIDEO_FILE_SIZE_BYTES = 500 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 2 * 60 * 60;

// Tuned for speech-to-text, not playback. Mono / 16 kHz / 24 kbps keeps a
// 2-hour session under Whisper's 25 MB per-request hard limit without
// chunking (24 kbps × 7200 s ≈ 22 MB). Bitrate dropped from 32 kbps in PRD-032
// Part 2 (Increment 2.4) when the real Whisper call replaced the stub.
export const AUDIO_EXTRACTION_PARAMS = {
  sampleRate: 16_000,
  channels: 1,
  bitrate: "24k",
  container: "mp3",
  mimeType: "audio/mpeg",
  extension: ".mp3",
} as const;

// Self-hosted under /public/ffmpeg/ so the WASM core is served from our origin
// (no third-party CDN at runtime). Copied during postinstall.
export const FFMPEG_CORE_URL = "/ffmpeg/ffmpeg-core.js";
export const FFMPEG_WASM_URL = "/ffmpeg/ffmpeg-core.wasm";
