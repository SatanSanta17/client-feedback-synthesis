import { type SupabaseClient } from "@supabase/supabase-js";

import type { AttachmentRepository, AttachmentRow, AttachmentInsert } from "../attachment-repository";

const STORAGE_BUCKET = "SYNTHESISER_FILE_UPLOAD";

export function createAttachmentRepository(
  supabase: SupabaseClient,
  serviceClient: SupabaseClient
): AttachmentRepository {
  return {
    async uploadToStorage(
      storagePath: string,
      fileBuffer: Buffer,
      contentType: string
    ): Promise<void> {
      console.log("[supabase-attachment-repo] uploadToStorage — path:", storagePath);

      const { error } = await serviceClient.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: false,
        });

      if (error) {
        console.error("[supabase-attachment-repo] uploadToStorage error:", error.message);
        throw new Error(`Failed to upload file: ${error.message}`);
      }

      console.log("[supabase-attachment-repo] uploadToStorage success:", storagePath);
    },

    async removeFromStorage(storagePath: string): Promise<void> {
      console.log("[supabase-attachment-repo] removeFromStorage — path:", storagePath);

      const { error } = await serviceClient.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      if (error) {
        console.warn(
          "[supabase-attachment-repo] removeFromStorage failed (orphaned blob):",
          error.message
        );
      } else {
        console.log("[supabase-attachment-repo] removeFromStorage success:", storagePath);
      }
    },

    async create(input: AttachmentInsert): Promise<AttachmentRow> {
      console.log("[supabase-attachment-repo] create — session:", input.session_id, "file:", input.file_name);

      const { data, error } = await supabase
        .from("session_attachments")
        .insert({
          session_id: input.session_id,
          file_name: input.file_name,
          file_type: input.file_type,
          file_size: input.file_size,
          storage_path: input.storage_path,
          parsed_content: input.parsed_content,
          source_format: input.source_format,
          team_id: input.team_id,
        })
        .select(
          "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at"
        )
        .single();

      if (error) {
        console.error("[supabase-attachment-repo] create error:", error.message);
        throw error;
      }

      console.log("[supabase-attachment-repo] create success:", data.id);
      return data;
    },

    async getBySessionId(sessionId: string): Promise<AttachmentRow[]> {
      console.log("[supabase-attachment-repo] getBySessionId — session:", sessionId);

      const { data, error } = await supabase
        .from("session_attachments")
        .select(
          "id, session_id, file_name, file_type, file_size, storage_path, parsed_content, source_format, created_at"
        )
        .eq("session_id", sessionId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[supabase-attachment-repo] getBySessionId error:", error.message);
        throw new Error("Failed to fetch attachments");
      }

      console.log("[supabase-attachment-repo] getBySessionId — returning", data.length, "attachments");
      return data;
    },

    async getStoragePath(attachmentId: string): Promise<string | null> {
      console.log("[supabase-attachment-repo] getStoragePath — id:", attachmentId);

      const { data, error } = await serviceClient
        .from("session_attachments")
        .select("id, storage_path")
        .eq("id", attachmentId)
        .is("deleted_at", null)
        .single();

      if (error || !data) {
        console.log("[supabase-attachment-repo] getStoragePath — not found:", attachmentId);
        return null;
      }

      return data.storage_path;
    },

    async softDelete(attachmentId: string): Promise<string> {
      console.log("[supabase-attachment-repo] softDelete — id:", attachmentId);

      // Fetch storage path first
      const { data: attachment, error: fetchError } = await serviceClient
        .from("session_attachments")
        .select("id, storage_path")
        .eq("id", attachmentId)
        .is("deleted_at", null)
        .single();

      if (fetchError || !attachment) {
        console.warn("[supabase-attachment-repo] softDelete — not found:", attachmentId);
        throw new Error(`Attachment ${attachmentId} not found`);
      }

      const { error: deleteError } = await serviceClient
        .from("session_attachments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", attachmentId);

      if (deleteError) {
        console.error("[supabase-attachment-repo] softDelete error:", deleteError.message);
        throw new Error("Failed to delete attachment");
      }

      console.log("[supabase-attachment-repo] softDelete success:", attachmentId);
      return attachment.storage_path;
    },

    async getSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
      console.log("[supabase-attachment-repo] getSignedUrl — path:", storagePath);

      const { data, error } = await serviceClient.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);

      if (error || !data?.signedUrl) {
        console.error(
          "[supabase-attachment-repo] getSignedUrl error:",
          error?.message ?? "no URL returned"
        );
        throw new Error("Failed to generate download URL");
      }

      return data.signedUrl;
    },

    async getCountForSession(sessionId: string): Promise<number> {
      console.log("[supabase-attachment-repo] getCountForSession — session:", sessionId);

      const { count, error } = await supabase
        .from("session_attachments")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .is("deleted_at", null);

      if (error) {
        console.error("[supabase-attachment-repo] getCountForSession error:", error.message);
        return 0;
      }

      return count ?? 0;
    },
  };
}
