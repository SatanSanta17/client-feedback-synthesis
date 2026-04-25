// ---------------------------------------------------------------------------
// Chat Service (PRD-020 Part 2)
// ---------------------------------------------------------------------------
// Composes ConversationRepository and MessageRepository. Framework-agnostic —
// no HTTP or Next.js imports. Provides CRUD for conversations and messages,
// plus context bounding for LLM prompt construction.
// ---------------------------------------------------------------------------

import type {
  ConversationRepository,
  ConversationInsert,
  ConversationUpdate,
} from "@/lib/repositories/conversation-repository";
import type {
  MessageRepository,
  MessageInsert,
  MessageUpdate,
} from "@/lib/repositories/message-repository";
import type {
  Conversation,
  ConversationListOptions,
  Message,
} from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[chat-service]";

/**
 * Default token budget for conversation context.
 * Approximated as character count / 4 — precision isn't critical, the budget
 * has ample margin.
 */
const DEFAULT_TOKEN_BUDGET = 80_000;

/** Characters-per-token approximation. */
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Context message type (what the LLM sees)
// ---------------------------------------------------------------------------

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface ChatService {
  // Conversations
  createConversation(
    title: string,
    userId: string,
    teamId: string | null
  ): Promise<Conversation>;
  /**
   * Idempotent create-or-get for client-owned conversation UUIDs (gap E15).
   * - Tries INSERT with the supplied `id`.
   * - On unique-violation (code 23505), falls back to fetching by id.
   * - If the fetch returns null, the row exists but is not accessible to
   *   this user (RLS hides cross-user rows) — throws
   *   `ConversationNotAccessibleError` for the route to map to 404.
   * - Returns `{ conversation, isNew }` so callers can distinguish first
   *   send (trigger title generation, etc.) from subsequent retries.
   */
  getOrCreateConversation(
    id: string,
    title: string,
    userId: string,
    teamId: string | null
  ): Promise<{ conversation: Conversation; isNew: boolean }>;
  getConversations(
    userId: string,
    teamId: string | null,
    options: ConversationListOptions
  ): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  updateConversation(
    id: string,
    updates: ConversationUpdate
  ): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  updateConversationTitle(id: string, title: string): Promise<void>;

  // Messages
  getMessages(
    conversationId: string,
    limit: number,
    cursor?: string
  ): Promise<Message[]>;
  createMessage(input: MessageInsert): Promise<Message>;
  updateMessage(id: string, updates: MessageUpdate): Promise<Message>;

  // Context for LLM
  buildContextMessages(
    conversationId: string,
    tokenBudget?: number
  ): Promise<ContextMessage[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ChatService backed by the provided repositories.
 */
export function createChatService(
  conversationRepo: ConversationRepository,
  messageRepo: MessageRepository
): ChatService {
  return {
    // -------------------------------------------------------------------
    // Conversations
    // -------------------------------------------------------------------

    async createConversation(
      title: string,
      userId: string,
      teamId: string | null
    ): Promise<Conversation> {
      console.log(
        `${LOG_PREFIX} createConversation — userId: ${userId}, teamId: ${teamId ?? "personal"}`
      );

      const data: ConversationInsert = {
        title,
        created_by: userId,
        team_id: teamId,
      };

      const conversation = await conversationRepo.create(data);
      console.log(
        `${LOG_PREFIX} conversationCreated — id: ${conversation.id}`
      );
      return conversation;
    },

    async getOrCreateConversation(
      id: string,
      title: string,
      userId: string,
      teamId: string | null
    ): Promise<{ conversation: Conversation; isNew: boolean }> {
      console.log(
        `${LOG_PREFIX} getOrCreateConversation — id: ${id}, userId: ${userId}, teamId: ${teamId ?? "personal"}`
      );

      try {
        const conversation = await conversationRepo.create({
          id,
          title,
          created_by: userId,
          team_id: teamId,
        });
        console.log(
          `${LOG_PREFIX} getOrCreateConversation — created — id: ${conversation.id}`
        );
        return { conversation, isNew: true };
      } catch (err: unknown) {
        // Unique-violation: the row already exists. Fall back to a fetch by
        // id; RLS scopes the result to rows accessible to this user. If the
        // fetch returns null, the row exists but belongs to someone else —
        // surface as `ConversationNotAccessibleError` (route maps to 404).
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          console.log(
            `${LOG_PREFIX} getOrCreateConversation — id ${id} exists, falling back to fetch`
          );
          const existing = await conversationRepo.getById(id);
          if (!existing) {
            throw new ConversationNotAccessibleError(
              `Conversation ${id} not accessible to user ${userId}`
            );
          }
          return { conversation: existing, isNew: false };
        }
        throw err;
      }
    },

    async getConversations(
      userId: string,
      teamId: string | null,
      options: ConversationListOptions
    ): Promise<Conversation[]> {
      console.log(
        `${LOG_PREFIX} getConversations — userId: ${userId}, teamId: ${teamId ?? "personal"}`
      );
      return conversationRepo.list(userId, teamId, options);
    },

    async getConversation(id: string): Promise<Conversation | null> {
      console.log(`${LOG_PREFIX} getConversation — id: ${id}`);
      return conversationRepo.getById(id);
    },

    async updateConversation(
      id: string,
      updates: ConversationUpdate
    ): Promise<Conversation> {
      console.log(
        `${LOG_PREFIX} updateConversation — id: ${id}, fields: ${JSON.stringify(updates)}`
      );
      return conversationRepo.update(id, updates);
    },

    async deleteConversation(id: string): Promise<void> {
      console.log(`${LOG_PREFIX} deleteConversation — id: ${id}`);
      await conversationRepo.delete(id);
      console.log(`${LOG_PREFIX} conversationDeleted — id: ${id}`);
    },

    async updateConversationTitle(id: string, title: string): Promise<void> {
      console.log(
        `${LOG_PREFIX} updateConversationTitle — id: ${id}, title: "${title.slice(0, 40)}…"`
      );
      await conversationRepo.updateTitle(id, title);
    },

    // -------------------------------------------------------------------
    // Messages
    // -------------------------------------------------------------------

    async getMessages(
      conversationId: string,
      limit: number,
      cursor?: string
    ): Promise<Message[]> {
      console.log(
        `${LOG_PREFIX} getMessages — conversationId: ${conversationId}, limit: ${limit}`
      );
      return messageRepo.getByConversation(conversationId, limit, cursor);
    },

    async createMessage(input: MessageInsert): Promise<Message> {
      console.log(
        `${LOG_PREFIX} createMessage — conversationId: ${input.conversation_id}, role: ${input.role}, providedId: ${input.id ?? "(default)"}`
      );
      try {
        return await messageRepo.create(input);
      } catch (err: unknown) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          throw new MessageDuplicateError(
            `Message with id ${input.id ?? "(unknown)"} already exists`
          );
        }
        throw err;
      }
    },

    async updateMessage(
      id: string,
      updates: MessageUpdate
    ): Promise<Message> {
      console.log(
        `${LOG_PREFIX} updateMessage — id: ${id}, fields: ${Object.keys(updates).join(", ")}`
      );
      return messageRepo.update(id, updates);
    },

    // -------------------------------------------------------------------
    // Context bounding for LLM
    // -------------------------------------------------------------------

    async buildContextMessages(
      conversationId: string,
      tokenBudget: number = DEFAULT_TOKEN_BUDGET
    ): Promise<ContextMessage[]> {
      console.log(
        `${LOG_PREFIX} buildContextMessages — conversationId: ${conversationId}, budget: ${tokenBudget} tokens`
      );

      // Fetch all messages (newest first). We use a generous limit — the token
      // budget acts as the real cap. For very long conversations (1000+ messages)
      // we could paginate, but the budget will cut off well before that.
      const allMessages = await messageRepo.getByConversation(
        conversationId,
        500
      );

      // allMessages is newest-first from the repo. We need to walk backward
      // (newest to oldest) to respect the budget, then reverse for chronological.
      let usedTokens = 0;
      const included: ContextMessage[] = [];

      for (const msg of allMessages) {
        // Only include completed messages in context
        if (msg.status !== "completed") {
          continue;
        }

        const estimatedTokens = Math.ceil(msg.content.length / CHARS_PER_TOKEN);

        if (usedTokens + estimatedTokens > tokenBudget) {
          console.log(
            `${LOG_PREFIX} buildContextMessages — budget reached at ${included.length} messages (${usedTokens} tokens used)`
          );
          break;
        }

        usedTokens += estimatedTokens;
        included.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Reverse to chronological order (oldest first)
      included.reverse();

      console.log(
        `${LOG_PREFIX} buildContextMessages — returning ${included.length} messages (≈${usedTokens} tokens)`
      );

      return included;
    },
  };
}

/**
 * Thrown by `createMessage` when the supplied client-owned UUID collides
 * with an already-persisted row (Postgres unique_violation, code 23505).
 * Lets the API route map this to a 409 idempotent-retry response. (Gap E14)
 */
export class MessageDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageDuplicateError";
  }
}

/**
 * Thrown by `getOrCreateConversation` when the supplied UUID exists in the
 * conversations table but RLS hides it from the calling user (i.e. the row
 * belongs to a different user). The route maps this to 404 — the user
 * cannot see or distinguish a cross-user UUID from a non-existent one.
 * (Gap E15)
 */
export class ConversationNotAccessibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationNotAccessibleError";
  }
}
