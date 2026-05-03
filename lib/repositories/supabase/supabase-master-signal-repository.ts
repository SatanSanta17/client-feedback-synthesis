import { type SupabaseClient } from "@supabase/supabase-js";

import type { MasterSignalRepository, MasterSignalRow } from "../master-signal-repository";
import type { SignalSession } from "@/lib/types/signal-session";
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import { renderExtractedSignalsToMarkdown } from "@/lib/utils/render-extracted-signals-to-markdown";
import { scopeByTeam } from "./scope-by-team";

// Predicate used by every signal-session query: include rows that have either
// structured_json (post-PRD-031 Part 1) or legacy structured_notes (pre-PRD-031).
const HAS_EXTRACTION_OUTPUT = "structured_notes.not.is.null,structured_json.not.is.null";

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

      query = scopeByTeam(query, teamId);

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
        .or(HAS_EXTRACTION_OUTPUT)
        .is("deleted_at", null);

      query = scopeByTeam(query, teamId);

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
        .select("id, session_date, structured_notes, structured_json, updated_at, clients(name)")
        .or(HAS_EXTRACTION_OUTPUT)
        .is("deleted_at", null)
        .order("session_date", { ascending: true });

      query = scopeByTeam(query, teamId);

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
        .select("id, session_date, structured_notes, structured_json, updated_at, clients(name)")
        .or(HAS_EXTRACTION_OUTPUT)
        .is("deleted_at", null)
        .gt("updated_at", since)
        .order("session_date", { ascending: true });

      query = scopeByTeam(query, teamId);

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
  structured_json: unknown;
  updated_at: string;
  clients: unknown;
}): SignalSession {
  const clientData = row.clients as { name: string } | null;
  return {
    id: row.id,
    clientName: clientData?.name ?? "Unknown",
    sessionDate: row.session_date,
    structuredNotes: composeStructuredNotes(row),
    updatedAt: row.updated_at,
  };
}

/**
 * Composes the markdown view of a session for master-signal synthesis.
 *
 * - Post-PRD-031 sessions have only `structured_json` — render markdown on demand.
 * - Pre-PRD-031 (post-PRD-018) sessions have both — prefer JSON (single source of truth).
 * - Pre-PRD-018 legacy sessions have only `structured_notes` — pass through.
 *
 * If JSON rendering throws (malformed shape), fall back to legacy markdown
 * if available rather than dropping the session from the master signal.
 */
function composeStructuredNotes(row: {
  id: string;
  structured_notes: string | null;
  structured_json: unknown;
}): string {
  if (row.structured_json !== null && row.structured_json !== undefined) {
    try {
      return renderExtractedSignalsToMarkdown(row.structured_json as ExtractedSignals);
    } catch (err) {
      console.warn(
        `[supabase-master-signal-repo] composeStructuredNotes — failed to render structured_json for session ${row.id}, falling back to structured_notes:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (row.structured_notes !== null) {
    return row.structured_notes;
  }

  // Defensive — the OR filter on the SELECT prevents this branch in practice.
  console.warn(
    `[supabase-master-signal-repo] composeStructuredNotes — session ${row.id} has neither structured_json nor structured_notes`
  );
  return "";
}
