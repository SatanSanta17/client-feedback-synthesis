// ---------------------------------------------------------------------------
// Chat Types — Conversations and Messages (PRD-020 Part 2)
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant";
export type MessageStatus = "completed" | "streaming" | "failed" | "cancelled";

/** Streaming state machine for the chat UI. */
export type StreamState = "idle" | "streaming" | "error";

/**
 * A single citation linking an assistant claim to a source session.
 */
export interface ChatSource {
  sessionId: string;
  clientName: string;
  sessionDate: string;
  chunkText: string;
  chunkType: string;
}

/**
 * A single message within a conversation.
 */
export interface Message {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  role: MessageRole;
  content: string;
  sources: ChatSource[] | null;
  status: MessageStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * A conversation (thread of messages).
 */
export interface Conversation {
  id: string;
  title: string;
  createdBy: string;
  teamId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Options for listing conversations (cursor-based pagination).
 */
export interface ConversationListOptions {
  /** If true, list archived conversations. Default: false (active only). */
  archived?: boolean;
  /** Filter conversations by title (case-insensitive substring match). */
  search?: string;
  /** Max conversations to return per page. */
  limit: number;
  /** Cursor: `updated_at` ISO string of the oldest loaded conversation. Fetch older. */
  cursor?: string;
  /** Tiebreaker: conversation `id` for deterministic ordering when `updated_at` values collide. */
  cursorId?: string;
}
