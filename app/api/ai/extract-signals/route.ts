import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getActiveTeamId } from "@/lib/supabase/server";
import { MAX_COMBINED_CHARS } from "@/lib/constants";
import { extractSignals } from "@/lib/services/ai-service";
import { mapAIErrorToResponse } from "@/lib/utils/map-ai-error";
import { createPromptRepository } from "@/lib/repositories/supabase/supabase-prompt-repository";

const extractSignalsSchema = z.object({
  rawNotes: z
    .string()
    .min(1, "Notes are required")
    .max(
      MAX_COMBINED_CHARS,
      `Input must be ${MAX_COMBINED_CHARS.toLocaleString()} characters or fewer`
    ),
});

export async function POST(request: NextRequest) {
  console.log("[api/ai/extract-signals] POST — extracting signals");

  // Auth check — verify the user has an active session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[api/ai/extract-signals] POST — unauthenticated request");
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

  const parsed = extractSignalsSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/ai/extract-signals] POST — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  console.log(
    "[api/ai/extract-signals] POST — input length:",
    parsed.data.rawNotes.length,
    "chars"
  );

  // Call the AI service
  const teamId = await getActiveTeamId();
  const promptRepo = createPromptRepository(supabase, teamId);

  try {
    const result = await extractSignals(promptRepo, parsed.data.rawNotes);

    console.log(
      "[api/ai/extract-signals] POST — extraction complete,",
      result.structuredNotes.length,
      "chars, promptVersionId:",
      result.promptVersionId
    );
    return NextResponse.json({
      structuredNotes: result.structuredNotes,
      structuredJson: result.structuredJson,
      promptVersionId: result.promptVersionId,
    });
  } catch (err) {
    return mapAIErrorToResponse(err, "api/ai/extract-signals", {
      request:
        "Could not process these notes. Please try shortening them or removing special characters.",
      empty:
        "AI could not extract signals from these notes. Please ensure the notes contain session content and try again.",
      unexpected:
        "An unexpected error occurred during signal extraction.",
    });
  }
}
