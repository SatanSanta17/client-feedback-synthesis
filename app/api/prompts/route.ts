import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import {
  getPromptHistory,
  savePromptVersion,
} from "@/lib/services/prompt-service";
import { createPromptRepository } from "@/lib/repositories/supabase/supabase-prompt-repository";
import { getTeamMember } from "@/lib/services/team-service";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import { SIGNAL_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts/signal-extraction";
import { MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT, MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT } from "@/lib/prompts/master-signal-synthesis";

const PROMPT_KEYS = [
  "signal_extraction",
  "master_signal_cold_start",
  "master_signal_incremental",
] as const;

/** Hardcoded default prompts — used as fallback when no DB version exists. */
const DEFAULT_PROMPTS: Record<string, string> = {
  signal_extraction: SIGNAL_EXTRACTION_SYSTEM_PROMPT,
  master_signal_cold_start: MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  master_signal_incremental: MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
};

const promptQuerySchema = z.object({
  key: z.enum(PROMPT_KEYS, {
    message: `Invalid or missing 'key' parameter. Must be one of: ${PROMPT_KEYS.join(", ")}`,
  }),
});

// ---------------------------------------------------------------------------
// GET /api/prompts?key=<prompt_key>
// Returns the version history for a given prompt key.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  console.log("[api/prompts] GET — fetching prompt history");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/prompts] GET — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  // Validate query param
  const parsed = promptQuerySchema.safeParse({
    key: request.nextUrl.searchParams.get("key"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    console.warn("[api/prompts] GET — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  const promptKey = parsed.data.key;
  const teamId = await getActiveTeamId();
  const promptRepo = createPromptRepository(supabase, teamId);

  try {
    const history = await getPromptHistory(promptRepo, promptKey);
    const active = history.find((v) => v.is_active) ?? null;

    // If no saved version exists, return the hardcoded default as a synthetic
    // active entry so the client always has something to display.
    const fallbackActive = active ?? (DEFAULT_PROMPTS[promptKey]
      ? { id: null, content: DEFAULT_PROMPTS[promptKey], is_active: true, is_default: true }
      : null);

    console.log(
      `[api/prompts] GET — returning ${history.length} versions for ${promptKey}${!active && fallbackActive ? " (using hardcoded default)" : ""}`
    );

    return NextResponse.json({ active: fallbackActive, history });
  } catch (err) {
    console.error(
      "[api/prompts] GET — unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch prompt history" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/prompts
// Saves a new prompt version and makes it active.
// ---------------------------------------------------------------------------

const savePromptSchema = z.object({
  promptKey: z.enum(PROMPT_KEYS),
  content: z
    .string()
    .min(1, "Prompt content is required")
    .max(50000, "Prompt content must be 50,000 characters or fewer"),
});

export async function POST(request: NextRequest) {
  console.log("[api/prompts] POST — saving new prompt version");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/prompts] POST — unauthenticated request");
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 }
    );
  }

  const teamId = await getActiveTeamId();
  if (teamId) {
    const serviceClient = createServiceRoleClient();
    const teamRepo = createTeamRepository(supabase, serviceClient);
    const member = await getTeamMember(teamRepo, teamId, user.id);
    if (member?.role !== "admin") {
      console.warn("[api/prompts] POST — non-admin in team context");
      return NextResponse.json(
        { message: "Only team admins can edit prompts" },
        { status: 403 }
      );
    }
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = savePromptSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/prompts] POST — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  const promptRepo = createPromptRepository(supabase, teamId);

  try {
    const version = await savePromptVersion(promptRepo, {
      promptKey: parsed.data.promptKey,
      content: parsed.data.content,
      authorId: user.id,
      authorEmail: user.email ?? "unknown",
    });

    console.log(
      `[api/prompts] POST — saved version ${version.id} for ${parsed.data.promptKey}`
    );

    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    console.error(
      "[api/prompts] POST — unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to save prompt version" },
      { status: 500 }
    );
  }
}
