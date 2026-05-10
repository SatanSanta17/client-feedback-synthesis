// ---------------------------------------------------------------------------
// ChatToolContext — DI bag passed into every tool factory.
// PRD-033 P1.R6 (workspace scope invisible to model) + TRD § 1.4.
//
// Forward-compat: Part 2 will add `cheapModel: LanguageModel` for
// summarise_sessions; Part 3 will add `recordToolResultTokens` telemetry hooks
// for the per-turn cost circuit breaker. Both are additive.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatQueryRepository } from "@/lib/repositories/chat-query-repository";
import type { EmbeddingRepository } from "@/lib/repositories/embedding-repository";

export interface WorkspaceCtx {
  teamId: string | null;
  userId: string;
}

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
}
