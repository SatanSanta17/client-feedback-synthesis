import { type SupabaseClient } from "@supabase/supabase-js";

import type { MasterSignalRepository, MasterSignalRow } from "../master-signal-repository";
import type { SignalSession } from "@/lib/types/signal-session";

/**
 * Factory for creating a Supabase-backed MasterSignalRepository.
 *
 * @param supabase      - Anon client (RLS-scoped)
 * @param serviceClient - Service-role client (for taint operations)
 * @param teamId        - Active workspace scope (null = personal)
 */
export function createMasterSignalRepository(
  supabase: SupabaseClient,
  serviceClient: SupabaseClient,
  teamId: string | null
): MasterSignalRepository {
  return {
    async getLatest(): Promise<MasterSignalRow | null> {
      console.log("[supabase-master-signal-repo] getLatest — teamId:", teamId);

      let query = supabase
        .from("master_signals")
        .select("id, content, generated_at, sessions_included, created_by, created_at, is_tainted")
        .order("generated_at", { ascending: false })
        .limit(1);

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error("[supabase-master-signal-repo] getLatest error:", error);
        throw new Error("Failed to fetch master signal");
      }

      if (!data) {
        console.log("[supabase-master-signal-repo] getLatest — none found");
        return null;
      }

      console.log("[supabase-master-signal-repo] getLatest — found:", data.id);
      return data;
    },

    async getStaleSessionCount(since: string | null): Promise<number> {
      console.log("[supabase-master-signal-repo] getStaleSessionCount — since:", since, "teamId:", teamId);

      let query = supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .not("structured_notes", "is", null)
        .is("deleted_at", null);

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      if (since) {
        query = query.gt("updated_at", since);
      }

      const { count, error } = await query;

      if (error) {
        console.error("[supabase-master-signal-repo] getStaleSessionCount error:", error);
        throw new Error("Failed to count stale sessions");
      }

      const result = count ?? 0;
      console.log("[supabase-master-signal-repo] getStaleSessionCount —", result);
      return result;
    },

    async getAllSignalSessions(): Promise<SignalSession[]> {
      console.log("[supabase-master-signal-repo] getAllSignalSessions — teamId:", teamId);

      let query = supabase
        .from("sessions")
        .select("id, session_date, structured_notes, updated_at, clients(name)")
        .not("structured_notes", "is", null)
        .is("deleted_at", null)
        .order("session_date", { ascending: true });

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[supabase-master-signal-repo] getAllSignalSessions error:", error);
        throw new Error("Failed to fetch signal sessions");
      }

      const sessions = (data ?? []).map(mapSessionRow);
      console.log("[supabase-master-signal-repo] getAllSignalSessions —", sessions.length, "sessions");
      return sessions;
    },

    async getSignalSessionsSince(since: string): Promise<SignalSession[]> {
      console.log("[supabase-master-signal-repo] getSignalSessionsSince — since:", since, "teamId:", teamId);

      let query = supabase
        .from("sessions")
        .select("id, session_date, structured_notes, updated_at, clients(name)")
        .not("structured_notes", "is", null)
        .is("deleted_at", null)
        .gt("updated_at", since)
        .order("session_date", { ascending: true });

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else {
        query = query.is("team_id", null);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[supabase-master-signal-repo] getSignalSessionsSince error:", error);
        throw new Error("Failed to fetch signal sessions");
      }

      const sessions = (data ?? []).map(mapSessionRow);
      console.log("[supabase-master-signal-repo] getSignalSessionsSince —", sessions.length, "sessions");
      return sessions;
    },

    async save(content: string, sessionsIncluded: number): Promise<MasterSignalRow> {
      console.log("[supabase-master-signal-repo] save —", sessionsIncluded, "sessions included, teamId:", teamId);

      const { data, error } = await supabase
        .from("master_signals")
        .insert({
          content,
          sessions_included: sessionsIncluded,
          generated_at: new Date().toISOString(),
          team_id: teamId,
        })
        .select("id, content, generated_at, sessions_included, created_by, created_at, is_tainted")
        .single();

      if (error) {
        console.error("[supabase-master-signal-repo] save error:", error);
        throw new Error("Failed to save master signal");
      }

      console.log("[supabase-master-signal-repo] save success:", data.id);
      return data;
    },

    async taintLatest(userId: string, taintTeamId?: string): Promise<void> {
      console.log("[supabase-master-signal-repo] taintLatest — userId:", userId, "teamId:", taintTeamId);

      let query = serviceClient
        .from("master_signals")
        .select("id, is_tainted")
        .order("generated_at", { ascending: false })
        .limit(1);

      if (taintTeamId) {
        query = query.eq("team_id", taintTeamId);
      } else {
        query = query.eq("created_by", userId).is("team_id", null);
      }

      const { data: latest, error: fetchError } = await query.maybeSingle();

      if (fetchError) {
        console.error("[supabase-master-signal-repo] taintLatest fetch error:", fetchError);
        throw new Error("Failed to fetch latest master signal for tainting");
      }

      if (!latest) {
        console.log("[supabase-master-signal-repo] taintLatest — no master signal exists, skipping");
        return;
      }

      if (latest.is_tainted) {
        console.log("[supabase-master-signal-repo] taintLatest — already tainted, skipping");
        return;
      }

      const { error: updateError } = await serviceClient
        .from("master_signals")
        .update({ is_tainted: true })
        .eq("id", latest.id);

      if (updateError) {
        console.error("[supabase-master-signal-repo] taintLatest update error:", updateError);
        throw new Error("Failed to taint master signal");
      }

      console.log("[supabase-master-signal-repo] taintLatest — tainted:", latest.id);
    },
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function mapSessionRow(row: {
  id: string;
  session_date: string;
  structured_notes: string | null;
  updated_at: string;
  clients: unknown;
}): SignalSession {
  const clientData = row.clients as { name: string } | null;
  return {
    id: row.id,
    clientName: clientData?.name ?? "Unknown",
    sessionDate: row.session_date,
    structuredNotes: row.structured_notes ?? "",
    updatedAt: row.updated_at,
  };
}
