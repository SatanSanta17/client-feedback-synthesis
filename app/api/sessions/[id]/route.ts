import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_COMBINED_CHARS } from "@/lib/constants";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/schemas/extraction-schema";
import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { mapAccessError } from "@/lib/utils/map-access-error";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import { createMasterSignalRepository } from "@/lib/repositories/supabase/supabase-master-signal-repository";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import { createThemeRepository } from "@/lib/repositories/supabase/supabase-theme-repository";
import { createSignalThemeRepository } from "@/lib/repositories/supabase/supabase-signal-theme-repository";
import { createInsightRepository } from "@/lib/repositories/supabase/supabase-insight-repository";
import { maybeRefreshDashboardInsights } from "@/lib/services/insight-service";
import {
  checkSessionAccess,
  updateSession,
  deleteSession,
  SessionNotFoundError,
  ClientDuplicateError,
} from "@/lib/services/session-service";
import { generateSessionEmbeddings } from "@/lib/services/embedding-orchestrator";
import { assignSessionThemes } from "@/lib/services/theme-service";
import {
  chunkStructuredSignals,
  chunkRawNotes,
} from "@/lib/services/chunking-service";
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";
import type { SessionMeta } from "@/lib/types/embedding-chunk";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return mapAccessError("unauthenticated");
  }

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const teamRepo = createTeamRepository(supabase, serviceClient);
  const clientRepo = createClientRepository(supabase, teamId);

  const access = await checkSessionAccess(sessionRepo, teamRepo, id, user.id, teamId);
  if (!access.allowed) return mapAccessError(access.reason);

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

    // Pre-compute chunks once — shared by embedding orchestrator and theme service
    const sessionMeta: SessionMeta = {
      sessionId: id,
      clientName: parsed.data.clientName,
      sessionDate: parsed.data.sessionDate,
      teamId,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
    };
    const structuredJson = parsed.data.isExtraction
      ? ((parsed.data.structuredJson as ExtractedSignals | null) ?? null)
      : null;
    const chunks = structuredJson
      ? chunkStructuredSignals(structuredJson, sessionMeta)
      : chunkRawNotes(parsed.data.rawNotes, sessionMeta);

    // Fire-and-forget: embeddings → theme assignment (chained, P1.R7)
    // Always re-embed on PUT — isReExtraction deletes old embeddings first,
    // and the cascade on signal_themes.embedding_id cleans up old assignments (P1.R9)
    const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
    const themeRepo = createThemeRepository(serviceClient, teamId);
    const signalThemeRepo = createSignalThemeRepository(serviceClient);

    generateSessionEmbeddings({
      sessionMeta,
      structuredJson,
      rawNotes: parsed.data.rawNotes,
      embeddingRepo,
      isReExtraction: true,
      preComputedChunks: chunks,
    })
      .then(async (embeddingIds) => {
        if (!embeddingIds || embeddingIds.length === 0) return;
        await assignSessionThemes({
          chunks,
          embeddingIds,
          teamId,
          userId: user.id,
          themeRepo,
          signalThemeRepo,
        });
      })
      .then(async () => {
        const insightRepo = createInsightRepository(serviceClient);
        await maybeRefreshDashboardInsights({
          teamId,
          userId: user.id,
          insightRepo,
          supabase: serviceClient,
        });
      })
      .catch((err) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "\x1b[33m⚠ [PUT /api/sessions/[id]] EMBEDDING+THEME+INSIGHTS CHAIN FAILED:\x1b[0m",
            err instanceof Error ? err.message : err
          );
        }
      });

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return mapAccessError("unauthenticated");
  }

  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const teamRepo = createTeamRepository(supabase, serviceClient);
  const masterSignalRepo = createMasterSignalRepository(supabase, serviceClient, teamId);

  const access = await checkSessionAccess(sessionRepo, teamRepo, id, user.id, teamId);
  if (!access.allowed) return mapAccessError(access.reason);

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
