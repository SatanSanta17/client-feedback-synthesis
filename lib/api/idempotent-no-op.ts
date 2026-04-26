import { NextResponse } from "next/server";

/**
 * Canonical 409 Conflict response for "no-op: state already matches".
 * Used when a PATCH/PUT request asks to set a field to its current value
 * (e.g., changing a member's role to the role they already have).
 */
export function idempotentNoOp(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 409 });
}
