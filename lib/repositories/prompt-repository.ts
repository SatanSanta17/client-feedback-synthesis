// ---------------------------------------------------------------------------
// Prompt Repository Interface
// ---------------------------------------------------------------------------

export type PromptKey =
  | "signal_extraction"
  | "master_signal_cold_start"
  | "master_signal_incremental";

export interface PromptVersionRow {
  id: string;
  prompt_key: PromptKey;
  content: string;
  author_id: string | null;
  author_email: string;
  is_active: boolean;
  created_at: string;
}

export interface PromptRepository {
  /** Fetch the active prompt content for a given key. Returns null if none found. */
  getActive(promptKey: PromptKey): Promise<string | null>;

  /** Fetch the version history for a given prompt key, newest first. */
  getHistory(promptKey: PromptKey): Promise<PromptVersionRow[]>;

  /** Deactivate the current active version for a given key. */
  deactivateCurrent(promptKey: PromptKey): Promise<void>;

  /** Insert a new active prompt version. Returns the created row. */
  create(input: {
    promptKey: PromptKey;
    content: string;
    authorId: string;
    authorEmail: string;
  }): Promise<PromptVersionRow>;
}
