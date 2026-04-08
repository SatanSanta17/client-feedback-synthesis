import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_COMBINED_CHARS } from "@/lib/constants";
import {
  checkSessionAccess,
  updateSession,
  deleteSession,
  SessionNotFoundError,
  ClientDuplicateError,
} from "@/lib/services/session-service";
import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { mapAccessError } from "@/lib/utils/map-access-error";
import { createSessionRepository } from "@/lib/repositories/supabase/supabase-session-repository";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";
import { createTeamRepository } from "@/lib/repositories/supabase/supabase-team-repository";
import { createMasterSignalRepository } from "@/lib/repositories/supabase/supabase-master-signal-repository";

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
      promptVersionId: parsed.data.promptVersionId,
      isExtraction: parsed.data.isExtraction,
      inputChanged: parsed.data.inputChanged,
    }, user.id);

    console.log("[api/sessions/[id]] PUT — updated:", session.id);
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
