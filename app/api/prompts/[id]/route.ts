import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import {
  getPromptVersionById,
  getPromptHistory,
} from "@/lib/services/prompt-service";
import { createPromptRepository } from "@/lib/repositories/supabase/supabase-prompt-repository";

const idSchema = z.string().uuid("Invalid prompt version ID");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  console.log("[api/prompts/[id]] GET — id:", id);

  // Validate UUID format
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    console.warn("[api/prompts/[id]] GET — invalid UUID:", id);
    return NextResponse.json(
      { message: "Invalid prompt version ID" },
      { status: 400 }
    );
  }

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/prompts/[id]] GET — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const teamId = await getActiveTeamId();
  const promptRepo = createPromptRepository(supabase, teamId);

  try {
    const version = await getPromptVersionById(promptRepo, id);

    if (!version) {
      console.warn("[api/prompts/[id]] GET — not found:", id);
      return NextResponse.json(
        { message: "Prompt version not found" },
        { status: 404 }
      );
    }

    // Compute version number: position in history sorted ascending by created_at
    const history = await getPromptHistory(promptRepo, version.prompt_key);
    const sorted = [...history].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const versionNumber = sorted.findIndex((v) => v.id === version.id) + 1;

    console.log(
      `[api/prompts/[id]] GET — found version ${version.id}, number ${versionNumber}`
    );

    return NextResponse.json({ version, versionNumber });
  } catch (err) {
    console.error(
      "[api/prompts/[id]] GET — error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch prompt version" },
      { status: 500 }
    );
  }
}
