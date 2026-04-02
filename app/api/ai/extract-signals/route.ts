import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  extractSignals,
  AIServiceError,
  AIEmptyResponseError,
  AIRequestError,
  AIConfigError,
  AIQuotaError,
} from "@/lib/services/ai-service";

const extractSignalsSchema = z.object({
  rawNotes: z
    .string()
    .min(1, "Notes are required")
    .max(50000, "Notes must be 50,000 characters or fewer"),
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

  // Call the AI service
  try {
    const structuredNotes = await extractSignals(parsed.data.rawNotes);

    console.log(
      "[api/ai/extract-signals] POST — extraction complete,",
      structuredNotes.length,
      "chars"
    );
    return NextResponse.json({ structuredNotes });
  } catch (err) {
    // Map error types to HTTP status codes
    if (err instanceof AIConfigError) {
      console.error("[api/ai/extract-signals] config error:", err.message);
      return NextResponse.json(
        {
          message:
            "AI service is not configured correctly. Please contact support.",
        },
        { status: 500 }
      );
    }

    if (err instanceof AIQuotaError) {
      console.error("[api/ai/extract-signals] quota error:", err.message);
      return NextResponse.json(
        {
          message:
            "We've hit our AI usage limit — looks like a lot of people are finding this useful! Please try again later or reach out so we can get things running again.",
        },
        { status: 402 }
      );
    }

    if (err instanceof AIRequestError) {
      console.error("[api/ai/extract-signals] request error:", err.message);
      return NextResponse.json(
        {
          message:
            "Could not process these notes. Please try shortening them or removing special characters.",
        },
        { status: 400 }
      );
    }

    if (err instanceof AIEmptyResponseError) {
      console.error("[api/ai/extract-signals] empty response:", err.message);
      return NextResponse.json(
        {
          message:
            "AI could not extract signals from these notes. Please ensure the notes contain session content and try again.",
        },
        { status: 422 }
      );
    }

    if (err instanceof AIServiceError) {
      console.error("[api/ai/extract-signals] service error:", err.message);
      return NextResponse.json(
        {
          message:
            "Signal extraction is temporarily unavailable. Please try again in a few moments.",
        },
        { status: 503 }
      );
    }

    // Unexpected error
    console.error(
      "[api/ai/extract-signals] unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "An unexpected error occurred during signal extraction." },
      { status: 500 }
    );
  }
}
