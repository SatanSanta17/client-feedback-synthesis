import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { MAX_COMBINED_CHARS } from "@/lib/constants";
import { requireAuth, requireSessionAccess } from "@/lib/api/route-auth";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";
import { createMasterSignalRepository } from "@/lib/repositories/supabase/supabase-master-signal-repository";
import {
  updateSession,
  deleteSession,
  SessionNotFoundError,
  ClientDuplicateError,
} from "@/lib/services/session-service";
import { runSessionPostResponseChain } from "@/lib/services/session-orchestrator";
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";

// 60s headroom (Vercel Hobby ceiling) for the post-response embedding+theme+insights
// chain run via `after()`. Must be a literal — Next.js segment configs aren't statically
// resolvable across module boundaries.
export const maxDuration = 60;

// --- PUT /api/sessions/[id] ---

const updateSessionSchema = z
  .object({
    clientId: z.string().uuid().nullable(),
    clientName: z.string().max(255).default(""),
    sessionDate: z.string().min(1, "Session date is required"),
    rawNotes: z
      .string()
      .max(MAX_COMBINED_CHARS, `Notes must be ${MAX_COMBINED_CHARS.toLocaleString()} characters or fewer`),
    structuredNotes: z
      .string()
      .max(100000, "Structured notes must be 100,000 characters or fewer")
      .nullable()
      .optional(),
    structuredJson: z.record(z.string(), z.unknown()).nullable().optional(),
    hasAttachments: z.boolean().optional().default(false),
    promptVersionId: z.string().uuid().nullable().optional(),
    isExtraction: z.boolean().optional().default(false),
    inputChanged: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      if (data.clientId === null) {
        return data.clientName.trim().length > 0;
      }
      return true;
    },
    {
      message: "Client name is required when creating a new client",
      path: ["clientName"],
    }
  )
  .refine(
    (data) => data.rawNotes.trim().length > 0 || data.hasAttachments,
    {
      message: "Notes or at least one attachment is required",
      path: ["rawNotes"],
    }
  );

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  console.log("[api/sessions/[id]] PUT — id:", id);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(id, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { user, supabase, serviceClient, teamId, sessionRepo } = ctx;

  const clientRepo = createClientRepository(supabase, teamId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = updateSessionSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/sessions/[id]] PUT — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const session = await updateSession(sessionRepo, clientRepo, id, {
      clientId: parsed.data.clientId,
      clientName: parsed.data.clientName,
      sessionDate: parsed.data.sessionDate,
      rawNotes: parsed.data.rawNotes,
      structuredNotes: parsed.data.structuredNotes,
      structuredJson: parsed.data.structuredJson,
      promptVersionId: parsed.data.promptVersionId,
      isExtraction: parsed.data.isExtraction,
      inputChanged: parsed.data.inputChanged,
    }, user.id, teamId);

    console.log("[api/sessions/[id]] PUT — updated:", session.id);

    // Post-response chain: re-embed → theme assignment → insights refresh.
    // `after()` keeps the function instance alive past the response so the
    // chain isn't frozen mid-flight on Vercel's serverless runtime (gap E2).
    // Always re-embed on PUT — isReExtraction deletes old embeddings first,
    // and the cascade on signal_themes.embedding_id cleans up old assignments.
    // structuredJson is only meaningful for the chain when this PUT is itself
    // an AI extraction; manual edits leave the chain to fall back to rawNotes.
    const chainStructuredJson = parsed.data.isExtraction
      ? ((parsed.data.structuredJson as ExtractedSignals | null) ?? null)
      : null;

    after(
      runSessionPostResponseChain({
        sessionId: id,
        userId: user.id,
        teamId,
        clientName: parsed.data.clientName,
        sessionDate: parsed.data.sessionDate,
        rawNotes: parsed.data.rawNotes,
        structuredJson: chainStructuredJson,
        serviceClient,
        isReExtraction: true,
        logPrefix: "[PUT /api/sessions/[id]]",
      })
    );

    return NextResponse.json({ session });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ message: err.message }, { status: 404 });
    }
    if (err instanceof ClientDuplicateError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }

    console.error(
      "[api/sessions/[id]] PUT error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to update session" },
      { status: 500 }
    );
  }
}

// --- DELETE /api/sessions/[id] ---

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  console.log("[api/sessions/[id]] DELETE — id:", id);

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const ctx = await requireSessionAccess(id, auth.user);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, serviceClient, teamId, sessionRepo } = ctx;

  const masterSignalRepo = createMasterSignalRepository(supabase, serviceClient, teamId);

  try {
    await deleteSession(sessionRepo, masterSignalRepo, id);

    console.log("[api/sessions/[id]] DELETE — deleted:", id);
    return NextResponse.json({ message: "Session deleted" });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ message: err.message }, { status: 404 });
    }

    console.error(
      "[api/sessions/[id]] DELETE error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to delete session" },
      { status: 500 }
    );
  }
}
