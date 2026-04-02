import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  updateSession,
  deleteSession,
  SessionNotFoundError,
  ClientDuplicateError,
} from "@/lib/services/session-service";

// --- PUT /api/sessions/[id] ---

const updateSessionSchema = z
  .object({
    clientId: z.string().uuid().nullable(),
    clientName: z.string().max(255).default(""),
    sessionDate: z.string().min(1, "Session date is required"),
    rawNotes: z
      .string()
      .min(1, "Notes are required")
      .max(50000, "Notes must be 50,000 characters or fewer"),
    structuredNotes: z
      .string()
      .max(100000, "Structured notes must be 100,000 characters or fewer")
      .nullable()
      .optional(),
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
  );

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  console.log("[api/sessions/[id]] PUT — id:", id);

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
    const session = await updateSession(id, {
      clientId: parsed.data.clientId,
      clientName: parsed.data.clientName,
      sessionDate: parsed.data.sessionDate,
      rawNotes: parsed.data.rawNotes,
      structuredNotes: parsed.data.structuredNotes,
    });

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

  try {
    await deleteSession(id);

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
