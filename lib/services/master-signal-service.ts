import type { PromptRepository } from "@/lib/repositories/prompt-repository";
import type {
  MasterSignalRepository,
  MasterSignalRow,
} from "@/lib/repositories/master-signal-repository";
import { synthesiseMasterSignal } from "@/lib/services/ai-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MasterSignal {
  id: string;
  content: string;
  generatedAt: string;
  sessionsIncluded: number;
  createdBy: string;
  createdAt: string;
  isTainted: boolean;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch the latest master signal (most recent by generated_at).
 * Returns null if no master signal has been generated yet.
 */
export async function getLatestMasterSignal(
  repo: MasterSignalRepository
): Promise<MasterSignal | null> {
  console.log("[master-signal-service] getLatestMasterSignal");

  const row = await repo.getLatest();

  if (!row) {
    console.log("[master-signal-service] getLatestMasterSignal — none found");
    return null;
  }

  console.log("[master-signal-service] getLatestMasterSignal — found:", row.id);
  return mapRow(row);
}

/**
 * Count sessions that have structured_notes and were updated after the given
 * timestamp.
 *
 * If `since` is null, counts ALL sessions with structured_notes (useful when
 * no master signal exists yet).
 */
export async function getStaleSessionCount(
  repo: MasterSignalRepository,
  since: string | null
): Promise<number> {
  console.log("[master-signal-service] getStaleSessionCount — since:", since);

  const count = await repo.getStaleSessionCount(since);

  console.log("[master-signal-service] getStaleSessionCount —", count);
  return count;
}

/**
 * Mark the latest master signal as tainted (contains data from a now-deleted
 * session). No-op if no master signal exists or if already tainted.
 */
export async function taintLatestMasterSignal(
  repo: MasterSignalRepository,
  userId: string,
  teamId?: string
): Promise<void> {
  console.log(
    "[master-signal-service] taintLatestMasterSignal — userId:",
    userId,
    "teamId:",
    teamId
  );

  await repo.taintLatest(userId, teamId);

  console.log("[master-signal-service] taintLatestMasterSignal — done");
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type GenerateResult =
  | { outcome: "created"; masterSignal: MasterSignal }
  | { outcome: "unchanged"; masterSignal: MasterSignal }
  | { outcome: "no-sessions"; message: string };

/**
 * Orchestrates master signal generation. Determines cold start vs. incremental
 * based on whether a previous master signal exists and whether it's tainted.
 *
 * Returns a discriminated union — the caller maps outcomes to HTTP responses.
 */
export async function generateOrUpdateMasterSignal(
  repo: MasterSignalRepository,
  promptRepo: PromptRepository
): Promise<GenerateResult> {
  const latest = await getLatestMasterSignal(repo);

  // Cold start or tainted — synthesise from all sessions
  if (!latest || latest.isTainted) {
    const mode = latest?.isTainted ? "tainted cold start" : "cold start";
    console.log(
      `[master-signal-service] generateOrUpdateMasterSignal — ${mode}`
    );

    const sessions = await repo.getAllSignalSessions();

    if (sessions.length === 0) {
      const message = latest?.isTainted
        ? "No extracted signals found. All sessions with signals have been deleted."
        : "No extracted signals found. Extract signals from individual sessions on the Capture page first.";
      return { outcome: "no-sessions", message };
    }

    console.log(
      `[master-signal-service] generateOrUpdateMasterSignal — synthesising from ${sessions.length} sessions`
    );

    const content = await synthesiseMasterSignal(promptRepo, { sessions });
    const savedRow = await repo.save(content, sessions.length);
    const saved = mapRow(savedRow);

    console.log(
      `[master-signal-service] generateOrUpdateMasterSignal — saved: ${saved.id}`
    );
    return { outcome: "created", masterSignal: saved };
  }

  // Incremental — merge new sessions into existing master signal
  console.log(
    `[master-signal-service] generateOrUpdateMasterSignal — incremental since ${latest.generatedAt}`
  );

  const newSessions = await repo.getSignalSessionsSince(latest.generatedAt);

  if (newSessions.length === 0) {
    console.log(
      "[master-signal-service] generateOrUpdateMasterSignal — no new sessions"
    );
    return { outcome: "unchanged", masterSignal: latest };
  }

  console.log(
    `[master-signal-service] generateOrUpdateMasterSignal — merging ${newSessions.length} new session(s)`
  );

  const content = await synthesiseMasterSignal(promptRepo, {
    previousMasterSignal: latest.content,
    sessions: newSessions,
  });

  const totalSessions = latest.sessionsIncluded + newSessions.length;
  const savedRow = await repo.save(content, totalSessions);
  const saved = mapRow(savedRow);

  console.log(
    `[master-signal-service] generateOrUpdateMasterSignal — saved: ${saved.id}`
  );
  return { outcome: "created", masterSignal: saved };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a repository row (snake_case) to the service-level MasterSignal
 * interface (camelCase).
 */
function mapRow(row: MasterSignalRow): MasterSignal {
  return {
    id: row.id,
    content: row.content,
    generatedAt: row.generated_at,
    sessionsIncluded: row.sessions_included,
    createdBy: row.created_by,
    createdAt: row.created_at,
    isTainted: row.is_tainted,
  };
}
