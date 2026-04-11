import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  ConversationRepository,
  ConversationInsert,
  ConversationUpdate,
} from "../conversation-repository";
import type { Conversation, ConversationListOptions } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[supabase-conversation-repo]";

const COLUMNS = "id, title, created_by, team_id, is_pinned, is_archived, created_at, updated_at";

/**
 * Maps a raw Supabase row (snake_case) to a domain Conversation (camelCase).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row types are loosely typed
function toConversation(row: any): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    teamId: row.team_id ?? null,
    isPinned: row.is_pinned ?? false,
    isArchived: row.is_archived ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase-backed ConversationRepository.
 *
 * @param supabase - Anon client (RLS-scoped, user-private)
 */
export function createConversationRepository(
  supabase: SupabaseClient
): ConversationRepository {
  return {
    async create(data: ConversationInsert): Promise<Conversation> {
      console.log(`${LOG_PREFIX} create — title: "${data.title.slice(0, 40)}…", teamId: ${data.team_id ?? "personal"}`);

      const { data: row, error } = await supabase
        .from("conversations")
        .insert({
          title: data.title,
          created_by: data.created_by,
          team_id: data.team_id,
        })
        .select(COLUMNS)
        .single();

      if (error) {
        console.error(`${LOG_PREFIX} create error:`, error);
        throw new Error("Failed to create conversation");
      }

      console.log(`${LOG_PREFIX} created — id: ${row.id}`);
      return toConversation(row);
    },

    async list(
      userId: string,
      teamId: string | null,
      options: ConversationListOptions
    ): Promise<Conversation[]> {
      const { archived = false, search, limit, cursor } = options;

      console.log(
        `${LOG_PREFIX} list — userId: ${userId}, teamId: ${teamId ?? "personal"}, archived: ${archived}, limit: ${limit}, cursor: ${cursor ?? "none"}, search: ${search ?? "none"}`
      );

      // Base query: user-private (RLS enforces created_by = auth.uid())
      // Filter by team context for scoping
      let query = supabase
        .from("conversations")
        .select(COLUMNS)
        .eq("is_archived", archived);

      // Team scoping: conversations store the team context they were created in
      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      // Title search (case-insensitive substring)
      if (search) {
        query = query.ilike("title", `%${search}%`);
      }

      // Cursor-based pagination: fetch conversations older than the cursor.
      // Uses compound cursor (updated_at + id) to handle timestamp collisions.
      const cursorId = options.cursorId;
      if (cursor && cursorId) {
        // Rows where updated_at < cursor, OR updated_at == cursor AND id < cursorId
        query = query.or(
          `updated_at.lt.${cursor},and(updated_at.eq.${cursor},id.lt.${cursorId})`
        );
      } else if (cursor) {
        query = query.lt("updated_at", cursor);
      }

      // Order: pinned first (desc = true first), then by updated_at desc, then id desc (tiebreaker)
      query = query
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      const { data, error } = await query;

      if (error) {
        console.error(`${LOG_PREFIX} list error:`, error);
        throw new Error("Failed to list conversations");
      }

      const conversations = (data ?? []).map(toConversation);
      console.log(`${LOG_PREFIX} list — returned ${conversations.length} conversations`);
      return conversations;
    },

    async getById(id: string): Promise<Conversation | null> {
      console.log(`${LOG_PREFIX} getById — id: ${id}`);

      const { data: row, error } = await supabase
        .from("conversations")
        .select(COLUMNS)
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // No rows returned — not found or RLS denied
          console.log(`${LOG_PREFIX} getById — not found: ${id}`);
          return null;
        }
        console.error(`${LOG_PREFIX} getById error:`, error);
        throw new Error("Failed to fetch conversation");
      }

      return toConversation(row);
    },

    async update(id: string, data: ConversationUpdate): Promise<Conversation> {
      console.log(`${LOG_PREFIX} update — id: ${id}, fields: ${JSON.stringify(data)}`);

      const { data: row, error } = await supabase
        .from("conversations")
        .update(data)
        .eq("id", id)
        .select(COLUMNS)
        .single();

      if (error) {
        console.error(`${LOG_PREFIX} update error:`, error);
        throw new Error("Failed to update conversation");
      }

      console.log(`${LOG_PREFIX} updated — id: ${row.id}`);
      return toConversation(row);
    },

    async delete(id: string): Promise<void> {
      console.log(`${LOG_PREFIX} delete — id: ${id}`);

      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", id);

      if (error) {
        console.error(`${LOG_PREFIX} delete error:`, error);
        throw new Error("Failed to delete conversation");
      }

      console.log(`${LOG_PREFIX} deleted — id: ${id}`);
    },

    async updateTitle(id: string, title: string): Promise<void> {
      console.log(`${LOG_PREFIX} updateTitle — id: ${id}, title: "${title.slice(0, 40)}…"`);

      const { error } = await supabase
        .from("conversations")
        .update({ title })
        .eq("id", id);

      if (error) {
        console.error(`${LOG_PREFIX} updateTitle error:`, error);
        throw new Error("Failed to update conversation title");
      }

      console.log(`${LOG_PREFIX} titleUpdated — id: ${id}`);
    },
  };
}
