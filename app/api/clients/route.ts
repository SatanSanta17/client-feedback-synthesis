import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  searchClients,
  createNewClient,
  ClientDuplicateError,
} from "@/lib/services/client-service";
import { createClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";

// --- GET /api/clients?q=<search>&hasSession=true ---

const clientSearchSchema = z.object({
  q: z.string().max(255, "Search query must be 255 characters or fewer").optional().default(""),
  hasSession: z.enum(["true", "false"]).optional().default("false"),
});

export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = clientSearchSchema.safeParse(raw);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    console.warn("[api/clients] GET — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  const query = parsed.data.q;
  const hasSession = parsed.data.hasSession === "true";

  console.log("[api/clients] GET — query:", JSON.stringify(query), "hasSession:", hasSession);

  const supabase = await createClient();
  const teamId = await getActiveTeamId();
  const repo = createClientRepository(supabase, teamId);

  try {
    const clients = await searchClients(repo, query, hasSession);

    console.log("[api/clients] GET — returning", clients.length, "clients");
    return NextResponse.json({ clients });
  } catch (err) {
    console.error(
      "[api/clients] GET error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to search clients" },
      { status: 500 }
    );
  }
}

// --- POST /api/clients ---

const createClientSchema = z.object({
  name: z
    .string()
    .min(1, "Client name is required")
    .max(255, "Client name must be 255 characters or fewer"),
});

export async function POST(request: NextRequest) {
  console.log("[api/clients] POST — creating client");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join(", ");
    console.warn("[api/clients] POST — validation failed:", message);
    return NextResponse.json({ message }, { status: 400 });
  }

  const supabase = await createClient();
  const teamId = await getActiveTeamId();
  const repo = createClientRepository(supabase, teamId);

  try {
    const client = await createNewClient(repo, parsed.data.name);

    console.log("[api/clients] POST — created:", client.id, client.name);
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    if (err instanceof ClientDuplicateError) {
      return NextResponse.json({ message: err.message }, { status: 409 });
    }

    console.error(
      "[api/clients] POST error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { message: "Failed to create client" },
      { status: 500 }
    );
  }
}
