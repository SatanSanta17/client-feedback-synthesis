import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_COMBINED_CHARS } from "@/lib/constants";
import {
  getSessions,
  createSession,
  ClientDuplicateError,
} from "@/lib/services/session-service";
import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";

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

  const supabase = await createClient();
  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);

  try {
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

  const supabase = await createClient();
  const teamId = await getActiveTeamId();
  const serviceClient = createServiceRoleClient();
  const sessionRepo = createSessionRepository(supabase, serviceClient, teamId);
  const clientRepo = createClientRepository(supabase, teamId);

  try {
    const session = await createSession(sessionRepo, clientRepo, {
      clientId: parsed.data.clientId,
      clientName: parsed.data.clientName,
      sessionDate: parsed.data.sessionDate,
      rawNotes: parsed.data.rawNotes,
      structuredNotes: parsed.data.structuredNotes,
      promptVersionId: parsed.data.promptVersionId,
    });

    console.log("[api/sessions] POST — created session:", session.id);
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
