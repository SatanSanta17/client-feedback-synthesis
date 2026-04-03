import { createClient, getActiveTeamId } from "@/lib/supabase/server";

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
 * Scopes by active workspace: team prompts in team context,
 * personal prompts otherwise. Returns null if none found
 * (falls back to hardcoded default upstream).
 */
export async function getActivePrompt(
  promptKey: PromptKey
): Promise<string | null> {
  const teamId = await getActiveTeamId();
  const supabase = await createClient();

  let query = supabase
    .from("prompt_versions")
    .select("content")
    .eq("prompt_key", promptKey)
    .eq("is_active", true);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data, error } = await query.maybeSingle();

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
 * Scopes by active workspace.
 */
export async function getPromptHistory(
  promptKey: PromptKey
): Promise<PromptVersion[]> {
  const teamId = await getActiveTeamId();
  const supabase = await createClient();

  let query = supabase
    .from("prompt_versions")
    .select("*")
    .eq("prompt_key", promptKey)
    .order("created_at", { ascending: false });

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data, error } = await query;

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
 * Atomically deactivates the previous active version within the same scope
 * (personal or team). Includes team_id in the insert when in team context.
 */
export async function savePromptVersion(input: {
  promptKey: PromptKey;
  content: string;
  authorId: string;
  authorEmail: string;
}): Promise<PromptVersion> {
  const { promptKey, content, authorId, authorEmail } = input;
  const teamId = await getActiveTeamId();
  const supabase = await createClient();

  console.log(`[prompt-service] savePromptVersion — key: ${promptKey}, teamId: ${teamId}`);

  // Step 1: Deactivate the current active version (scoped to workspace)
  let deactivateQuery = supabase
    .from("prompt_versions")
    .update({ is_active: false })
    .eq("prompt_key", promptKey)
    .eq("is_active", true);

  if (teamId) {
    deactivateQuery = deactivateQuery.eq("team_id", teamId);
  } else {
    deactivateQuery = deactivateQuery.is("team_id", null);
  }

  const { error: deactivateError } = await deactivateQuery;

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
      team_id: teamId,
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
    `[prompt-service] Saved new active prompt for ${promptKey}: ${data.id}, teamId: ${teamId}`
  );

  return data;
}
