import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  ChatClientListFilters,
  ChatClientRow,
  ChatQueryRepository,
  ChatSessionHeader,
  ChatSessionListFilters,
  ChatSessionRow,
  ChatThemeListFilters,
  ChatThemeRow,
} from "../chat-query-repository";

const LOG_PREFIX = "[supabase-chat-query-repo]";
const DEFAULT_SESSION_LIMIT = 50;
const DEFAULT_CLIENT_LIMIT = 50;
const DEFAULT_THEME_LIMIT = 50;

/**
 * Factory for the chat-tool data-access layer.
 *
 * @param supabase  - service-role or workspace-scoped client. The chat surface
 *                    uses the service-role client because (a) the route has
 *                    already authenticated the user, (b) we need cross-table
 *                    joins (sessions ⨝ clients ⨝ signal_themes) that are
 *                    cleaner with service-role, and (c) all query methods on
 *                    this repo enforce workspace scope explicitly via the
 *                    teamId / userId pair.
 */
export function createChatQueryRepository(
  supabase: SupabaseClient,
  teamId: string | null,
  userId: string
): ChatQueryRepository {
  return {
    async listClients(filters: ChatClientListFilters): Promise<ChatClientRow[]> {
      const limit = filters.limit ?? DEFAULT_CLIENT_LIMIT;
      console.log(
        `${LOG_PREFIX} listClients — teamId: ${teamId}, hasSessions: ${filters.hasSessions ?? false}, search: ${filters.nameSearch ?? ""}, limit: ${limit}`
      );

      // Single RPC hop — GROUP BY on `sessions` happens in Postgres, not by
      // pulling every session row into Node. PRD-033 audit fix #11.
      const { data, error } = await supabase.rpc(
        "list_clients_with_session_counts",
        {
          filter_team_id: teamId,
          filter_user_id: !teamId ? userId : null,
          filter_name_search:
            filters.nameSearch && filters.nameSearch.trim().length > 0
              ? filters.nameSearch.trim()
              : null,
          filter_has_sessions: filters.hasSessions ?? false,
          match_limit: limit,
        }
      );

      if (error) {
        console.error(`${LOG_PREFIX} listClients — error:`, error.message);
        throw new Error(`listClients failed: ${error.message}`);
      }

      const out: ChatClientRow[] = (data ?? []).map(
        (row: {
          name: string;
          session_count: number | string;
          last_session_date: string | null;
        }) => ({
          name: row.name,
          sessionCount: Number(row.session_count),
          lastSessionDate: row.last_session_date,
        })
      );

      console.log(`${LOG_PREFIX} listClients — returning ${out.length} clients`);
      return out;
    },

    async listSessions(filters: ChatSessionListFilters): Promise<ChatSessionRow[]> {
      const limit = filters.limit ?? DEFAULT_SESSION_LIMIT;
      console.log(
        `${LOG_PREFIX} listSessions — teamId: ${teamId}, filters: ${JSON.stringify({ ...filters, limit })}`
      );

      // Step 1: resolve client_id from clientName if provided
      let resolvedClientId: string | undefined;
      if (filters.clientName) {
        let cq = supabase
          .from("clients")
          .select("id")
          .ilike("name", filters.clientName);
        if (teamId) cq = cq.eq("team_id", teamId);
        else cq = cq.is("team_id", null);

        const { data: cRows } = await cq.maybeSingle();
        if (!cRows) return [];
        resolvedClientId = (cRows as { id: string }).id;
      }

      // Step 2: signal-level filter resolution. For each signal-level filter
      // we collect the set of session_ids that satisfy it; the final session
      // list is the AND of all such sets (intersection), then session-level
      // filters are applied.
      const signalFilteredSessionIds = await resolveSignalLevelFilters(
        supabase,
        teamId,
        filters
      );
      if (signalFilteredSessionIds && signalFilteredSessionIds.length === 0) {
        return [];
      }

      // Step 3: pull session rows with session-level filters applied
      let sq = supabase
        .from("sessions")
        .select("id, client_id, session_date, structured_json, clients(name)")
        .is("deleted_at", null)
        .order("session_date", { ascending: false })
        .limit(limit);

      if (teamId) sq = sq.eq("team_id", teamId);
      else sq = sq.is("team_id", null).eq("created_by", userId);

      if (resolvedClientId) sq = sq.eq("client_id", resolvedClientId);
      if (filters.dateFrom) sq = sq.gte("session_date", filters.dateFrom);
      if (filters.dateTo) sq = sq.lte("session_date", filters.dateTo);
      if (signalFilteredSessionIds) sq = sq.in("id", signalFilteredSessionIds);

      const { data: sRows, error: sErr } = await sq;
      if (sErr) {
        console.error(`${LOG_PREFIX} listSessions sessions — error:`, sErr.message);
        throw new Error(`listSessions failed: ${sErr.message}`);
      }

      // Step 4: in-memory sentiment filter (lives in structured_json) and
      // theme name resolution.
      const sessionIds = (sRows ?? []).map((r) => r.id as string);
      const themesBySessionId = await fetchThemesForSessions(
        supabase,
        sessionIds,
        teamId
      );

      const out: ChatSessionRow[] = [];
      for (const row of sRows ?? []) {
        const structured = (row.structured_json ?? {}) as Record<string, unknown>;
        const sentiment = (structured.overall_sentiment ?? structured.sentiment ?? null) as string | null;
        const urgency = (structured.urgency ?? null) as string | null;

        if (filters.sentiment && sentiment !== filters.sentiment) continue;

        const clientData = row.clients as unknown as { name: string } | null;

        out.push({
          id: row.id as string,
          clientName: clientData?.name ?? "Unknown",
          sessionDate: row.session_date as string,
          sentiment,
          urgency,
          themeNames: themesBySessionId.get(row.id as string) ?? [],
        });
      }

      console.log(`${LOG_PREFIX} listSessions — returning ${out.length} sessions`);
      return out;
    },

    async listThemes(filters: ChatThemeListFilters): Promise<ChatThemeRow[]> {
      const limit = filters.limit ?? DEFAULT_THEME_LIMIT;
      console.log(
        `${LOG_PREFIX} listThemes — teamId: ${teamId}, search: ${filters.nameSearch ?? ""}, dateFrom: ${filters.dateFrom ?? ""}`
      );

      // Pull active themes for workspace
      let tq = supabase
        .from("themes")
        .select("id, name")
        .eq("is_archived", false);

      if (teamId) tq = tq.eq("team_id", teamId);
      else tq = tq.is("team_id", null);

      if (filters.nameSearch && filters.nameSearch.trim().length > 0) {
        tq = tq.ilike("name", `%${filters.nameSearch.trim()}%`);
      }

      const { data: themes, error: tErr } = await tq;
      if (tErr) {
        console.error(`${LOG_PREFIX} listThemes — error:`, tErr.message);
        throw new Error(`listThemes failed: ${tErr.message}`);
      }

      const themeIds = (themes ?? []).map((t: { id: string }) => t.id);
      if (themeIds.length === 0) return [];

      // Resolve which sessions are in scope (and pass date filter if any).
      let scopeSessions = supabase
        .from("sessions")
        .select("id")
        .is("deleted_at", null);
      if (teamId) scopeSessions = scopeSessions.eq("team_id", teamId);
      else scopeSessions = scopeSessions.is("team_id", null).eq("created_by", userId);
      if (filters.dateFrom) scopeSessions = scopeSessions.gte("session_date", filters.dateFrom);
      if (filters.dateTo) scopeSessions = scopeSessions.lte("session_date", filters.dateTo);

      const { data: scopeRows, error: scopeErr } = await scopeSessions;
      if (scopeErr) {
        console.error(`${LOG_PREFIX} listThemes scope — error:`, scopeErr.message);
        throw new Error(`listThemes scope failed: ${scopeErr.message}`);
      }
      const scopeIds = (scopeRows ?? []).map((r: { id: string }) => r.id);
      if (scopeIds.length === 0) return [];

      // Pull embeddings in scope
      const { data: embRows, error: eErr } = await supabase
        .from("session_embeddings")
        .select("id")
        .in("session_id", scopeIds);
      if (eErr) {
        console.error(`${LOG_PREFIX} listThemes embeddings — error:`, eErr.message);
        throw new Error(`listThemes embeddings failed: ${eErr.message}`);
      }
      const inScopeEmbeddingIds = new Set(
        (embRows ?? []).map((r: { id: string }) => r.id)
      );

      // signal_themes — count per theme_id where embedding_id is in scope
      const { data: junctionRows, error: jErr } = await supabase
        .from("signal_themes")
        .select("theme_id, embedding_id")
        .in("theme_id", themeIds);
      if (jErr) {
        console.error(`${LOG_PREFIX} listThemes junction — error:`, jErr.message);
        throw new Error(`listThemes junction failed: ${jErr.message}`);
      }

      const counts = new Map<string, number>();
      for (const j of junctionRows ?? []) {
        if (!inScopeEmbeddingIds.has(j.embedding_id as string)) continue;
        counts.set(j.theme_id as string, (counts.get(j.theme_id as string) ?? 0) + 1);
      }

      const themeNamesById = new Map<string, string>(
        (themes ?? []).map((t: { id: string; name: string }) => [t.id, t.name])
      );

      const out: ChatThemeRow[] = [...counts.entries()]
        .map(([themeId, count]) => ({
          name: themeNamesById.get(themeId) ?? "Unknown",
          mentionCount: count,
        }))
        .filter((row) => row.mentionCount > 0)
        .sort((a, b) => b.mentionCount - a.mentionCount)
        .slice(0, limit);

      console.log(`${LOG_PREFIX} listThemes — returning ${out.length} themes`);
      return out;
    },

    async fetchSessionHeaders(sessionIds: string[]): Promise<ChatSessionHeader[]> {
      if (sessionIds.length === 0) return [];
      console.log(`${LOG_PREFIX} fetchSessionHeaders — ${sessionIds.length} sessions`);

      let sq = supabase
        .from("sessions")
        .select("id, session_date, raw_notes, structured_json, clients(name)")
        .is("deleted_at", null)
        .in("id", sessionIds);

      if (teamId) sq = sq.eq("team_id", teamId);
      else sq = sq.is("team_id", null).eq("created_by", userId);

      const { data, error } = await sq;
      if (error) {
        console.error(`${LOG_PREFIX} fetchSessionHeaders — error:`, error.message);
        throw new Error(`fetchSessionHeaders failed: ${error.message}`);
      }

      const themesBySessionId = await fetchThemesForSessions(
        supabase,
        (data ?? []).map((r) => r.id as string),
        teamId
      );

      const out: ChatSessionHeader[] = (data ?? []).map((row) => {
        const structured = (row.structured_json ?? {}) as Record<string, unknown>;
        const clientData = row.clients as unknown as { name: string } | null;
        return {
          sessionId: row.id as string,
          clientName: clientData?.name ?? "Unknown",
          sessionDate: row.session_date as string,
          sentiment: (structured.overall_sentiment ?? structured.sentiment ?? null) as string | null,
          urgency: (structured.urgency ?? null) as string | null,
          themes: themesBySessionId.get(row.id as string) ?? [],
          rawNotes: (row.raw_notes ?? null) as string | null,
        };
      });

      return out;
    },

  };
}

// ---------------------------------------------------------------------------
// Module-scope helpers (private to this file).
// Extracted from the factory so they don't pollute ChatQueryRepository's
// public surface.
// ---------------------------------------------------------------------------

/**
 * Returns null if no signal-level filter was specified (caller skips this
 * narrowing). Returns the intersection of session_ids satisfying every
 * signal-level filter otherwise. Returns [] if any filter has no matches.
 */
async function resolveSignalLevelFilters(
  supabase: SupabaseClient,
  teamId: string | null,
  filters: ChatSessionListFilters
): Promise<string[] | null> {
  const haveSignalFilter =
    !!filters.themeName ||
    (filters.chunkTypes && filters.chunkTypes.length > 0) ||
    !!filters.severity ||
    !!filters.urgency;
  if (!haveSignalFilter) return null;

  const sets: Set<string>[] = [];

  // theme filter — go through signal_themes
  if (filters.themeName) {
    let tq = supabase
      .from("themes")
      .select("id")
      .ilike("name", filters.themeName)
      .eq("is_archived", false);
    if (teamId) tq = tq.eq("team_id", teamId);
    else tq = tq.is("team_id", null);

    const { data: tRows } = await tq;
    const themeIds = (tRows ?? []).map((t: { id: string }) => t.id);
    if (themeIds.length === 0) return [];

    const { data: jRows } = await supabase
      .from("signal_themes")
      .select("embedding_id")
      .in("theme_id", themeIds);
    const embeddingIds = (jRows ?? []).map(
      (r: { embedding_id: string }) => r.embedding_id
    );
    if (embeddingIds.length === 0) return [];

    const { data: eRows } = await supabase
      .from("session_embeddings")
      .select("session_id")
      .in("id", embeddingIds);
    sets.push(
      new Set((eRows ?? []).map((r: { session_id: string }) => r.session_id))
    );
  }

  // chunkTypes filter — pull session_ids that have at-least-one matching chunk
  if (filters.chunkTypes && filters.chunkTypes.length > 0) {
    let eq = supabase
      .from("session_embeddings")
      .select("session_id")
      .in("chunk_type", filters.chunkTypes);
    if (teamId) eq = eq.eq("team_id", teamId);
    else eq = eq.is("team_id", null);

    const { data: eRows } = await eq;
    sets.push(
      new Set((eRows ?? []).map((r: { session_id: string }) => r.session_id))
    );
  }

  // severity / urgency — push the metadata-JSONB filter into SQL via the
  // `metadata->>'<field>'` operator. The partial indexes from migration 003
  // (idx_session_embeddings_team_severity / _team_urgency) back this.
  // Previously this loaded every workspace embedding into Node and filtered
  // in-process — pathological at scale.
  if (filters.severity || filters.urgency) {
    let eq = supabase
      .from("session_embeddings")
      .select("session_id");
    if (teamId) eq = eq.eq("team_id", teamId);
    else eq = eq.is("team_id", null);
    if (filters.severity) {
      eq = eq.eq("metadata->>severity", filters.severity);
    }
    if (filters.urgency) {
      eq = eq.eq("metadata->>urgency", filters.urgency);
    }

    const { data: eRows, error: eErr } = await eq;
    if (eErr) {
      console.error(`${LOG_PREFIX} resolveSignalLevelFilters severity/urgency — error:`, eErr.message);
      throw new Error(`Severity/urgency lookup failed: ${eErr.message}`);
    }
    sets.push(
      new Set((eRows ?? []).map((r: { session_id: string }) => r.session_id))
    );
  }

  if (sets.length === 0) return null;

  // Intersection of all filter sets
  let intersection = sets[0];
  for (let i = 1; i < sets.length; i++) {
    intersection = new Set([...intersection].filter((x) => sets[i].has(x)));
  }
  return [...intersection];
}

async function fetchThemesForSessions(
  supabase: SupabaseClient,
  sessionIds: string[],
  teamId: string | null
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (sessionIds.length === 0) return result;

  // session_embeddings → signal_themes → themes. team scope is applied at
  // every layer (defense in depth): embeddings and themes both carry
  // team_id; signal_themes inherits scope via the embedding_id join.
  let embQ = supabase
    .from("session_embeddings")
    .select("id, session_id")
    .in("session_id", sessionIds);
  if (teamId) embQ = embQ.eq("team_id", teamId);
  else embQ = embQ.is("team_id", null);

  const { data: embRows } = await embQ;
  const embIdToSessionId = new Map<string, string>(
    (embRows ?? []).map((r: { id: string; session_id: string }) => [
      r.id,
      r.session_id,
    ])
  );
  const embIds = [...embIdToSessionId.keys()];
  if (embIds.length === 0) return result;

  const { data: junctionRows } = await supabase
    .from("signal_themes")
    .select("embedding_id, theme_id")
    .in("embedding_id", embIds);
  const themeIds = [
    ...new Set(
      (junctionRows ?? []).map((r: { theme_id: string }) => r.theme_id)
    ),
  ];
  if (themeIds.length === 0) return result;

  let themeQ = supabase
    .from("themes")
    .select("id, name")
    .in("id", themeIds);
  if (teamId) themeQ = themeQ.eq("team_id", teamId);
  else themeQ = themeQ.is("team_id", null);

  const { data: themeRows } = await themeQ;
  const themeNameById = new Map<string, string>(
    (themeRows ?? []).map((t: { id: string; name: string }) => [t.id, t.name])
  );

  for (const j of junctionRows ?? []) {
    const sessionId = embIdToSessionId.get(j.embedding_id as string);
    const themeName = themeNameById.get(j.theme_id as string);
    if (!sessionId || !themeName) continue;
    const list = result.get(sessionId) ?? [];
    if (!list.includes(themeName)) list.push(themeName);
    result.set(sessionId, list);
  }
  return result;
}
