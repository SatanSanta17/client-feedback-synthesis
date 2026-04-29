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
 * 1. Fetches active themes for the workspace.
 * 2. Builds the theme assignment prompt with signal texts + existing theme names.
 * 3. Calls the LLM (one call) to assign each signal to existing or new themes.
 * 4. Creates any new themes in the DB (with unique constraint safety).
 * 5. Inserts signal_themes rows linking embeddings to themes.
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
    // Collect every "new" proposal that survives the case-insensitive fast
    // path (P1.R6), batch-embed them in one call, and resolve each against
    // existing-theme embeddings via cosine similarity. The main loop below
    // consults the resulting decision map; no per-iteration embedding work.
    const proposedNew = collectProposedNewThemes(llmResponse, themeByLowerName);
    const prevention: PreventionResult = await runThemePrevention({
      proposed: proposedNew,
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
        let resolvedThemeId: string;

        const lowerName = themeName.toLowerCase();

        if (isNew) {
          // P1.R6 — exact-name fast path: LLM marked new but the name already
          // exists in the workspace. Reuse without embedding work.
          const cached = themeByLowerName.get(lowerName);
          if (cached) {
            resolvedThemeId = cached.id;
            existingThemesUsed++;
          } else {
            const decision = prevention.decisions.get(lowerName);

            if (decision?.kind === "reuse") {
              // P1.R2 — semantic match wins; collapse onto the existing theme.
              resolvedThemeId = decision.themeId;
              existingThemesUsed++;
              // Keep cache consistent so a second occurrence of the same
              // proposed name in this batch short-circuits at the fast path.
              const matched = themeByLowerName.get(decision.matchedName.toLowerCase());
              if (matched) themeByLowerName.set(lowerName, matched);
            } else {
              // decision.kind === "new", or no decision (rare — proposed name
              // collided in cache between collection and resolution). Persist
              // a fresh row, carrying the embedding precomputed by the guard.
              const embedding =
                decision?.kind === "new" ? decision.embedding : null;
              resolvedThemeId = await resolveNewTheme({
                themeName,
                description: description ?? null,
                teamId,
                userId,
                themeRepo,
                themeByLowerName,
                embedding,
              });
              newThemesCreated++;
            }
          }
        } else {
          // Find existing theme by name
          const existing = themeByLowerName.get(lowerName);
          if (existing) {
            resolvedThemeId = existing.id;
            existingThemesUsed++;
          } else {
            // LLM referenced an existing theme that doesn't exist — try creating it.
            console.warn(
              `[theme-service] LLM referenced non-existent theme "${themeName}" as existing, creating it`
            );
            resolvedThemeId = await resolveNewTheme({
              themeName,
              description: description ?? null,
              teamId,
              userId,
              themeRepo,
              themeByLowerName,
              embedding: null,
            });
            newThemesCreated++;
          }
        }

        signalThemeInserts.push({
          embedding_id: embeddingId,
          theme_id: resolvedThemeId,
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
 * Walks the LLM response and collects every "new" proposal that survives
 * the case-insensitive fast path — i.e., names that don't already exist in
 * the workspace. Deduplicates by lowercased name so a single embedding +
 * similarity check covers every occurrence in this batch (P1.R5).
 */
function collectProposedNewThemes(
  llmResponse: ThemeAssignmentResponse,
  themeByLowerName: Map<string, Theme>
): ProposedNewTheme[] {
  const dedup = new Map<string, ProposedNewTheme>();

  for (const assignment of llmResponse.assignments) {
    for (const t of assignment.themes) {
      if (!t.isNew) continue;
      const lowerName = t.themeName.toLowerCase();
      if (themeByLowerName.has(lowerName)) continue; // P1.R6 fast path
      if (dedup.has(lowerName)) continue;
      dedup.set(lowerName, {
        name: t.themeName,
        description: t.description ?? null,
      });
    }
  }

  return [...dedup.values()];
}

/**
 * Attempts to create a new theme. If a unique constraint violation occurs
 * (concurrent creation), falls back to findByName() to resolve the existing
 * theme. Updates the themeByLowerName cache in both cases.
 */
async function resolveNewTheme(options: {
  themeName: string;
  description: string | null;
  teamId: string | null;
  userId: string;
  themeRepo: ThemeRepository;
  themeByLowerName: Map<string, Theme>;
  /**
   * Precomputed embedding from the prevention guard. Pass `null` only for
   * the rare paths that bypass the guard (e.g., LLM proposed an
   * "existing" theme that doesn't actually exist) — those rows will be
   * caught by the next backfill pass if any.
   */
  embedding: number[] | null;
}): Promise<string> {
  const { themeName, description, teamId, userId, themeRepo, themeByLowerName, embedding } = options;

  const lowerName = themeName.toLowerCase();

  // Check cache first — might have been created by a prior iteration in this batch
  const cached = themeByLowerName.get(lowerName);
  if (cached) {
    return cached.id;
  }

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
    // Cache the new theme for subsequent iterations
    themeByLowerName.set(lowerName, created);
    console.log(
      `[theme-service] created new theme: "${created.name}" (${created.id})`
    );
    return created.id;
  } catch (err) {
    // Unique constraint violation — theme was created concurrently
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unique") || message.includes("duplicate") || message.includes("23505")) {
      console.warn(
        `[theme-service] unique constraint hit for theme "${themeName}", resolving existing`
      );
      const existing = await themeRepo.findByName(themeName, teamId, userId);
      if (existing) {
        themeByLowerName.set(lowerName, existing);
        return existing.id;
      }
    }
    // If we can't resolve, re-throw — the outer try/catch in assignSessionThemes handles it
    throw err;
  }
}
