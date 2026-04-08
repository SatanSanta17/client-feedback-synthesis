import type { PromptRepository, PromptKey, PromptVersionRow } from "@/lib/repositories/prompt-repository";

// Re-export types for backward compatibility with existing consumers
export type { PromptKey };
export type PromptVersion = PromptVersionRow;

/**
 * Fetches the currently active prompt for a given key.
 * Returns null if none found (falls back to hardcoded default upstream).
 */
export async function getActivePrompt(
  repo: PromptRepository,
  promptKey: PromptKey
): Promise<string | null> {
  console.log(`[prompt-service] getActivePrompt — key: ${promptKey}`);

  const content = await repo.getActive(promptKey);

  console.log(
    `[prompt-service] getActivePrompt — ${content ? "found" : "not found"} for ${promptKey}`
  );
  return content;
}

/**
 * Fetches the full active prompt version row for a given key.
 * Returns null if none found (caller falls back to hardcoded default).
 */
export async function getActivePromptVersion(
  repo: PromptRepository,
  promptKey: PromptKey
): Promise<PromptVersionRow | null> {
  console.log(`[prompt-service] getActivePromptVersion — key: ${promptKey}`);

  const version = await repo.getActiveVersion(promptKey);

  console.log(
    `[prompt-service] getActivePromptVersion — ${version ? `found: ${version.id}` : "not found"} for ${promptKey}`
  );
  return version;
}

/**
 * Fetches the version history for a given prompt key, newest first.
 */
export async function getPromptHistory(
  repo: PromptRepository,
  promptKey: PromptKey
): Promise<PromptVersionRow[]> {
  console.log(`[prompt-service] getPromptHistory — key: ${promptKey}`);

  const history = await repo.getHistory(promptKey);

  console.log(
    `[prompt-service] getPromptHistory — returning ${history.length} versions for ${promptKey}`
  );
  return history;
}

/**
 * Fetches a single prompt version by ID.
 * Returns null if not found.
 */
export async function getPromptVersionById(
  repo: PromptRepository,
  id: string
): Promise<PromptVersionRow | null> {
  console.log(`[prompt-service] getPromptVersionById — id: ${id}`);

  const version = await repo.findById(id);

  console.log(
    `[prompt-service] getPromptVersionById — ${version ? "found" : "not found"} for ${id}`
  );
  return version;
}

/**
 * Saves a new prompt version and makes it active.
 * Atomically deactivates the previous active version within the same scope.
 */
export async function savePromptVersion(
  repo: PromptRepository,
  input: {
    promptKey: PromptKey;
    content: string;
    authorId: string;
    authorEmail: string;
  }
): Promise<PromptVersionRow> {
  const { promptKey, content, authorId, authorEmail } = input;

  console.log(`[prompt-service] savePromptVersion — key: ${promptKey}`);

  // Step 1: Deactivate the current active version
  await repo.deactivateCurrent(promptKey);

  // Step 2: Insert the new active version
  const version = await repo.create({
    promptKey,
    content,
    authorId,
    authorEmail,
  });

  console.log(`[prompt-service] savePromptVersion — saved: ${version.id}`);
  return version;
}
