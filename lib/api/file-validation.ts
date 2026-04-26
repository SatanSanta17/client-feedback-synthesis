import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/constants";

export type FileValidationResult =
  | { valid: true }
  | { valid: false; message: string };

/**
 * Enforces per-file upload constraints (size + MIME type) shared between
 * `/api/sessions/[id]/attachments` and `/api/files/parse`. The per-session
 * MAX_ATTACHMENTS cap is intentionally not enforced here — that is a
 * collection-level constraint, not a per-file one.
 */
export function validateFileUpload(file: File): FileValidationResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      message: `File exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`,
    };
  }

  if (!(file.type in ACCEPTED_FILE_TYPES)) {
    return {
      valid: false,
      message: `Unsupported file type: ${file.type}`,
    };
  }

  return { valid: true };
}
