import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  MessageRepository,
  MessageInsert,
  MessageUpdate,
} from "../message-repository";
import type { Message, ChatSource } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[supabase-message-repo]";

const COLUMNS =
  "id, conversation_id, parent_message_id, role, content, sources, status, metadata, created_at";

/**
 * Maps a raw Supabase row (snake_case) to a domain Message (camelCase).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row types are loosely typed
function toMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentMessageId: row.parent_message_id ?? null,
    role: row.role,
    content: row.content,
    sources: (row.sources as ChatSource[] | null) ?? null,
    status: row.status,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase-backed MessageRepository.
 *
 * @param supabase - Anon client (RLS-scoped — access derived from conversation ownership)
 */
export function createMessageRepository(
  supabase: SupabaseClient
): MessageRepository {
  return {
    async create(data: MessageInsert): Promise<Message> {
      console.log(
        `${LOG_PREFIX} create — conversationId: ${data.conversation_id}, role: ${data.role}, status: ${data.status ?? "completed"}, providedId: ${data.id ?? "(default)"}`
      );

      const insertPayload: Record<string, unknown> = {
        conversation_id: data.conversation_id,
        role: data.role,
        content: data.content,
      };

      if (data.id !== undefined) {
        insertPayload.id = data.id;
      }
      if (data.parent_message_id !== undefined) {
        insertPayload.parent_message_id = data.parent_message_id;
      }
      if (data.sources !== undefined) {
        insertPayload.sources = data.sources;
      }
      if (data.status !== undefined) {
        insertPayload.status = data.status;
      }
      if (data.metadata !== undefined) {
        insertPayload.metadata = data.metadata;
      }

      const { data: row, error } = await supabase
        .from("messages")
        .insert(insertPayload)
        .select(COLUMNS)
        .single();

      if (error) {
        // Propagate the raw Postgres error so the service layer can detect
        // unique-violation (code 23505) and map to MessageDuplicateError.
        console.error(`${LOG_PREFIX} create error:`, error);
        throw error;
      }

      console.log(`${LOG_PREFIX} created — id: ${row.id}, conversationId: ${row.conversation_id}`);
      return toMessage(row);
    },

    async getByConversation(
      conversationId: string,
      limit: number,
      cursor?: string
    ): Promise<Message[]> {
      console.log(
        `${LOG_PREFIX} getByConversation — conversationId: ${conversationId}, limit: ${limit}, cursor: ${cursor ?? "none"}`
      );

      let query = supabase
        .from("messages")
        .select(COLUMNS)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      // Cursor-based pagination: fetch messages older than the cursor
      if (cursor) {
        query = query.lt("created_at", cursor);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`${LOG_PREFIX} getByConversation error:`, error);
        throw new Error("Failed to fetch messages");
      }

      const messages = (data ?? []).map(toMessage);
      console.log(
        `${LOG_PREFIX} getByConversation — returned ${messages.length} messages`
      );
      return messages;
    },

    async update(id: string, data: MessageUpdate): Promise<Message> {
      console.log(
        `${LOG_PREFIX} update — id: ${id}, fields: ${Object.keys(data).join(", ")}`
      );

      const updatePayload: Record<string, unknown> = {};

      if (data.content !== undefined) {
        updatePayload.content = data.content;
      }
      if (data.sources !== undefined) {
        updatePayload.sources = data.sources;
      }
      if (data.status !== undefined) {
        updatePayload.status = data.status;
      }
      if (data.metadata !== undefined) {
        updatePayload.metadata = data.metadata;
      }

      const { data: row, error } = await supabase
        .from("messages")
        .update(updatePayload)
        .eq("id", id)
        .select(COLUMNS)
        .single();

      if (error) {
        console.error(`${LOG_PREFIX} update error:`, error);
        throw new Error("Failed to update message");
      }

      console.log(`${LOG_PREFIX} updated — id: ${row.id}, status: ${row.status}`);
      return toMessage(row);
    },

    async delete(id: string): Promise<void> {
      console.log(`${LOG_PREFIX} delete — id: ${id}`);

      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("id", id);

      if (error) {
        console.error(`${LOG_PREFIX} delete error:`, error);
        throw new Error("Failed to delete message");
      }

      console.log(`${LOG_PREFIX} deleted — id: ${id}`);
    },
  };
}
