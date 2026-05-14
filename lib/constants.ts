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

// Tuned for speech-to-text, not playback. Mono / 16 kHz / 24 kbps balances
// Whisper accuracy against Vercel's per-request body limit. The audio is
// chunked client-side (see TRANSCRIPTION_CHUNK_SECONDS) so each POST stays
// under Hobby's 4.5 MB body cap and each Whisper call finishes inside the
// 60 s function-duration cap. Bitrate dropped from 32 kbps in PRD-032 Part 2
// when the real Whisper call replaced the stub.
export const AUDIO_EXTRACTION_PARAMS = {
  sampleRate: 16_000,
  channels: 1,
  bitrate: "24k",
  container: "mp3",
  mimeType: "audio/mpeg",
  extension: ".mp3",
} as const;

// 12 minutes per chunk: 720 s × 24 kbps / 8 ≈ 2.16 MB per chunk (safe under
// Vercel Hobby's 4.5 MB request-body limit) and Whisper finishes each chunk
// in ~30 s (safe under the 60 s maxDuration cap). 48 min → 4 chunks; 2 h → 10.
export const TRANSCRIPTION_CHUNK_SECONDS = 720;

// Parallel chunk uploads per video. Above 3 we risk Whisper rate limits on
// free-tier OpenAI keys and the browser's per-host connection ceiling starts
// to matter. Each wave is bounded by a single chunk's 60 s ceiling.
export const MAX_TRANSCRIPTION_CONCURRENCY = 3;

// Self-hosted under /public/ffmpeg/ so the WASM core is served from our origin
// (no third-party CDN at runtime). Copied during postinstall.
export const FFMPEG_CORE_URL = "/ffmpeg/ffmpeg-core.js";
export const FFMPEG_WASM_URL = "/ffmpeg/ffmpeg-core.wasm";
