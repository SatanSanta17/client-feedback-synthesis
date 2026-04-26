import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractedSignals,
} from "@/lib/schemas/extraction-schema";
import type { SessionMeta } from "@/lib/types/embedding-chunk";
import {
  chunkRawNotes,
  chunkStructuredSignals,
} from "@/lib/services/chunking-service";
import { generateSessionEmbeddings } from "@/lib/services/embedding-orchestrator";
import { assignSessionThemes } from "@/lib/services/theme-service";
import { maybeRefreshDashboardInsights } from "@/lib/services/insight-service";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import { createInsightRepository } from "@/lib/repositories/supabase/supabase-insight-repository";
import { createSignalThemeRepository } from "@/lib/repositories/supabase/supabase-signal-theme-repository";
import { createThemeRepository } from "@/lib/repositories/supabase/supabase-theme-repository";

export interface SessionPostResponseChainInput {
  sessionId: string;
  userId: string;
  teamId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredJson: ExtractedSignals | null;
  serviceClient: SupabaseClient;
  /** Set true for re-extract on PUT — deletes existing embeddings before
   *  re-embedding (forwarded to generateSessionEmbeddings). */
  isReExtraction?: boolean;
  /** Log prefix used for chain-timing and chain-failure log lines.
   *  Routes pass `[POST /api/sessions]` or `[PUT /api/sessions/[id]]` so
   *  production grep patterns and dashboards continue to match (P3.R2). */
  logPrefix: string;
}

/**
 * Runs the post-response chain triggered by session create / re-extract:
 *   generateSessionEmbeddings → assignSessionThemes → maybeRefreshDashboardInsights.
 *
 * Owns sessionMeta construction, chunk selection, repo creation, per-stage
 * timing logs, and unconditional error logging. Returns void; failures are
 * logged but never rethrown — the caller registers this in `after()` and
 * does not await its result.
 */
export async function runSessionPostResponseChain(
  input: SessionPostResponseChainInput
): Promise<void> {
  const {
    sessionId,
    userId,
    teamId,
    clientName,
    sessionDate,
    rawNotes,
    structuredJson,
    serviceClient,
    isReExtraction = false,
    logPrefix,
  } = input;

  const sessionMeta: SessionMeta = {
    sessionId,
    clientName,
    sessionDate,
    teamId,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
  };

  const chunks = structuredJson
    ? chunkStructuredSignals(structuredJson, sessionMeta)
    : chunkRawNotes(rawNotes, sessionMeta);

  const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
  const themeRepo = createThemeRepository(serviceClient, teamId);
  const signalThemeRepo = createSignalThemeRepository(serviceClient);

  const chainStart = Date.now();

  try {
    const embeddingIds = await generateSessionEmbeddings({
      sessionMeta,
      structuredJson,
      rawNotes,
      embeddingRepo,
      isReExtraction,
      preComputedChunks: chunks,
    });
    console.log(
      `${logPrefix} chain timing — embeddings: ${Date.now() - chainStart}ms — sessionId: ${sessionId}`
    );

    if (!embeddingIds || embeddingIds.length === 0) return;

    const themeStart = Date.now();
    await assignSessionThemes({
      chunks,
      embeddingIds,
      teamId,
      userId,
      themeRepo,
      signalThemeRepo,
    });
    console.log(
      `${logPrefix} chain timing — themes: ${Date.now() - themeStart}ms — sessionId: ${sessionId}`
    );

    const insightStart = Date.now();
    const insightRepo = createInsightRepository(serviceClient);
    await maybeRefreshDashboardInsights({
      teamId,
      userId,
      insightRepo,
      supabase: serviceClient,
    });
    console.log(
      `${logPrefix} chain timing — insights: ${Date.now() - insightStart}ms; total: ${Date.now() - chainStart}ms — sessionId: ${sessionId}`
    );
  } catch (err) {
    console.error(
      `${logPrefix} EMBEDDING+THEME+INSIGHTS CHAIN FAILED — sessionId:`,
      sessionId,
      "elapsedMs:",
      Date.now() - chainStart,
      "error:",
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined
    );
  }
}
