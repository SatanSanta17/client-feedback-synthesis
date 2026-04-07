import { type SupabaseClient } from "@supabase/supabase-js";

import type { AttachmentRepository } from "../attachment-repository";

export function createAttachmentRepository(
  supabase: SupabaseClient,
  _serviceClient: SupabaseClient
): AttachmentRepository {
  return {
    async uploadToStorage(_storagePath, _fileBuffer, _contentType) {
      void supabase;
      throw new Error("Not implemented");
    },
    async removeFromStorage(_storagePath) {
      void supabase;
      throw new Error("Not implemented");
    },
    async create(_input) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getBySessionId(_sessionId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getStoragePath(_attachmentId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async softDelete(_attachmentId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getSignedUrl(_storagePath, _expiresInSeconds) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getCountForSession(_sessionId) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
