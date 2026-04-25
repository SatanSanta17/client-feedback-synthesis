import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { MAX_COMBINED_CHARS, SESSION_CHAIN_MAX_DURATION_SECONDS } from "@/lib/constants";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/schemas/extraction-schema";
import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";
import { createEmbeddingRepository } from "@/lib/repositories/supabase/supabase-embedding-repository";
import { createThemeRepository } from "@/lib/repositories/supabase/supabase-theme-repository";
import { createSignalThemeRepository } from "@/lib/repositories/supabase/supabase-signal-theme-repository";
import { createInsightRepository } from "@/lib/repositories/supabase/supabase-insight-repository";
import { maybeRefreshDashboardInsights } from "@/lib/services/insight-service";
import {
  getSessions,
  createSession,
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

// Allow the post-response embedding+theme+insights chain (run via `after()`)
// up to SESSION_CHAIN_MAX_DURATION_SECONDS to complete before Vercel terminates the function instance.
export const maxDuration = SESSION_CHAIN_MAX_DURATION_SECONDS;

// --- GET /api/sessions?clientId=&dateFrom=&dateTo=&offset=&limit= ---

const getSessionsParamsSchema = z.object({
  clientId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  promptVersionId: z.string().uuid().optional(),
  promptVersionNull: z.coerce.boolean().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());

  console.log("[api/sessions] GET — params:", JSON.stringify(params));

  const parsed = getSessionsParamsSchema.safeParse(params);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/sessions] GET — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const teamId = await getActiveTeamId();
    const serviceClient = createServiceRoleClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);

    const result = await getSessions(sessionRepo, {
      clientId: parsed.data.clientId,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      promptVersionId: parsed.data.promptVersionId,
      promptVersionNull: parsed.data.promptVersionNull,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    }, teamId);

    console.log("[api/sessions] GET — returning", result.sessions.length, "of", result.total, "total");
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      "[api/sessions] GET error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

// --- POST /api/sessions ---

const createSessionSchema = z
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
      .optional()
      .default(null),
    structuredJson: z.record(z.string(), z.unknown()).nullable().optional().default(null),
    hasAttachments: z.boolean().optional().default(false),
    promptVersionId: z.string().uuid().nullable().optional().default(null),
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

export async function POST(request: NextRequest) {
  console.log("[api/sessions] POST — creating session");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/sessions] POST — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const teamId = await getActiveTeamId();
    const serviceClient = createServiceRoleClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
    const clientRepo = createClientRepository(supabase, teamId);

    const session = await createSession(sessionRepo, clientRepo, {
      clientId: parsed.data.clientId,
      clientName: parsed.data.clientName,
      sessionDate: parsed.data.sessionDate,
      rawNotes: parsed.data.rawNotes,
      structuredNotes: parsed.data.structuredNotes,
      structuredJson: parsed.data.structuredJson,
      promptVersionId: parsed.data.promptVersionId,
    });

    console.log("[api/sessions] POST — created session:", session.id);

    const userId = user.id;

    // Pre-compute chunks once — shared by embedding orchestrator and theme service
    const sessionMeta: SessionMeta = {
      sessionId: session.id,
      clientName: parsed.data.clientName,
      sessionDate: parsed.data.sessionDate,
      teamId,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
    };
    const structuredJson = (parsed.data.structuredJson as ExtractedSignals | null) ?? null;
    const chunks = structuredJson
      ? chunkStructuredSignals(structuredJson, sessionMeta)
      : chunkRawNotes(parsed.data.rawNotes, sessionMeta);

    // Post-response chain: embeddings → theme assignment → insights refresh.
    // `after()` keeps the function instance alive past the response so the
    // chain isn't frozen mid-flight on Vercel's serverless runtime (gap E2).
    const embeddingRepo = createEmbeddingRepository(serviceClient, teamId);
    const themeRepo = createThemeRepository(serviceClient, teamId);
    const signalThemeRepo = createSignalThemeRepository(serviceClient);

    const chainStart = Date.now();
    after(
      generateSessionEmbeddings({
        sessionMeta,
        structuredJson,
        rawNotes: parsed.data.rawNotes,
        embeddingRepo,
        preComputedChunks: chunks,
      })
        .then(async (embeddingIds) => {
          console.log(
            `[POST /api/sessions] chain timing — embeddings: ${Date.now() - chainStart}ms — sessionId: ${session.id}`
          );
          if (!embeddingIds || embeddingIds.length === 0) return;
          const themeStart = Date.now();
          await assignSessionThemes({
            chunks,
            embeddingIds,
            teamId,
            userId,
            themeRepo,
            signalThemeRepo,
          });
          console.log(
            `[POST /api/sessions] chain timing — themes: ${Date.now() - themeStart}ms — sessionId: ${session.id}`
          );
        })
        .then(async () => {
          const insightStart = Date.now();
          const insightRepo = createInsightRepository(serviceClient);
          await maybeRefreshDashboardInsights({
            teamId,
            userId,
            insightRepo,
            supabase: serviceClient,
          });
          console.log(
            `[POST /api/sessions] chain timing — insights: ${Date.now() - insightStart}ms; total: ${Date.now() - chainStart}ms — sessionId: ${session.id}`
          );
        })
        .catch((err) => {
          console.error(
            "[POST /api/sessions] EMBEDDING+THEME+INSIGHTS CHAIN FAILED — sessionId:",
            session.id,
            "elapsedMs:",
            Date.now() - chainStart,
            "error:",
            err instanceof Error ? err.message : err,
            err instanceof Error ? err.stack : undefined
          );
        })
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    if (err instanceof ClientDuplicateError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }

    console.error(
      "[api/sessions] POST error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to create session" },
      { status: 500 }
    );
  }
}
