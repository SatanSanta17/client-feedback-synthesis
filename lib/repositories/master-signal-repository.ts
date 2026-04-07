// ---------------------------------------------------------------------------
// Master Signal Repository Interface
// ---------------------------------------------------------------------------

import type { SignalSession } from "@/lib/types/signal-session";

export interface MasterSignalRow {
  id: string;
  content: string;
  generated_at: string;
  sessions_included: number;
  created_by: string;
  created_at: string;
  is_tainted: boolean;
}

export interface MasterSignalRepository {
  /** Fetch the latest master signal (most recent by generated_at). */
  getLatest(): Promise<MasterSignalRow | null>;

  /**
   * Count sessions with structured_notes updated after the given timestamp.
   * If `since` is null, counts ALL sessions with structured_notes.
   */
  getStaleSessionCount(since: string | null): Promise<number>;

  /** Fetch all non-deleted sessions with structured_notes, joined with client names. */
  getAllSignalSessions(): Promise<SignalSession[]>;

  /** Fetch sessions with structured_notes updated after the given timestamp. */
  getSignalSessionsSince(since: string): Promise<SignalSession[]>;

  /** Persist a new master signal row. Returns the created row. */
  save(content: string, sessionsIncluded: number): Promise<MasterSignalRow>;

  /**
   * Mark the latest master signal as tainted. Scoped by teamId or userId.
   * No-op if no master signal exists or already tainted.
   */
  taintLatest(userId: string, teamId?: string): Promise<void>;
}
