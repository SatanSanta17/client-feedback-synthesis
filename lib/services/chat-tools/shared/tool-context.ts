// ---------------------------------------------------------------------------
// ChatToolContext — DI bag passed into every tool factory.
// PRD-033 P1.R6 (workspace scope invisible to model) + TRD § 1.4.
//
// Each tool factory receives this context; no tool ever reaches for a
// Supabase client or workspace identifier directly. Workspace scope is
// enforced at the service / repository layer.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatQueryRepository } from "@/lib/repositories/chat-query-repository";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";
import type { WorkspaceCtx } from "@/lib/services/workspace-context";

export type { WorkspaceCtx };

export interface ChatToolContext {
  workspace: WorkspaceCtx;
  // Repositories
  chatQueryRepo: ChatQueryRepository;
  embeddingRepo: EmbeddingRepository;
  // Direct supabase access for the aggregation tool, which delegates to the
  // existing database-query domain modules (those take a SupabaseClient).
  supabaseClient: SupabaseClient;
  // Streaming-side
  emitStatus: (message: string) => void;
  /**
   * The user's most recent message text — threaded into the context so each
   * tool's `execute()` can run the filter sanitiser (`shared/filter-
   * sanitiser.ts`) against it. Re-introduced post-PRD-033-cutover when
   * GPT-4o was observed inventing categorical filter values that the
   * per-tool Zod schemas couldn't catch. Provider-agnostic defence.
   */
  lastUserMessage: string;
  /**
   * Per-turn accumulator of client / theme names returned by `list_clients`
   * and `list_themes`. The filter sanitiser consults this set when deciding
   * whether to keep a `clientName` / `themeName` filter whose literal value
   * doesn't appear in the user message — common when the model resolves
   * "PT Power" via `list_clients` and then passes the canonical
   * "PrudenTech Power" as the filter. Without this, the sanitiser would
   * drop a legitimately-resolved name. Lifecycle: created fresh by
   * `chat-stream-service` per turn; mutated by `list_clients` and
   * `list_themes` execute paths.
   */
  resolvedNames: {
    clients: Set<string>;
    themes: Set<string>;
  };
}
