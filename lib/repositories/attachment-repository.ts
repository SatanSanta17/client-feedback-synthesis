// ---------------------------------------------------------------------------
// Attachment Repository Interface
// ---------------------------------------------------------------------------

export interface AttachmentRow {
  id: string;
  session_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  parsed_content: string;
  source_format: string;
  created_at: string;
}

export interface AttachmentInsert {
  session_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  parsed_content: string;
  source_format: string;
  team_id: string | null;
}

export interface AttachmentRepository {
  /** Upload a file to storage. Returns the storage path. */
  uploadToStorage(
    storagePath: string,
    fileBuffer: Buffer,
    contentType: string
  ): Promise<void>;

  /** Remove a file from storage. Best-effort — logs warning on failure. */
  removeFromStorage(storagePath: string): Promise<void>;

  /** Insert attachment metadata into the database. */
  create(input: AttachmentInsert): Promise<AttachmentRow>;

  /** Fetch all non-deleted attachments for a session, ordered by created_at. */
  getBySessionId(sessionId: string): Promise<AttachmentRow[]>;

  /** Fetch a single attachment's storage path by ID (non-deleted only). Returns null if not found. */
  getStoragePath(attachmentId: string): Promise<string | null>;

  /** Soft-delete an attachment by ID. Throws if not found. */
  softDelete(attachmentId: string): Promise<string>;

  /** Generate a signed download URL for a storage path. */
  getSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;

  /** Count non-deleted attachments for a session. */
  getCountForSession(sessionId: string): Promise<number>;
}
