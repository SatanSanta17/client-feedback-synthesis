import { z } from "zod"

import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FILE_SIZE_BYTES,
  VIDEO_MIME_TYPES,
} from "@/lib/constants"

const ALLOWED_VIDEO_TYPES = new Set(Object.keys(VIDEO_MIME_TYPES))

// Shared between /api/files/transcribe (POST) and /api/sessions/[id]/attachments
// (POST, transcript branch). Both routes receive the same metadata fields
// describing the original video; coupling the two validators avoids drift.
export const transcriptVideoMetadataSchema = z.object({
  video_file_name: z.string().min(1).max(512),
  video_file_type: z
    .string()
    .refine((v) => ALLOWED_VIDEO_TYPES.has(v), "Unsupported video type"),
  video_file_size: z
    .number()
    .int()
    .positive()
    .max(MAX_VIDEO_FILE_SIZE_BYTES, "Video file size exceeds the 500 MB limit"),
  duration_seconds: z
    .number()
    .positive()
    .max(MAX_VIDEO_DURATION_SECONDS, "Video duration exceeds the 2 hour limit"),
})
