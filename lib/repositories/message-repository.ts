// ---------------------------------------------------------------------------
// Message Repository Interface (PRD-020 Part 2)
// ---------------------------------------------------------------------------

import type { Message, MessageStatus, ChatSource } from "@/lib/types/chat";

/**
 * Data required to insert a new message row.
 */
export interface MessageInsert {
  /**
   * Optional client-supplied UUID. When provided, overrides the column
   * default `gen_random_uuid()`. Used for client-owned message IDs (E14)
   * so the optimistic UI never holds a temp ID. Insert with a duplicate
   * id surfaces as Postgres unique-violation (code 23505) which the
   * service layer maps to `MessageDuplicateError`.
   */
  id?: string;
  conversation_id: string;
  parent_message_id?: string | null;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[] | null;
  status?: MessageStatus;
  metadata?: Record<string, unknown> | null;
}

/**
 * Fields that can be updated on an existing message.
 */
export interface MessageUpdate {
  content?: string;
  sources?: ChatSource[] | null;
  status?: MessageStatus;
  metadata?: Record<string, unknown> | null;
}

/**
 * Repository interface for message persistence.
 * Access is derived from conversation ownership (RLS).
 */
export interface MessageRepository {
  /** Insert a new message. */
  create(data: MessageInsert): Promise<Message>;

  /**
   * Fetch messages for a conversation, ordered by created_at descending (newest first).
   * Supports cursor-based pagination via `cursor` (created_at of the oldest loaded message).
   * The caller reverses the result for chronological display.
   */
  getByConversation(
    conversationId: string,
    limit: number,
    cursor?: string
  ): Promise<Message[]>;

  /** Update a message (content, sources, status, metadata). */
  update(id: string, data: MessageUpdate): Promise<Message>;

  /** Hard-delete a single message. */
  delete(id: string): Promise<void>;
}
