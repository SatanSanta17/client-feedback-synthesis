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

        if (isNew) {
          // Attempt to create the new theme
          resolvedThemeId = await resolveNewTheme({
            themeName,
            description: description ?? null,
            teamId,
            userId,
            themeRepo,
            themeByLowerName,
          });

          // Check if we actually created it or fell back to existing
          if (themeByLowerName.has(themeName.toLowerCase())) {
            // Was already there (concurrent creation or LLM incorrectly marked as new)
            existingThemesUsed++;
          } else {
            newThemesCreated++;
          }
        } else {
          // Find existing theme by name
          const existing = themeByLowerName.get(themeName.toLowerCase());
          if (existing) {
            resolvedThemeId = existing.id;
            existingThemesUsed++;
          } else {
            // LLM referenced an existing theme that doesn't exist — try creating it
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
}): Promise<string> {
  const { themeName, description, teamId, userId, themeRepo, themeByLowerName } = options;

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
    // PRD-026 Increment 1.2 stub. Increment 1.3 will replace this with the
    // embedding produced by the prevention guard pre-pass.
    embedding: null,
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
