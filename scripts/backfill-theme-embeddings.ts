/**
 * One-shot backfill: populate `themes.embedding` for every row where the column
 * is NULL. Runs once during PRD-026 Part 1 rollout, between migrations 001
 * (adds nullable column) and 002 (tightens to NOT NULL). Idempotent — only
 * touches rows that still have NULL embeddings, so re-running after a partial
 * failure resumes cleanly.
 *
 * Usage:
 *   npm run backfill:theme-embeddings
 *
 * Required env (loaded from .env via dotenv):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS
 *   - OPENAI_API_KEY (for the openai embedding provider)
 */

// IMPORTANT: dotenv must load before any module that reads process.env at
// import time (e.g., the embedding service resolves provider config eagerly).
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

import { createThemeRepository } from "@/lib/repositories/supabase/supabase-theme-repository";
import { embedTexts } from "@/lib/services/embedding-service";
import { buildThemeEmbeddingText } from "@/lib/services/theme-prevention";

const LOG = "[backfill-theme-embeddings]";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${LOG} missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // teamId is irrelevant for listMissingEmbeddings/updateEmbedding (the script
  // is workspace-agnostic) — pass null to satisfy the factory signature.
  const themeRepo = createThemeRepository(serviceClient, null);

  const missing = await themeRepo.listMissingEmbeddings();
  console.log(`${LOG} ${missing.length} themes missing embeddings`);

  if (missing.length === 0) {
    console.log(`${LOG} nothing to do — exiting`);
    return;
  }

  // Compose embedding texts in the same shape the prevention guard will use.
  const texts = missing.map((theme) =>
    buildThemeEmbeddingText(theme.name, theme.description)
  );

  console.log(`${LOG} embedding ${texts.length} theme texts`);
  const vectors = await embedTexts(texts);

  if (vectors.length !== missing.length) {
    throw new Error(
      `${LOG} vector count mismatch: ${vectors.length} vectors for ${missing.length} themes`
    );
  }

  let written = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const theme = missing[i];
    const vector = vectors[i];

    try {
      await themeRepo.updateEmbedding(theme.id, vector);
      written++;
      if (written % 10 === 0 || written === missing.length) {
        console.log(`${LOG} processed ${written}/${missing.length}`);
      }
    } catch (err) {
      failed++;
      console.error(
        `${LOG} failed to write embedding for theme ${theme.id} ("${theme.name}"):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `${LOG} done — written: ${written}, failed: ${failed}, total: ${missing.length}, elapsedMs: ${elapsedMs}`
  );

  if (failed > 0) {
    console.error(`${LOG} ${failed} themes still have NULL embeddings — re-run the script after investigating`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err instanceof Error ? err.stack : err);
  process.exit(1);
});
