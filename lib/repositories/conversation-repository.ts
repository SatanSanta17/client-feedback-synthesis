// ---------------------------------------------------------------------------
// Conversation Repository Interface (PRD-020 Part 2)
// ---------------------------------------------------------------------------

import type { Conversation, ConversationListOptions } from "@/lib/types/chat";

/**
 * Data required to insert a new conversation row.
 */
export interface ConversationInsert {
  /**
   * Optional client-supplied UUID. When provided, overrides the column
   * default `gen_random_uuid()`. Used for client-owned conversation IDs
   * (gap E15) so the chat surface has a stable identifier from the
   * moment a new chat is started — no `null → just-created` transition.
   * Insert with a duplicate id surfaces as Postgres unique-violation
   * (code 23505) which the service layer maps via `getOrCreateConversation`.
   */
  id?: string;
  title: string;
  created_by: string;
  team_id: string | null;
}

/**
 * Fields that can be updated on an existing conversation.
 */
export interface ConversationUpdate {
  title?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
}

/**
 * Repository interface for conversation persistence.
 * Implementations must respect RLS (user-private access).
 */
export interface ConversationRepository {
  /** Create a new conversation. */
  create(data: ConversationInsert): Promise<Conversation>;

  /** List conversations for a user, paginated by cursor. Pinned first, then by updated_at desc. */
  list(
    userId: string,
    teamId: string | null,
    options: ConversationListOptions
  ): Promise<Conversation[]>;

  /** Fetch a single conversation by ID. Returns null if not found or inaccessible. */
  getById(id: string): Promise<Conversation | null>;

  /** Update a conversation (title, pin, archive). */
  update(id: string, data: ConversationUpdate): Promise<Conversation>;

  /** Hard-delete a conversation (cascades to messages). */
  delete(id: string): Promise<void>;

  /** Update only the title (used by fire-and-forget LLM title generation). */
  updateTitle(id: string, title: string): Promise<void>;
}
