import { NextResponse } from "next/server";
import {
  AIConfigError,
  AIQuotaError,
  AIRequestError,
  AIEmptyResponseError,
  AIServiceError,
} from "@/lib/services/ai-service";

interface AIErrorMessages {
  request?: string;
  empty?: string;
  unexpected?: string;
}

const DEFAULT_MESSAGES: Required<AIErrorMessages> = {
  request:
    "Could not process the request. Please try shortening the input or removing special characters.",
  empty:
    "AI could not produce a result from the provided input. Please ensure the content is sufficient and try again.",
  unexpected: "An unexpected error occurred.",
};

export function mapAIErrorToResponse(
  err: unknown,
  routeLabel: string,
  messages?: AIErrorMessages
): NextResponse {
  const msgs = { ...DEFAULT_MESSAGES, ...messages };

  if (err instanceof AIConfigError) {
    console.error(`[${routeLabel}] config error:`, err.message);
    return NextResponse.json(
      {
        message:
          "AI service is not configured correctly. Please contact support.",
      },
      { status: 500 }
    );
  }

  if (err instanceof AIQuotaError) {
    console.error(`[${routeLabel}] quota error:`, err.message);
    return NextResponse.json(
      {
        message:
          "We've hit our AI usage limit — looks like a lot of people are finding this useful! Please try again later or reach out so we can get things running again.",
      },
      { status: 402 }
    );
  }

  if (err instanceof AIRequestError) {
    console.error(`[${routeLabel}] request error:`, err.message);
    return NextResponse.json({ message: msgs.request }, { status: 400 });
  }

  if (err instanceof AIEmptyResponseError) {
    console.error(`[${routeLabel}] empty response:`, err.message);
    return NextResponse.json({ message: msgs.empty }, { status: 422 });
  }

  if (err instanceof AIServiceError) {
    console.error(`[${routeLabel}] service error:`, err.message);
    return NextResponse.json(
      {
        message: `${routeLabel.split("/").pop()?.replace(/-/g, " ")} is temporarily unavailable. Please try again in a few moments.`,
      },
      { status: 503 }
    );
  }

  // Unexpected error
  console.error(
    `[${routeLabel}] unexpected error:`,
    err instanceof Error ? err.message : err
  );
  return NextResponse.json({ message: msgs.unexpected }, { status: 500 });
}
