import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const STORAGE_BUCKET = "SYNTHESISER_FILE_UPLOAD";

export interface SessionAttachment {
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

export interface CreateAttachmentInput {
  sessionId: string;
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

export async function uploadAndCreateAttachment(
  input: CreateAttachmentInput
): Promise<SessionAttachment> {
  const {
    sessionId,
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Authentication required");
  }

  const ownerId = teamId ?? user.id;
  const ext = getFileExtension(fileName);
  const storagePath = `${ownerId}/${sessionId}/${crypto.randomUUID()}${ext}`;

  const serviceClient = createServiceRoleClient();
  const { error: uploadError } = await serviceClient.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: fileType,
      upsert: false,
    });

  if (uploadError) {
    console.error(
      "[attachment-service] storage upload error:",
      uploadError.message
    );
    throw new Error(`Failed to upload file: ${uploadError.message}`);
  }

  console.log("[attachment-service] storage upload success:", storagePath);

  const { data, error: insertError } = await supabase
    .from("session_attachments")
    .insert({
      session_id: sessionId,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      storage_path: storagePath,
      parsed_content: parsedContent,
      source_format: sourceFormat,
      team_id: teamId,
    })
    .select(
      "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at"
    )
    .single();

  if (insertError) {
    console.error(
      "[attachment-service] DB insert error:",
      insertError.message
    );
    // Best-effort cleanup: remove the uploaded file
    await serviceClient.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error("Failed to save attachment metadata");
  }

  console.log("[attachment-service] created attachment:", data.id);
  return data;
}

export async function getAttachmentsBySessionId(
  sessionId: string
): Promise<SessionAttachment[]> {
  console.log(
    "[attachment-service] getAttachmentsBySessionId — session:",
    sessionId
  );

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("session_attachments")
    .select(
      "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at"
    )
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(
      "[attachment-service] getAttachmentsBySessionId error:",
      error.message
    );
    throw new Error("Failed to fetch attachments");
  }

  console.log(
    "[attachment-service] getAttachmentsBySessionId — returning",
    data.length,
    "attachments"
  );
  return data;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  console.log("[attachment-service] deleteAttachment — id:", attachmentId);

  const serviceClient = createServiceRoleClient();

  const { data: attachment, error: fetchError } = await serviceClient
    .from("session_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !attachment) {
    console.warn("[attachment-service] deleteAttachment — not found:", attachmentId);
    throw new AttachmentNotFoundError(`Attachment ${attachmentId} not found`);
  }

  const { error: deleteError } = await serviceClient
    .from("session_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachmentId);

  if (deleteError) {
    console.error(
      "[attachment-service] soft-delete error:",
      deleteError.message
    );
    throw new Error("Failed to delete attachment");
  }

  console.log("[attachment-service] soft-deleted attachment:", attachmentId);

  const { error: storageError } = await serviceClient.storage
    .from(STORAGE_BUCKET)
    .remove([attachment.storage_path]);

  if (storageError) {
    console.warn(
      "[attachment-service] storage hard-delete failed (orphaned blob):",
      storageError.message
    );
  } else {
    console.log(
      "[attachment-service] storage hard-deleted:",
      attachment.storage_path
    );
  }
}

export async function getSignedDownloadUrl(
  storagePath: string
): Promise<string> {
  console.log("[attachment-service] getSignedDownloadUrl — path:", storagePath);

  const serviceClient = createServiceRoleClient();

  const { data, error } = await serviceClient.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error || !data?.signedUrl) {
    console.error(
      "[attachment-service] signed URL error:",
      error?.message ?? "no URL returned"
    );
    throw new Error("Failed to generate download URL");
  }

  return data.signedUrl;
}

export async function getAttachmentCountForSession(
  sessionId: string
): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("session_attachments")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .is("deleted_at", null);

  if (error) {
    console.error(
      "[attachment-service] getAttachmentCountForSession error:",
      error.message
    );
    return 0;
  }

  return count ?? 0;
}
