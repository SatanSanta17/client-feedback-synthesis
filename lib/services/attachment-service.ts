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
 * Soft-delete an attachment and remove its storage blob.
 */
export async function deleteAttachment(
  repo: AttachmentRepository,
  attachmentId: string
): Promise<void> {
  console.log("[attachment-service] deleteAttachment — id:", attachmentId);

  let storagePath: string;
  try {
    storagePath = await repo.softDelete(attachmentId);
  } catch {
    throw new AttachmentNotFoundError(`Attachment ${attachmentId} not found`);
  }

  console.log("[attachment-service] soft-deleted attachment:", attachmentId);

  // Best-effort storage cleanup
  await repo.removeFromStorage(storagePath);
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
