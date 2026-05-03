import type { AttachmentRepository, AttachmentRow } from "@/lib/repositories/attachment-repository";

// Re-export types for backward compatibility with existing consumers
export type SessionAttachment = AttachmentRow;

export interface CreateAttachmentInput {
  sessionId: string;
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  parsedContent: string;
  sourceFormat: string;
  fileBuffer: Buffer;
  teamId: string | null;
}

// PRD-032 Part 2 — transcript-only persistence. No Storage upload; the row
// is the only artefact. Called when the client has already received the
// transcript from /api/files/transcribe and now wants it on the session.
interface CreateTranscriptInput {
  sessionId: string;
  teamId: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  parsedContent: string;
}

export class AttachmentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentNotFoundError";
  }
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex) : "";
}

/**
 * Upload a file to storage and create the attachment metadata record.
 * On DB insert failure, performs best-effort cleanup of the uploaded blob.
 */
export async function uploadAndCreateAttachment(
  repo: AttachmentRepository,
  input: CreateAttachmentInput
): Promise<AttachmentRow> {
  const {
    sessionId,
    userId,
    fileName,
    fileType,
    fileSize,
    parsedContent,
    sourceFormat,
    fileBuffer,
    teamId,
  } = input;

  console.log(
    "[attachment-service] uploadAndCreateAttachment — session:",
    sessionId,
    "file:",
    fileName
  );

  const ownerId = teamId ?? userId;
  const ext = getFileExtension(fileName);
  const storagePath = `${ownerId}/${sessionId}/${crypto.randomUUID()}${ext}`;

  // Step 1: Upload to storage
  await repo.uploadToStorage(storagePath, fileBuffer, fileType);

  // Step 2: Insert metadata
  try {
    const attachment = await repo.create({
      session_id: sessionId,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      storage_path: storagePath,
      parsed_content: parsedContent,
      source_format: sourceFormat,
      team_id: teamId,
    });

    console.log("[attachment-service] created attachment:", attachment.id);
    return attachment;
  } catch (err) {
    // Best-effort cleanup: remove the uploaded file
    console.error(
      "[attachment-service] DB insert error, cleaning up storage:",
      err instanceof Error ? err.message : err
    );
    await repo.removeFromStorage(storagePath);
    throw new Error("Failed to save attachment metadata");
  }
}

/**
 * Persist a video transcript as a session_attachments row. No Storage upload;
 * storage_path is set NULL by the repository. The repository fixes
 * source_format = 'video_transcript' so callers can't insert under a
 * different format by accident.
 */
export async function createTranscriptAttachment(
  repo: AttachmentRepository,
  input: CreateTranscriptInput
): Promise<AttachmentRow> {
  console.log(
    "[attachment-service] createTranscriptAttachment — session:",
    input.sessionId,
    "file:",
    input.fileName,
    "transcript chars:",
    input.parsedContent.length
  );

  const row = await repo.createTranscript({
    session_id: input.sessionId,
    file_name: input.fileName,
    file_type: input.fileType,
    file_size: input.fileSize,
    parsed_content: input.parsedContent,
    team_id: input.teamId,
  });

  console.log("[attachment-service] createTranscriptAttachment — created:", row.id);
  return row;
}

/**
 * Fetch all non-deleted attachments for a session.
 */
export async function getAttachmentsBySessionId(
  repo: AttachmentRepository,
  sessionId: string
): Promise<AttachmentRow[]> {
  console.log(
    "[attachment-service] getAttachmentsBySessionId — session:",
    sessionId
  );

  const attachments = await repo.getBySessionId(sessionId);

  console.log(
    "[attachment-service] getAttachmentsBySessionId — returning",
    attachments.length,
    "attachments"
  );
  return attachments;
}

/**
 * Soft-delete an attachment and remove its storage blob (when one exists).
 * Video-transcript rows have storage_path = NULL — the storage cleanup is skipped.
 */
export async function deleteAttachment(
  repo: AttachmentRepository,
  attachmentId: string
): Promise<void> {
  console.log("[attachment-service] deleteAttachment — id:", attachmentId);

  let storagePath: string | null;
  try {
    storagePath = await repo.softDelete(attachmentId);
  } catch {
    throw new AttachmentNotFoundError(`Attachment ${attachmentId} not found`);
  }

  console.log("[attachment-service] soft-deleted attachment:", attachmentId);

  if (storagePath !== null) {
    await repo.removeFromStorage(storagePath);
  }
}

/**
 * Generate a signed download URL for an attachment's storage path.
 */
export async function getSignedDownloadUrl(
  repo: AttachmentRepository,
  storagePath: string
): Promise<string> {
  console.log("[attachment-service] getSignedDownloadUrl — path:", storagePath);

  return repo.getSignedUrl(storagePath, 60);
}

/**
 * Count non-deleted attachments for a session.
 */
export async function getAttachmentCountForSession(
  repo: AttachmentRepository,
  sessionId: string
): Promise<number> {
  return repo.getCountForSession(sessionId);
}
