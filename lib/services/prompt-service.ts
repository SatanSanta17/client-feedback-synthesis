import { createServiceRoleClient, createClient } from "@/lib/supabase/server";

// Valid prompt keys
export type PromptKey =
  | "signal_extraction"
  | "master_signal_cold_start"
  | "master_signal_incremental";

export interface PromptVersion {
  id: string;
  prompt_key: PromptKey;
  content: string;
  author_id: string | null;
  author_email: string;
  is_active: boolean;
  created_at: string;
}

/**
 * Fetches the currently active prompt for a given key.
 * Uses the service role client — called from AI service (server-side, no user context).
 * Returns null if no active prompt is found or on error.
 */
export async function getActivePrompt(
  promptKey: PromptKey
): Promise<string | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("prompt_versions")
    .select("content")
    .eq("prompt_key", promptKey)
    .eq("is_active", true)
    .single();

  if (error) {
    console.error(
      `[prompt-service] Failed to fetch active prompt for ${promptKey}:`,
      error.message
    );
    return null;
  }

  return data?.content ?? null;
}

/**
 * Fetches the version history for a given prompt key, newest first.
 * Uses the anon client (respects RLS — admin-only for non-active versions).
 */
export async function getPromptHistory(
  promptKey: PromptKey
): Promise<PromptVersion[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("prompt_key", promptKey)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      `[prompt-service] Failed to fetch prompt history for ${promptKey}:`,
      error.message
    );
    return [];
  }

  return data ?? [];
}

/**
 * Saves a new prompt version and makes it active.
 * Atomically deactivates the previous active version.
 * Uses the service role client for the deactivation (bypasses RLS).
 */
export async function savePromptVersion(input: {
  promptKey: PromptKey;
  content: string;
  authorId: string;
  authorEmail: string;
}): Promise<PromptVersion> {
  const { promptKey, content, authorId, authorEmail } = input;
  const supabase = createServiceRoleClient();

  // Step 1: Deactivate the current active version
  const { error: deactivateError } = await supabase
    .from("prompt_versions")
    .update({ is_active: false })
    .eq("prompt_key", promptKey)
    .eq("is_active", true);

  if (deactivateError) {
    console.error(
      `[prompt-service] Failed to deactivate current prompt for ${promptKey}:`,
      deactivateError.message
    );
    throw new Error(
      `Failed to deactivate current prompt: ${deactivateError.message}`
    );
  }

  // Step 2: Insert the new active version
  const { data, error: insertError } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_key: promptKey,
      content,
      author_id: authorId,
      author_email: authorEmail,
      is_active: true,
    })
    .select()
    .single();

  if (insertError) {
    console.error(
      `[prompt-service] Failed to insert new prompt version for ${promptKey}:`,
      insertError.message
    );
    throw new Error(
      `Failed to save prompt version: ${insertError.message}`
    );
  }

  console.log(
    `[prompt-service] Saved new active prompt for ${promptKey}: ${data.id}`
  );

  return data;
}
