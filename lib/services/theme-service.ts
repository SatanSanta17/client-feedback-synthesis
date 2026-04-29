import type { EmbeddingChunk } from "@/lib/types/embedding-chunk";
import type { Theme, ThemeAssignmentResult } from "@/lib/types/theme";
import type { ThemeRepository, ThemeInsert } from "@/lib/repositories/theme-repository";
import type { SignalThemeRepository, SignalThemeInsert } from "@/lib/repositories/signal-theme-repository";
import {
  themeAssignmentResponseSchema,
  type ThemeAssignmentResponse,
} from "@/lib/schemas/theme-assignment-schema";
import {
  THEME_ASSIGNMENT_SYSTEM_PROMPT,
  THEME_ASSIGNMENT_MAX_TOKENS,
  buildThemeAssignmentUserMessage,
} from "@/lib/prompts/theme-assignment";
import { callModelObject } from "@/lib/services/ai-service";
import {
  runThemePrevention,
  type ProposedNewTheme,
  type PreventionResult,
} from "@/lib/services/theme-prevention";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assigns themes to a set of signal chunks from a single extraction.
 *
 * 1. Fetch active themes (with embeddings) for the workspace.
 * 2. Build the theme assignment prompt with signal texts + existing theme names.
 * 3. Call the LLM to assign each signal to existing or new themes.
 * 4. Run the embedding-based prevention pre-pass over LLM-proposed "new"
 *    themes (PRD-026 P1) — collapses semantic duplicates onto existing
 *    themes before any DB write.
 * 5. Resolve each assignment: cache hit → reuse, prevention decision →
 *    reuse-or-create-with-precomputed-embedding, fallback → unique-safe create.
 * 6. Bulk-insert signal_themes rows linking embeddings to resolved themes.
 *
 * Returns a result summary for logging, or null on failure.
 * Errors are logged but never thrown — this function is called in a
 * fire-and-forget chain from session routes.
 */
export async function assignSessionThemes(options: {
  chunks: EmbeddingChunk[];
  embeddingIds: string[];
  teamId: string | null;
  userId: string;
  themeRepo: ThemeRepository;
  signalThemeRepo: SignalThemeRepository;
}): Promise<ThemeAssignmentResult | null> {
  const { chunks, embeddingIds, teamId, userId, themeRepo, signalThemeRepo } = options;

  const sessionId = chunks[0]?.sessionId ?? "unknown";

  try {
    console.log(
      `[theme-service] assignSessionThemes — session: ${sessionId}, chunks: ${chunks.length}, embeddingIds: ${embeddingIds.length}`
    );

    // Guard: chunk count must match embedding ID count
    if (chunks.length !== embeddingIds.length) {
      console.error(
        `[theme-service] assignSessionThemes — chunk/embeddingId count mismatch: ${chunks.length} chunks vs ${embeddingIds.length} embeddingIds`
      );
      return null;
    }

    if (chunks.length === 0) {
      console.log(
        `[theme-service] assignSessionThemes — no chunks to assign, skipping`
      );
      return null;
    }

    // Step 1: Fetch active themes for the workspace
    const existingThemes = await themeRepo.getActiveByWorkspace(teamId, userId);
    console.log(
      `[theme-service] fetched ${existingThemes.length} existing themes for workspace (teamId: ${teamId})`
    );

    // Step 2: Build the prompt
    const signals = chunks.map((chunk, i) => ({
      index: i,
      text: chunk.chunkText,
      chunkType: chunk.chunkType,
      clientQuote: (chunk.metadata.client_quote as string) ?? undefined,
    }));

    const userMessage = buildThemeAssignmentUserMessage(
      signals,
      existingThemes.map((t) => ({ name: t.name, description: t.description }))
    );

    // Step 3: Call LLM
    console.log(
      `[theme-service] calling LLM for theme assignment — ${signals.length} signals, ${existingThemes.length} existing themes`
    );

    const llmResponse = await callModelObject<ThemeAssignmentResponse>({
      systemPrompt: THEME_ASSIGNMENT_SYSTEM_PROMPT,
      userMessage,
      schema: themeAssignmentResponseSchema,
      schemaName: "themeAssignmentResponse",
      maxTokens: THEME_ASSIGNMENT_MAX_TOKENS,
      operationName: "assignSessionThemes",
    });

    console.log(
      `[theme-service] LLM returned ${llmResponse.assignments.length} assignments`
    );

    // Step 4: Resolve themes — create new ones, find existing ones
    // Build a lookup map of existing themes by lowercase name for fast matching
    const themeByLowerName = new Map<string, Theme>();
    for (const theme of existingThemes) {
      themeByLowerName.set(theme.name.toLowerCase(), theme);
    }

    // Step 4a: Embedding-based prevention pre-pass (PRD-026 P1.R2 / P1.R5).
    // Collect every proposed name that survives the case-insensitive fast
    // path (P1.R6) — covers both LLM-marked-new and LLM-hallucinated-existing
    // cases. Batch-embed them in one call, resolve each against existing-theme
    // embeddings via cosine similarity. The main loop consults the resulting
    // decision map; no per-iteration embedding work.
    const unresolved = collectUnresolvedThemes(llmResponse, themeByLowerName);
    const prevention: PreventionResult = await runThemePrevention({
      proposed: unresolved,
      existing: existingThemes,
      sessionId,
    });

    let newThemesCreated = 0;
    let existingThemesUsed = 0;
    const signalThemeInserts: SignalThemeInsert[] = [];

    for (const assignment of llmResponse.assignments) {
      const { signalIndex, themes } = assignment;

      // Guard: signal index must be within bounds
      if (signalIndex < 0 || signalIndex >= embeddingIds.length) {
        console.warn(
          `[theme-service] skipping out-of-bounds signalIndex: ${signalIndex}`
        );
        continue;
      }

      const embeddingId = embeddingIds[signalIndex];

      for (const themeAssignment of themes) {
        const { themeName, isNew, confidence, description } = themeAssignment;
        const lowerName = themeName.toLowerCase();

        // Informational warning when the LLM lies about an existing theme.
        // Resolution flow below treats it identically to an isNew=true case.
        if (!isNew && !themeByLowerName.has(lowerName)) {
          console.warn(
            `[theme-service] LLM marked "${themeName}" as existing, but workspace has no such theme — resolving via prevention guard`
          );
        }

        const resolvedThemeId = await resolveThemeForAssignment({
          themeName,
          description: description ?? null,
          lowerName,
          teamId,
          userId,
          themeRepo,
          themeByLowerName,
          prevention,
        });

        if (resolvedThemeId.kind === "reused") existingThemesUsed++;
        else newThemesCreated++;

        signalThemeInserts.push({
          embedding_id: embeddingId,
          theme_id: resolvedThemeId.themeId,
          assigned_by: "ai",
          confidence,
        });
      }
    }

    // Step 5: Bulk insert signal-theme assignments
    if (signalThemeInserts.length > 0) {
      await signalThemeRepo.bulkCreate(signalThemeInserts);
    }

    const result: ThemeAssignmentResult = {
      totalSignals: chunks.length,
      totalAssignments: signalThemeInserts.length,
      newThemesCreated,
      existingThemesUsed,
    };

    console.log(
      `[theme-service] assignSessionThemes — success for session: ${sessionId}`,
      `| signals: ${result.totalSignals}`,
      `| assignments: ${result.totalAssignments}`,
      `| new themes: ${result.newThemesCreated}`,
      `| existing themes: ${result.existingThemesUsed}`
    );

    return result;
  } catch (err) {
    console.error(
      `[theme-service] assignSessionThemes — failed for session: ${sessionId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walks the LLM response and collects every theme proposal whose name does
 * NOT already exist in the workspace — i.e., themes the prevention guard
 * needs to resolve. Captures both:
 *   - isNew=true proposals (the LLM-explicit "new" case)
 *   - isNew=false proposals where the LLM hallucinated an existing theme
 *     (we treat the unknown name the same way: semantic check, then create
 *     if no match crosses the threshold)
 *
 * Deduplicates by lowercased name so a single embedding + similarity check
 * covers every occurrence in this batch (P1.R5).
 */
function collectUnresolvedThemes(
  llmResponse: ThemeAssignmentResponse,
  themeByLowerName: Map<string, Theme>
): ProposedNewTheme[] {
  const dedup = new Map<string, ProposedNewTheme>();

  for (const assignment of llmResponse.assignments) {
    for (const t of assignment.themes) {
      const lowerName = t.themeName.toLowerCase();
      if (themeByLowerName.has(lowerName)) continue; // P1.R6 fast path
      if (dedup.has(lowerName)) continue;
      dedup.set(lowerName, {
        name: t.themeName,
        // The LLM only emits a description on isNew=true. For hallucinated-
        // existing proposals it's null, which buildThemeEmbeddingText handles.
        description: t.description ?? null,
      });
    }
  }

  return [...dedup.values()];
}

interface ResolveOutcome {
  themeId: string;
  kind: "reused" | "created";
}

/**
 * Resolves a single LLM theme proposal to a theme id, in one of three ways:
 *   - cache hit (P1.R6) → reuse
 *   - prevention says reuse → collapse onto matched theme + update cache
 *   - prevention says new (or — defensively — no decision) → create with the
 *     precomputed embedding the guard produced
 *
 * Centralising the branching here keeps the assignment loop linear.
 */
async function resolveThemeForAssignment(options: {
  themeName: string;
  description: string | null;
  lowerName: string;
  teamId: string | null;
  userId: string;
  themeRepo: ThemeRepository;
  themeByLowerName: Map<string, Theme>;
  prevention: PreventionResult;
}): Promise<ResolveOutcome> {
  const {
    themeName,
    description,
    lowerName,
    teamId,
    userId,
    themeRepo,
    themeByLowerName,
    prevention,
  } = options;

  const cached = themeByLowerName.get(lowerName);
  if (cached) {
    return { themeId: cached.id, kind: "reused" };
  }

  const decision = prevention.decisions.get(lowerName);

  if (decision?.kind === "reuse") {
    const matched = themeByLowerName.get(decision.matchedName.toLowerCase());
    if (matched) themeByLowerName.set(lowerName, matched);
    return { themeId: decision.themeId, kind: "reused" };
  }

  if (!decision || decision.kind !== "new") {
    // Shouldn't happen — collectUnresolvedThemes feeds every cache-missed name
    // into the guard. If it does, log loudly. We can't proceed without an
    // embedding (DB constraint), so re-throw upward to the outer catch.
    throw new Error(
      `[theme-service] missing prevention decision for "${themeName}" — pre-pass coverage gap`
    );
  }

  return await createNewTheme({
    themeName,
    description,
    lowerName,
    teamId,
    userId,
    themeRepo,
    themeByLowerName,
    embedding: decision.embedding,
  });
}

/**
 * Inserts a fresh theme row carrying the embedding produced by the prevention
 * guard. On a unique-constraint violation (concurrent insert from a parallel
 * extraction), falls back to findByName so the caller still gets a valid id.
 */
async function createNewTheme(options: {
  themeName: string;
  description: string | null;
  lowerName: string;
  teamId: string | null;
  userId: string;
  themeRepo: ThemeRepository;
  themeByLowerName: Map<string, Theme>;
  embedding: number[];
}): Promise<ResolveOutcome> {
  const {
    themeName,
    description,
    lowerName,
    teamId,
    userId,
    themeRepo,
    themeByLowerName,
    embedding,
  } = options;

  const insertData: ThemeInsert = {
    name: themeName,
    description,
    team_id: teamId,
    initiated_by: userId,
    origin: "ai",
    embedding,
  };

  try {
    const created = await themeRepo.create(insertData);
    themeByLowerName.set(lowerName, created);
    console.log(
      `[theme-service] created new theme: "${created.name}" (${created.id})`
    );
    return { themeId: created.id, kind: "created" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("unique") ||
      message.includes("duplicate") ||
      message.includes("23505")
    ) {
      console.warn(
        `[theme-service] unique constraint hit for theme "${themeName}", resolving existing`
      );
      const existing = await themeRepo.findByName(themeName, teamId, userId);
      if (existing) {
        themeByLowerName.set(lowerName, existing);
        return { themeId: existing.id, kind: "reused" };
      }
    }
    throw err;
  }
}
