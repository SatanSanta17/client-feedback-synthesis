import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getPromptHistory,
  savePromptVersion,
  type PromptKey,
} from "@/lib/services/prompt-service";

const VALID_PROMPT_KEYS: PromptKey[] = [
  "signal_extraction",
  "master_signal_cold_start",
  "master_signal_incremental",
];

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
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key || !VALID_PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json(
      {
        message: `Invalid or missing 'key' parameter. Must be one of: ${VALID_PROMPT_KEYS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const promptKey = key as PromptKey;

  try {
    const history = await getPromptHistory(promptKey);
    const active = history.find((v) => v.is_active) ?? null;

    console.log(
      `[api/prompts] GET — returning ${history.length} versions for ${promptKey}`
    );

    return NextResponse.json({ active, history });
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
  promptKey: z.enum([
    "signal_extraction",
    "master_signal_cold_start",
    "master_signal_incremental",
  ]),
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

  try {
    const version = await savePromptVersion({
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
