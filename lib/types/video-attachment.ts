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
      file_name: string;
      file_type: string;
      file_size: number;
      duration_seconds: number;
      source_format: "video_transcript";
      // Reserved for PRD-032 Part 3 (P3.R7). Always false in Part 1; Part 3
      // widens this to boolean when the editing affordance lands.
      is_edited?: false;
    };

export type VideoTranscriptAttachment = Extract<
  PendingAttachment,
  { kind: "video_transcript" }
>;

export type VideoAttachmentId = string;

export type VideoUploadState =
  | { status: "queued" }
  | { status: "probing" }
  | { status: "extracting"; progress: number }
  | { status: "uploading"; progress: number }
  | { status: "transcribing" }
  | { status: "completed"; attachment: VideoTranscriptAttachment }
  | { status: "cancelled" }
  | { status: "error"; error: VideoUploadError };

// EMPTY_TRANSCRIPT is defined here so Parts 2/4 can raise it without changing
// the error surface. Part 1 never produces it.
export type VideoUploadErrorCode =
  | "FILE_TOO_LARGE"
  | "DURATION_TOO_LONG"
  | "UNSUPPORTED_BROWSER"
  | "EXTRACTION_OOM"
  | "EXTRACTION_FAILED"
  | "UPLOAD_FAILED"
  | "TRANSCRIPTION_FAILED"
  | "EMPTY_TRANSCRIPT";

export interface VideoUploadError {
  code: VideoUploadErrorCode;
  message: string;
}
