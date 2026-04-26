import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createPromptRepository } from "@/lib/repositories/supabase/supabase-prompt-repository";
import { getPromptHistory } from "@/lib/services/prompt-service";
import type { PromptKey } from "@/lib/repositories/prompt-repository";

export async function GET() {
  console.log("[api/sessions/prompt-versions] GET — fetching distinct prompt versions");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/sessions/prompt-versions] GET — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const promptRepo = createPromptRepository(supabase, teamId);

  try {
    const distinctIds = await sessionRepo.getDistinctPromptVersionIds();

    // Separate null from non-null IDs
    const hasNull = distinctIds.includes(null);
    const nonNullIds = distinctIds.filter((id): id is string => id !== null);

    // For each non-null ID, compute the version number using prompt history
    // Group by prompt_key to avoid redundant history fetches
    const versions: { id: string; versionNumber: number }[] = [];

    if (nonNullIds.length > 0) {
      // Fetch all prompt version rows to get their prompt_key + created_at
      const versionRows = await Promise.all(
        nonNullIds.map((id) => promptRepo.findById(id))
      );

      // Group by prompt_key for efficient history lookup
      const byKey = new Map<string, string[]>();
      const rowById = new Map<string, NonNullable<typeof versionRows[number]>>();

      for (let i = 0; i < nonNullIds.length; i++) {
        const row = versionRows[i];
        if (!row) continue;
        rowById.set(nonNullIds[i], row);
        const ids = byKey.get(row.prompt_key) ?? [];
        ids.push(nonNullIds[i]);
        byKey.set(row.prompt_key, ids);
      }

      // Fetch history per prompt_key and compute version numbers
      for (const [promptKey, ids] of byKey) {
        const history = await getPromptHistory(promptRepo, promptKey as PromptKey);
        const sorted = [...history].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        for (const id of ids) {
          const idx = sorted.findIndex((v) => v.id === id);
          versions.push({ id, versionNumber: idx + 1 });
        }
      }

      // Sort by version number descending (newest first)
      versions.sort((a, b) => b.versionNumber - a.versionNumber);
    }

    console.log(
      `[api/sessions/prompt-versions] GET — ${versions.length} versions, hasNull: ${hasNull}`
    );

    return NextResponse.json({ versions, hasNull });
  } catch (err) {
    console.error(
      "[api/sessions/prompt-versions] GET — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch prompt versions" },
      { status: 500 }
    );
  }
}
