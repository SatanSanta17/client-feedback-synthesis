import { NextResponse } from "next/server";

import type { SessionAccessResult } from "@/lib/services/session-service";

const STATUS_MAP: Record<
  Extract<SessionAccessResult, { allowed: false }>["reason"],
  { status: number; message: string }
> = {
  unauthenticated: { status: 401, message: "Authentication required" },
  "not-found": { status: 404, message: "Session not found" },
  forbidden: { status: 403, message: "You can only modify your own sessions" },
};

/**
 * Maps a session access denial reason to an HTTP error response.
 * Used by session-scoped API route handlers.
 */
export function mapAccessError(
  reason: Extract<SessionAccessResult, { allowed: false }>["reason"]
): NextResponse {
  const { status, message } = STATUS_MAP[reason];
  return NextResponse.json({ message }, { status });
}
