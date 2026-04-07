import { type SupabaseClient } from "@supabase/supabase-js";

import {
  SessionNotFoundRepoError,
  type SessionRepository,
  type SessionListFilters,
  type SessionRow,
  type SessionInsert,
  type SessionUpdate,
  type SessionDeleteResult,
  type SessionAccessRow,
} from "../session-repository";
import { scopeByTeam } from "./scope-by-team";

/**
 * Factory for creating a Supabase-backed SessionRepository.
 *
 * @param supabase      - Anon client (RLS-scoped)
 * @param serviceClient - Service-role client (for soft-delete, profile lookups)
 * @param teamId        - Active workspace scope (null = personal)
 */
export function createSessionRepository(
  supabase: SupabaseClient,
  serviceClient: SupabaseClient,
  teamId: string | null
): SessionRepository {
  return {
    async list(filters: SessionListFilters): Promise<{ rows: SessionRow[]; total: number }> {
      const { clientId, dateFrom, dateTo, offset, limit } = filters;

      console.log("[supabase-session-repo] list — filters:", JSON.stringify(filters), "teamId:", teamId);

      let query = supabase
        .from("sessions")
        .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, clients(name)", { count: "exact" })
        .is("deleted_at", null)
        .order("session_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      query = scopeByTeam(query, teamId);

      if (clientId) {
        query = query.eq("client_id", clientId);
      }
      if (dateFrom) {
        query = query.gte("session_date", dateFrom);
      }
      if (dateTo) {
        query = query.lte("session_date", dateTo);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error("[supabase-session-repo] list error:", error);
        throw new Error("Failed to fetch sessions");
      }

      const rows: SessionRow[] = (data ?? []).map((row) => {
        const clientData = row.clients as unknown as { name: string } | null;
        return {
          id: row.id,
          client_id: row.client_id,
          session_date: row.session_date,
          raw_notes: row.raw_notes,
          structured_notes: row.structured_notes ?? null,
          created_by: row.created_by,
          created_at: row.created_at,
          client_name: clientData?.name ?? "Unknown",
        };
      });

      console.log("[supabase-session-repo] list —", rows.length, "of", count, "total");
      return { rows, total: count ?? 0 };
    },

    async findById(sessionId: string): Promise<SessionAccessRow | null> {
      console.log("[supabase-session-repo] findById —", sessionId);

      const { data } = await supabase
        .from("sessions")
        .select("id, created_by")
        .eq("id", sessionId)
        .is("deleted_at", null)
        .single();

      if (!data) {
        console.log("[supabase-session-repo] findById — not found");
        return null;
      }

      console.log("[supabase-session-repo] findById — found:", data.id);
      return data;
    },

    async create(input: SessionInsert): Promise<SessionRow> {
      console.log("[supabase-session-repo] create — client_id:", input.client_id);

      const { data, error } = await supabase
        .from("sessions")
        .insert({
          client_id: input.client_id,
          session_date: input.session_date,
          raw_notes: input.raw_notes,
          structured_notes: input.structured_notes,
          team_id: teamId,
        })
        .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
        .single();

      if (error) {
        console.error("[supabase-session-repo] create error:", error);
        throw new Error("Failed to create session");
      }

      console.log("[supabase-session-repo] create success:", data.id);

      return {
        id: data.id,
        client_id: data.client_id,
        session_date: data.session_date,
        raw_notes: data.raw_notes,
        structured_notes: data.structured_notes ?? null,
        created_by: data.created_by,
        created_at: data.created_at,
        client_name: "", // Not available from insert; caller can enrich if needed
      };
    },

    async update(id: string, input: SessionUpdate): Promise<SessionRow> {
      console.log("[supabase-session-repo] update — id:", id);

      // Build update payload — only include structured_notes if explicitly provided
      // undefined = "don't touch it", null = "clear it", string = "set it"
      const updatePayload: Record<string, unknown> = {
        client_id: input.client_id,
        session_date: input.session_date,
        raw_notes: input.raw_notes,
      };

      if (input.structured_notes !== undefined) {
        updatePayload.structured_notes = input.structured_notes;
      }

      const { data, error } = await supabase
        .from("sessions")
        .update(updatePayload)
        .eq("id", id)
        .is("deleted_at", null)
        .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
        .single();

      if (error) {
        // PGRST116 = no rows returned (not found or already deleted)
        if (error.code === "PGRST116") {
          console.warn("[supabase-session-repo] update — not found:", id);
          throw new SessionNotFoundRepoError(`Session ${id} not found`);
        }
        console.error("[supabase-session-repo] update error:", error);
        throw new Error("Failed to update session");
      }

      console.log("[supabase-session-repo] update success:", data.id);

      return {
        id: data.id,
        client_id: data.client_id,
        session_date: data.session_date,
        raw_notes: data.raw_notes,
        structured_notes: data.structured_notes ?? null,
        created_by: data.created_by,
        created_at: data.created_at,
        client_name: "", // Not available from update; caller can enrich if needed
      };
    },

    async softDelete(id: string): Promise<SessionDeleteResult> {
      console.log("[supabase-session-repo] softDelete — id:", id);

      // Uses service-role client to bypass RLS WITH CHECK constraint
      const { data, error } = await serviceClient
        .from("sessions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .is("deleted_at", null)
        .select("id, structured_notes, created_by, team_id")
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          console.warn("[supabase-session-repo] softDelete — not found:", id);
          throw new SessionNotFoundRepoError(`Session ${id} not found`);
        }
        console.error("[supabase-session-repo] softDelete error:", error);
        throw new Error("Failed to delete session");
      }

      console.log("[supabase-session-repo] softDelete success:", data.id);

      return {
        id: data.id,
        structured_notes: data.structured_notes ?? null,
        created_by: data.created_by,
        team_id: data.team_id ?? null,
      };
    },

    async getAttachmentCounts(sessionIds: string[]): Promise<Map<string, number>> {
      console.log("[supabase-session-repo] getAttachmentCounts —", sessionIds.length, "sessions");

      if (sessionIds.length === 0) {
        return new Map();
      }

      const { data } = await supabase
        .from("session_attachments")
        .select("session_id")
        .in("session_id", sessionIds)
        .is("deleted_at", null);

      const countMap = new Map<string, number>();
      for (const row of data ?? []) {
        countMap.set(
          row.session_id,
          (countMap.get(row.session_id) ?? 0) + 1
        );
      }

      console.log("[supabase-session-repo] getAttachmentCounts — done");
      return countMap;
    },

    async getCreatorEmails(userIds: string[]): Promise<Map<string, string>> {
      console.log("[supabase-session-repo] getCreatorEmails —", userIds.length, "users");

      if (userIds.length === 0) {
        return new Map();
      }

      const { data: profiles } = await serviceClient
        .from("profiles")
        .select("id, email")
        .in("id", userIds);

      const emailMap = new Map<string, string>();
      for (const p of profiles ?? []) {
        emailMap.set(p.id, p.email);
      }

      console.log("[supabase-session-repo] getCreatorEmails — done");
      return emailMap;
    },
  };
}

